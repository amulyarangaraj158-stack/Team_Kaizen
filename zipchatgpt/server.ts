import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';

import {
  db,
  initializeDatabase,
  hashPassword,
  verifyPassword,
  createProjectWithFiles,
  recalcProjectHealth,
  appendPatchAuditEvent,
} from './server/db.ts';
import { registerAdvancedRoutes, type NotificationOptions } from './server/advancedRoutes.ts';
import { SAMPLE_PROJECTS } from './server/samples.ts';
import {
  extractSafeZipBuffer,
  isSupportedSourceFile,
  sanitizeRelativePath,
  MAX_FILE_BYTES,
  MAX_ZIP_BYTES,
} from './server/uploads.ts';
import {
  scanProjectFilesWithAI,
  explainCodeWithAI,
  generatePatchWithAI,
  generateRegressionTestsWithAI,
  generateLearningInsightsWithAI,
  type GeneratedTestCaseAI,
} from './server/gemini.ts';
import { analyzeProjectImpact, type ProjectFileRecord, type ProjectBugRecord } from './server/impact.ts';
import { executeIsolatedJsTests, runStaticValidation } from './server/sandbox.ts';

initializeDatabase();

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ZIP_BYTES,
    files: 40,
  },
});

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  bio: string;
  created_at: string;
}

interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

const SESSION_COOKIE = 'autopatch_session';

function createSession(userId: string): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  return { token, expiresAt };
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 14 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const token = bearerToken || cookieToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.bio, u.created_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as (AuthUser & { expires_at: string }) | undefined;

  if (!row) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  req.user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    bio: row.bio || '',
    created_at: row.created_at,
  };
  req.sessionToken = token;
  next();
}

function createNotification(
  userId: string,
  projectId: string | null,
  type: string,
  title: string,
  message: string,
  opts?: NotificationOptions
): void {
  const eventKey = opts?.eventKey || null;
  if (eventKey) {
    const dup = db
      .prepare(
        `SELECT id FROM notifications
         WHERE user_id = ? AND event_key = ? AND created_at >= datetime('now', '-60 seconds')
         LIMIT 1`
      )
      .get(userId, eventKey);
    if (dup) return;
  }

  let projectName = opts?.projectName || null;
  if (!projectName && projectId) {
    const p = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(projectId) as { name?: string } | undefined;
    projectName = p?.name || null;
  }

  db.prepare(
    `INSERT INTO notifications (id, user_id, project_id, type, title, message, is_read, action_module, project_name, event_key)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    userId,
    projectId,
    type,
    title,
    message,
    opts?.actionModule || null,
    projectName,
    eventKey
  );
}

function assertProjectOwner(projectId: string, userId: string): Record<string, unknown> | null {
  const proj = db.prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`).get(projectId, userId) as
    | Record<string, unknown>
    | undefined;
  return proj || null;
}

// ============================================================================
// HEALTH & AUTH ROUTES
// ============================================================================

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/auth/register', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'Software Engineer').trim() || 'Software Engineer';

    if (name.length < 2) {
      res.status(400).json({ error: 'Please enter your full name (at least 2 characters).' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const userId = crypto.randomUUID();
    const { hash, salt } = hashPassword(password);

    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, password_salt, role, bio)
       VALUES (?, ?, ?, ?, ?, ?, '')`
    ).run(userId, name, email, hash, salt, role);

    const session = createSession(userId);
    setSessionCookie(res, session.token);

    createNotification(
      userId,
      null,
      'info',
      'Welcome to AutoPatch AI',
      'Upload a source project or load one of the built-in JS/Python sample projects to run your first Gemini AI scan.'
    );

    const user = db.prepare(`SELECT id, name, email, role, bio, created_at FROM users WHERE id = ?`).get(userId);
    res.status(201).json({ user, token: session.token });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const row = db
      .prepare(`SELECT id, name, email, role, bio, created_at, password_hash, password_salt FROM users WHERE email = ?`)
      .get(email) as (AuthUser & { password_hash: string; password_salt: string }) | undefined;

    if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const session = createSession(row.id);
    setSessionCookie(res, session.token);

    res.json({
      token: session.token,
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        bio: row.bio || '',
        created_at: row.created_at,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed.' });
  }
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  if (req.sessionToken) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.sessionToken);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

app.put('/api/profile', requireAuth, (req: AuthedRequest, res) => {
  try {
    const name = String(req.body?.name || req.user!.name).trim();
    const role = String(req.body?.role || req.user!.role).trim();
    const bio = String(req.body?.bio ?? req.user!.bio).trim();

    if (name.length < 2) {
      res.status(400).json({ error: 'Name must be at least 2 characters.' });
      return;
    }

    db.prepare(`UPDATE users SET name = ?, role = ?, bio = ?, updated_at = datetime('now') WHERE id = ?`).run(
      name,
      role,
      bio,
      req.user!.id
    );

    const updated = db
      .prepare(`SELECT id, name, email, role, bio, created_at FROM users WHERE id = ?`)
      .get(req.user!.id);
    res.json({ user: updated });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update profile.' });
  }
});

// ============================================================================
// NOTIFICATIONS
// ============================================================================

app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
  const items = db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`)
    .all(req.user!.id);
  res.json({ notifications: items });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user!.id);
  res.json({ ok: true });
});

// ============================================================================
// PROJECTS & UPLOADS
// ============================================================================

app.get('/api/projects', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id) as total_bugs,
        (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id AND b.status IN ('open','patch_generated')) as open_bugs,
        (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id AND b.status = 'verified') as verified_bugs
       FROM projects p
       WHERE p.user_id = ?
       ORDER BY p.updated_at DESC`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const projects = rows.map((r) => ({
    ...r,
    languages: JSON.parse(String(r.languages_json || '[]')),
  }));
  res.json({ projects });
});

app.post('/api/projects/sample', requireAuth, (req: AuthedRequest, res) => {
  try {
    const sampleKey = req.body?.sampleKey === 'python' ? 'python' : 'javascript';
    const def = SAMPLE_PROJECTS[sampleKey];
    const suffix = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const name = `${def.name} · ${suffix}`;
    const { projectId } = createProjectWithFiles(req.user!.id, name, def.description, def.files);

    createNotification(
      req.user!.id,
      projectId,
      'success',
      `Sample Project Created: ${name}`,
      `${def.files.length} source files indexed. Ready to run Gemini AI Bug Scan.`,
      { actionModule: 'projects', projectName: name, eventKey: `sample-proj:${projectId}` }
    );

    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<string, unknown>;
    res.status(201).json({
      project: { ...project, languages: JSON.parse(String(project.languages_json || '[]')) },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create sample project.' });
  }
});

app.post('/api/projects/upload', requireAuth, upload.array('files', 40), async (req: AuthedRequest, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    const uploadedFiles = (req.files as Express.Multer.File[] | undefined) || [];

    if (!name || name.length < 2) {
      res.status(400).json({ error: 'Project name is required (minimum 2 characters).' });
      return;
    }

    if (uploadedFiles.length === 0) {
      res.status(400).json({ error: 'Please select at least one source file or ZIP archive.' });
      return;
    }

    const collectedFiles: Array<{ filePath: string; content: string }> = [];
    const seenPaths = new Set<string>();
    let skippedCount = 0;

    // Parse optional relative paths sent from client
    let relativePaths: string[] = [];
    if (req.body?.relativePaths) {
      try {
        relativePaths = JSON.parse(String(req.body.relativePaths));
      } catch {
        relativePaths = [];
      }
    }

    for (let i = 0; i < uploadedFiles.length; i++) {
      const f = uploadedFiles[i];
      const ext = path.extname(f.originalname).toLowerCase();

      if (ext === '.zip') {
        const { files: zipFiles, skippedCount: zipSkipped } = await extractSafeZipBuffer(f.buffer);
        skippedCount += zipSkipped;
        for (const zf of zipFiles) {
          if (!seenPaths.has(zf.filePath)) {
            seenPaths.add(zf.filePath);
            collectedFiles.push(zf);
          }
        }
      } else {
        if (f.size > MAX_FILE_BYTES) {
          res.status(400).json({ error: `File "${f.originalname}" exceeds the 2MB per-file size limit.` });
          return;
        }
        const rawPath = relativePaths[i] || f.originalname;
        const cleanPath = sanitizeRelativePath(rawPath);
        if (!cleanPath || !isSupportedSourceFile(cleanPath)) {
          skippedCount++;
          continue;
        }
        if (f.buffer.includes(0)) {
          skippedCount++;
          continue;
        }
        if (!seenPaths.has(cleanPath)) {
          seenPaths.add(cleanPath);
          collectedFiles.push({
            filePath: cleanPath,
            content: f.buffer.toString('utf8'),
          });
        }
      }
    }

    if (collectedFiles.length === 0) {
      res.status(400).json({
        error:
          'No supported source files were found. Supported types: JS, TS, Python, Java, C, C++, HTML, CSS, SQL, Go, Rust, Ruby, PHP, JSON, MD.',
      });
      return;
    }

    const { projectId } = createProjectWithFiles(req.user!.id, name, description, collectedFiles);

    createNotification(
      req.user!.id,
      projectId,
      'success',
      `Project Uploaded: ${name}`,
      `Indexed ${collectedFiles.length} supported file(s)${skippedCount ? ` (${skippedCount} unsupported skipped)` : ''}.`,
      { actionModule: 'projects', projectName: name, eventKey: `upload-proj:${projectId}` }
    );

    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<string, unknown>;
    res.status(201).json({
      project: { ...project, languages: JSON.parse(String(project.languages_json || '[]')) },
      filesIndexed: collectedFiles.length,
      skippedCount,
    });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Upload processing failed.' });
  }
});

app.get('/api/projects/:projectId', requireAuth, (req: AuthedRequest, res) => {
  const proj = assertProjectOwner(String(req.params.projectId), req.user!.id);
  if (!proj) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const files = db
    .prepare(`SELECT * FROM uploaded_files WHERE project_id = ? ORDER BY file_path ASC`)
    .all(String(req.params.projectId));
  res.json({
    project: { ...proj, languages: JSON.parse(String(proj.languages_json || '[]')) },
    files,
  });
});

app.delete('/api/projects/:projectId', requireAuth, (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  const proj = assertProjectOwner(projectId, req.user!.id);
  if (!proj) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).run(projectId, req.user!.id);
  res.json({ ok: true });
});

app.get('/api/projects/:projectId/download-zip', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const projectId = String(req.params.projectId);
    const proj = assertProjectOwner(projectId, req.user!.id);
    if (!proj) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    const files = db
      .prepare(`SELECT file_path, current_content FROM uploaded_files WHERE project_id = ? ORDER BY file_path ASC`)
      .all(projectId) as Array<{ file_path: string; current_content: string }>;

    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.file_path, f.current_content);
    }

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const safeName = String(proj.name)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-repaired.zip"`);
    res.send(buf);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to build ZIP archive.' });
  }
});

// ============================================================================
// AI CODE EXPLAINER
// ============================================================================

app.post('/api/projects/:projectId/explain', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const projectId = String(req.params.projectId);
    const proj = assertProjectOwner(projectId, req.user!.id);
    if (!proj) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const fileId = String(req.body?.fileId || '');
    const selectedCode = typeof req.body?.selectedCode === 'string' ? req.body.selectedCode : undefined;
    const startLine = Number(req.body?.startLine) || 1;
    const endLine = Number(req.body?.endLine) || startLine;

    const file = db
      .prepare(`SELECT * FROM uploaded_files WHERE id = ? AND project_id = ?`)
      .get(fileId, projectId) as ProjectFileRecord | undefined;

    if (!file) {
      res.status(404).json({ error: 'Selected source file was not found in this project.' });
      return;
    }

    const explanation = await explainCodeWithAI({
      filePath: file.file_path,
      language: file.language,
      fullCode: file.current_content,
      selectedCode,
      startLine,
      endLine,
    });

    res.json({ explanation, filePath: file.file_path, language: file.language });
  } catch (err: unknown) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Gemini AI failed to explain the code.',
    });
  }
});

// ============================================================================
// AI BUG SCANNER & ROOT CAUSE ANALYSIS
// ============================================================================

app.post('/api/projects/:projectId/scan', requireAuth, async (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  const proj = assertProjectOwner(projectId, req.user!.id);
  if (!proj) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const files = db
    .prepare(`SELECT id, file_path, file_name, language, line_count, current_content FROM uploaded_files WHERE project_id = ? ORDER BY file_path ASC`)
    .all(projectId) as unknown as ProjectFileRecord[];

  if (files.length === 0) {
    res.status(400).json({ error: 'This project has no source files to scan.' });
    return;
  }

  const scanId = crypto.randomUUID();
  const startedAt = Date.now();
  db.prepare(
    `INSERT INTO scan_history (id, project_id, user_id, status, model_used, files_scanned)
     VALUES (?, ?, ?, 'running', 'gemini-4-hydrogen', ?)`
  ).run(scanId, projectId, req.user!.id, files.length);

  try {
    // Limit total characters sent in a single scan to remain within prompt bounds safely
    const scannableFiles = files.slice(0, 18).map((f) => ({
      filePath: f.file_path,
      language: f.language,
      content: f.current_content.slice(0, 18000),
    }));

    const { bugs, modelUsed } = await scanProjectFilesWithAI(String(proj.name), scannableFiles);
    const durationMs = Date.now() - startedAt;

    const fileByPath = new Map(files.map((f) => [f.file_path, f]));
    const severityWeights: Record<string, number> = { critical: 40, high: 30, medium: 20, low: 10 };

    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;

    // Remove previously open/unpatched bugs from older scans so fresh scan reflects current source state accurately
    db.prepare(`DELETE FROM detected_bugs WHERE project_id = ? AND status IN ('open', 'rejected')`).run(projectId);

    const insertBug = db.prepare(
      `INSERT INTO detected_bugs (
        id, project_id, scan_id, file_id, file_path, line_start, line_end,
        title, category, severity, impact_score, confidence, priority_score,
        description, why_occurred, root_cause, potential_impact, suggested_solution, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`
    );

    const insertedIds: string[] = [];

    for (const b of bugs) {
      // Match exact path or basename fallback
      let matchedFile = fileByPath.get(b.filePath);
      if (!matchedFile) {
        matchedFile = files.find((f) => f.file_path.endsWith(b.filePath) || f.file_name === path.basename(b.filePath));
      }
      if (!matchedFile) continue;

      if (b.severity === 'critical') criticalCount++;
      else if (b.severity === 'high') highCount++;
      else if (b.severity === 'medium') mediumCount++;
      else lowCount++;

      const priorityScore = Math.min(
        100,
        Math.round(
          (severityWeights[b.severity] || 20) + b.impactScore * 0.4 + b.confidence * 0.2
        )
      );

      const bugId = crypto.randomUUID();
      insertBug.run(
        bugId,
        projectId,
        scanId,
        matchedFile.id,
        matchedFile.file_path,
        b.lineStart,
        Math.max(b.lineStart, b.lineEnd),
        b.title,
        b.category,
        b.severity,
        b.impactScore,
        b.confidence,
        priorityScore,
        b.description,
        b.whyOccurred,
        b.rootCause,
        b.potentialImpact,
        b.suggestedSolution
      );
      insertedIds.push(bugId);
      appendPatchAuditEvent({
        patchId: `bug-${bugId.slice(0, 8)}`,
        projectId,
        bugId,
        fileId: matchedFile.id,
        filePath: matchedFile.file_path,
        userId: req.user!.id,
        eventType: 'bug_detected',
        decisionStatus: 'open',
        confidenceScore: b.confidence,
        riskScore: b.impactScore,
        summary: `Detected [${b.severity.toUpperCase()}] ${b.title} at lines ${b.lineStart}-${Math.max(b.lineStart, b.lineEnd)}`,
      });
    }

    db.prepare(
      `UPDATE scan_history
       SET status = 'completed', model_used = ?, bugs_found = ?, critical_count = ?, high_count = ?, medium_count = ?, low_count = ?, duration_ms = ?
       WHERE id = ?`
    ).run(modelUsed, insertedIds.length, criticalCount, highCount, mediumCount, lowCount, durationMs, scanId);

    db.prepare(`UPDATE projects SET last_scan_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(projectId);
    recalcProjectHealth(projectId);

    createNotification(
      req.user!.id,
      projectId,
      criticalCount > 0 ? 'error' : insertedIds.length > 0 ? 'warning' : 'success',
      `AI Scan Completed: ${proj.name}`,
      `Analyzed ${scannableFiles.length} file(s) in ${(durationMs / 1000).toFixed(1)}s. Found ${insertedIds.length} defect(s) (${criticalCount} critical, ${highCount} high).`,
      { actionModule: 'scanner', projectName: String(proj.name), eventKey: `scan:${scanId}` }
    );

    const savedBugs = db
      .prepare(`SELECT * FROM detected_bugs WHERE project_id = ? ORDER BY priority_score DESC, created_at DESC`)
      .all(projectId);

    const scanRecord = db.prepare(`SELECT * FROM scan_history WHERE id = ?`).get(scanId);
    res.json({ scan: scanRecord, bugs: savedBugs });
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : 'Gemini AI scan failed.';
    db.prepare(
      `UPDATE scan_history SET status = 'failed', duration_ms = ?, error_message = ? WHERE id = ?`
    ).run(durationMs, message, scanId);

    createNotification(
      req.user!.id,
      projectId,
      'error',
      `AI Scan Failed: ${proj.name}`,
      message,
      { actionModule: 'scanner', projectName: String(proj.name), eventKey: `scan-fail:${scanId}` }
    );

    res.status(502).json({ error: message });
  }
});

app.get('/api/projects/:projectId/bugs', requireAuth, (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  if (!assertProjectOwner(projectId, req.user!.id)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const bugs = db
    .prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM suggested_fixes sf WHERE sf.bug_id = b.id) as fix_count,
        (SELECT sf.id FROM suggested_fixes sf WHERE sf.bug_id = b.id ORDER BY sf.created_at DESC LIMIT 1) as latest_fix_id,
        (SELECT sf.status FROM suggested_fixes sf WHERE sf.bug_id = b.id ORDER BY sf.created_at DESC LIMIT 1) as latest_fix_status
       FROM detected_bugs b
       WHERE b.project_id = ?
       ORDER BY b.priority_score DESC, b.created_at DESC`
    )
    .all(projectId);

  res.json({ bugs });
});

// ============================================================================
// CODE IMPACT RADAR
// ============================================================================

app.get('/api/projects/:projectId/impact', requireAuth, (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  if (!assertProjectOwner(projectId, req.user!.id)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const files = db
    .prepare(`SELECT id, file_path, file_name, language, line_count, current_content FROM uploaded_files WHERE project_id = ? ORDER BY file_path ASC`)
    .all(projectId) as unknown as ProjectFileRecord[];

  const bugs = db
    .prepare(`SELECT id, file_id, file_path, line_start, line_end, title, category, severity, status, impact_score FROM detected_bugs WHERE project_id = ?`)
    .all(projectId) as unknown as ProjectBugRecord[];

  const radar = analyzeProjectImpact(files, bugs);
  res.json(radar);
});

// ============================================================================
// AI CODE REPAIR & DIFF EDITOR (SAFE REPAIR MODE)
// ============================================================================

app.get('/api/projects/:projectId/fixes', requireAuth, (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  if (!assertProjectOwner(projectId, req.user!.id)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT sf.*, b.title as bug_title, b.severity as bug_severity, b.file_path, b.line_start, b.status as bug_status,
              u.name as applied_by_name
       FROM suggested_fixes sf
       JOIN detected_bugs b ON b.id = sf.bug_id
       LEFT JOIN users u ON u.id = sf.applied_by_user_id
       WHERE sf.project_id = ?
       ORDER BY sf.created_at DESC`
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const fixes = rows.map((r) => ({
    ...r,
    risks: JSON.parse(String(r.risks_json || '[]')),
  }));
  res.json({ fixes });
});

app.post('/api/bugs/:bugId/generate-fix', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const bugId = String(req.params.bugId);
    const bug = db
      .prepare(
        `SELECT b.*, p.user_id, f.current_content, f.original_content, f.language
         FROM detected_bugs b
         JOIN projects p ON p.id = b.project_id
         JOIN uploaded_files f ON f.id = b.file_id
         WHERE b.id = ? AND p.user_id = ?`
      )
      .get(bugId, req.user!.id) as Record<string, unknown> | undefined;

    if (!bug) {
      res.status(404).json({ error: 'Bug record not found.' });
      return;
    }

    const patch = await generatePatchWithAI({
      filePath: String(bug.file_path),
      language: String(bug.language),
      currentCode: String(bug.current_content),
      bug: {
        title: String(bug.title),
        category: String(bug.category),
        severity: String(bug.severity),
        lineStart: Number(bug.line_start),
        lineEnd: Number(bug.line_end),
        description: String(bug.description),
        rootCause: String(bug.root_cause),
        suggestedSolution: String(bug.suggested_solution),
      },
    });

    const fixId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO suggested_fixes (id, bug_id, project_id, file_id, original_code, patched_code, explanation, confidence, risks_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      fixId,
      bugId,
      String(bug.project_id),
      String(bug.file_id),
      String(bug.current_content),
      patch.patchedCode,
      patch.explanation,
      patch.confidence,
      JSON.stringify(patch.risks)
    );

    if (bug.status === 'open') {
      db.prepare(`UPDATE detected_bugs SET status = 'patch_generated', updated_at = datetime('now') WHERE id = ?`).run(bugId);
    }

    appendPatchAuditEvent({
      patchId: fixId,
      projectId: String(bug.project_id),
      bugId,
      fileId: String(bug.file_id),
      filePath: String(bug.file_path),
      userId: req.user!.id,
      eventType: 'patch_generated',
      decisionStatus: 'pending',
      confidenceScore: patch.confidence,
      riskScore: Math.min(100, Math.max(10, patch.risks.length * 22)),
      summary: `Generated AI repair patch for "${bug.title}" (${patch.confidence}% confidence)`,
      originalCode: String(bug.current_content),
      proposedCode: patch.patchedCode,
    });

    createNotification(
      req.user!.id,
      String(bug.project_id),
      'info',
      `Patch Generated: ${bug.title}`,
      `Safe Repair Mode: review side-by-side diff (${patch.confidence}% confidence) before approving.`,
      { actionModule: 'repair', eventKey: `patch-gen:${fixId}` }
    );

    const saved = db.prepare(`SELECT * FROM suggested_fixes WHERE id = ?`).get(fixId) as Record<string, unknown>;
    res.status(201).json({
      fix: { ...saved, risks: JSON.parse(String(saved.risks_json || '[]')), changeHighlights: patch.changeHighlights },
    });
  } catch (err: unknown) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to generate AI patch.' });
  }
});

app.post('/api/fixes/:fixId/accept', requireAuth, (req: AuthedRequest, res) => {
  try {
    const fixId = String(req.params.fixId);
    const fix = db
      .prepare(
        `SELECT sf.*, p.user_id, f.current_content, b.title as bug_title
         FROM suggested_fixes sf
         JOIN projects p ON p.id = sf.project_id
         JOIN uploaded_files f ON f.id = sf.file_id
         JOIN detected_bugs b ON b.id = sf.bug_id
         WHERE sf.id = ? AND p.user_id = ?`
      )
      .get(fixId, req.user!.id) as Record<string, unknown> | undefined;

    if (!fix) {
      res.status(404).json({ error: 'Suggested fix not found.' });
      return;
    }

    const beforeContent = String(fix.current_content);
    const afterContent = String(fix.patched_code);
    const newLineCount = afterContent.split('\n').length;

    // Safe Repair Mode: update ONLY current_content, never modify immutable original_content
    db.prepare(
      `UPDATE uploaded_files SET current_content = ?, line_count = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(afterContent, newLineCount, String(fix.file_id));

    db.prepare(
      `UPDATE suggested_fixes SET status = 'accepted', applied_by_user_id = ?, applied_at = datetime('now') WHERE id = ?`
    ).run(req.user!.id, fixId);

    // Note: status becomes 'patched' (NOT 'verified') until Test Guardian validates the fix!
    db.prepare(`UPDATE detected_bugs SET status = 'patched', updated_at = datetime('now') WHERE id = ?`).run(
      String(fix.bug_id)
    );

    db.prepare(
      `INSERT INTO change_history (id, project_id, file_id, bug_id, fix_id, user_id, action_type, before_content, after_content, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'patch_accepted', ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      String(fix.project_id),
      String(fix.file_id),
      String(fix.bug_id),
      fixId,
      req.user!.id,
      beforeContent,
      afterContent,
      `Accepted AI patch for "${fix.bug_title}"`
    );

    const fileRow = db.prepare(`SELECT file_path FROM uploaded_files WHERE id = ?`).get(String(fix.file_id)) as
      | { file_path: string }
      | undefined;

    appendPatchAuditEvent({
      patchId: fixId,
      projectId: String(fix.project_id),
      bugId: String(fix.bug_id),
      fileId: String(fix.file_id),
      filePath: fileRow?.file_path || '',
      userId: req.user!.id,
      eventType: 'patch_accepted',
      decisionStatus: 'accepted',
      confidenceScore: Number(fix.confidence || 0),
      summary: `Developer ${req.user!.name} approved & applied patch for "${fix.bug_title}"`,
      originalCode: beforeContent,
      proposedCode: afterContent,
      modifiedCode: afterContent,
    });

    recalcProjectHealth(String(fix.project_id));
    createNotification(
      req.user!.id,
      String(fix.project_id),
      'success',
      `Patch Accepted: ${fix.bug_title}`,
      'Applied to active working file (immutable baseline preserved). Run Test Guardian to verify fix.',
      { actionModule: 'testing', eventKey: `patch-acc:${fixId}` }
    );

    res.json({ ok: true, bugStatus: 'patched' });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to accept patch.' });
  }
});

app.post('/api/fixes/:fixId/reject', requireAuth, (req: AuthedRequest, res) => {
  try {
    const fixId = String(req.params.fixId);
    const reason = String(req.body?.reason || 'Rejected by developer during diff review.').trim();
    const fix = db
      .prepare(
        `SELECT sf.*, p.user_id, f.current_content, b.title as bug_title
         FROM suggested_fixes sf
         JOIN projects p ON p.id = sf.project_id
         JOIN uploaded_files f ON f.id = sf.file_id
         JOIN detected_bugs b ON b.id = sf.bug_id
         WHERE sf.id = ? AND p.user_id = ?`
      )
      .get(fixId, req.user!.id) as Record<string, unknown> | undefined;

    if (!fix) {
      res.status(404).json({ error: 'Suggested fix not found.' });
      return;
    }

    db.prepare(
      `UPDATE suggested_fixes SET status = 'rejected', applied_by_user_id = ?, applied_at = datetime('now') WHERE id = ?`
    ).run(req.user!.id, fixId);

    db.prepare(`UPDATE detected_bugs SET status = 'open', updated_at = datetime('now') WHERE id = ? AND status = 'patch_generated'`).run(
      String(fix.bug_id)
    );

    db.prepare(
      `INSERT INTO change_history (id, project_id, file_id, bug_id, fix_id, user_id, action_type, before_content, after_content, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'patch_rejected', ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      String(fix.project_id),
      String(fix.file_id),
      String(fix.bug_id),
      fixId,
      req.user!.id,
      String(fix.current_content),
      String(fix.current_content),
      `Rejected AI patch for "${fix.bug_title}": ${reason}`
    );

    const fileRow = db.prepare(`SELECT file_path FROM uploaded_files WHERE id = ?`).get(String(fix.file_id)) as
      | { file_path: string }
      | undefined;

    appendPatchAuditEvent({
      patchId: fixId,
      projectId: String(fix.project_id),
      bugId: String(fix.bug_id),
      fileId: String(fix.file_id),
      filePath: fileRow?.file_path || '',
      userId: req.user!.id,
      eventType: 'patch_rejected',
      decisionStatus: 'rejected',
      confidenceScore: Number(fix.confidence || 0),
      summary: `Developer ${req.user!.name} rejected patch for "${fix.bug_title}": ${reason}`,
      originalCode: String(fix.current_content),
      proposedCode: String(fix.patched_code),
    });

    createNotification(
      req.user!.id,
      String(fix.project_id),
      'warning',
      `Patch Rejected: ${fix.bug_title}`,
      reason,
      { actionModule: 'audit', eventKey: `patch-rej:${fixId}` }
    );

    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to reject patch.' });
  }
});

// ============================================================================
// TEST GUARDIAN & VALIDATION
// ============================================================================

app.get('/api/projects/:projectId/tests', requireAuth, (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  if (!assertProjectOwner(projectId, req.user!.id)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT t.*, b.title as bug_title, b.file_path, b.severity as bug_severity, b.status as bug_status
       FROM test_results t
       JOIN detected_bugs b ON b.id = t.bug_id
       WHERE t.project_id = ?
       ORDER BY t.created_at DESC`
    )
    .all(projectId) as Array<Record<string, unknown>>;

  const testResults = rows.map((r) => ({
    ...r,
    cases: JSON.parse(String(r.cases_json || '[]')),
    regression_detected: Boolean(r.regression_detected),
  }));
  res.json({ testResults });
});

app.post('/api/bugs/:bugId/generate-tests', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const bugId = String(req.params.bugId);
    const bug = db
      .prepare(
        `SELECT b.*, p.user_id, f.original_content, f.current_content, f.language
         FROM detected_bugs b
         JOIN projects p ON p.id = b.project_id
         JOIN uploaded_files f ON f.id = b.file_id
         WHERE b.id = ? AND p.user_id = ?`
      )
      .get(bugId, req.user!.id) as Record<string, unknown> | undefined;

    if (!bug) {
      res.status(404).json({ error: 'Bug not found.' });
      return;
    }

    const latestFix = db
      .prepare(`SELECT * FROM suggested_fixes WHERE bug_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(bugId) as Record<string, unknown> | undefined;

    const { testCases } = await generateRegressionTestsWithAI({
      filePath: String(bug.file_path),
      language: String(bug.language),
      originalCode: String(bug.original_content),
      patchedCode: latestFix ? String(latestFix.patched_code) : String(bug.current_content),
      bug: {
        title: String(bug.title),
        category: String(bug.category),
        description: String(bug.description),
        rootCause: String(bug.root_cause),
      },
    });

    res.json({ testCases, language: String(bug.language) });
  } catch (err: unknown) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to generate regression tests.' });
  }
});

app.post('/api/bugs/:bugId/run-tests', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const bugId = String(req.params.bugId);
    const phase = req.body?.phase === 'before' ? 'before' : 'after';
    const fixId = req.body?.fixId ? String(req.body.fixId) : null;
    const testCases = (req.body?.testCases || []) as GeneratedTestCaseAI[];

    if (!Array.isArray(testCases) || testCases.length === 0) {
      res.status(400).json({ error: 'Generate or provide regression test cases before running validation.' });
      return;
    }

    const bug = db
      .prepare(
        `SELECT b.*, p.user_id, f.original_content, f.current_content, f.language
         FROM detected_bugs b
         JOIN projects p ON p.id = b.project_id
         JOIN uploaded_files f ON f.id = b.file_id
         WHERE b.id = ? AND p.user_id = ?`
      )
      .get(bugId, req.user!.id) as Record<string, unknown> | undefined;

    if (!bug) {
      res.status(404).json({ error: 'Bug not found.' });
      return;
    }

    const fix = fixId
      ? (db.prepare(`SELECT * FROM suggested_fixes WHERE id = ? AND bug_id = ?`).get(fixId, bugId) as Record<string, unknown> | undefined)
      : (db.prepare(`SELECT * FROM suggested_fixes WHERE bug_id = ? ORDER BY created_at DESC LIMIT 1`).get(bugId) as
          | Record<string, unknown>
          | undefined);

    const codeToTest =
      phase === 'before'
        ? String(bug.original_content)
        : fix
          ? String(fix.patched_code)
          : String(bug.current_content);

    const allProjectFiles = db
      .prepare(`SELECT file_path, original_content, current_content FROM uploaded_files WHERE project_id = ?`)
      .all(String(bug.project_id)) as Array<{ file_path: string; original_content: string; current_content: string }>;

    const lang = String(bug.language);
    const isJsLike = lang === 'javascript' || lang === 'typescript';

    const suiteResult = isJsLike
      ? await executeIsolatedJsTests({
          targetFilePath: String(bug.file_path),
          targetCode: codeToTest,
          projectFiles: allProjectFiles.map((f) => ({
            filePath: f.file_path,
            content: phase === 'before' ? f.original_content : f.current_content,
          })),
          testCases,
        })
      : runStaticValidation({
          language: lang,
          code: codeToTest,
          testCases,
        });

    // Detect regression by comparing against the most recent 'before' run for this bug
    let regressionDetected = false;
    if (phase === 'after') {
      const prevBefore = db
        .prepare(`SELECT cases_json FROM test_results WHERE bug_id = ? AND phase = 'before' ORDER BY created_at DESC LIMIT 1`)
        .get(bugId) as { cases_json: string } | undefined;

      if (prevBefore) {
        const beforeCases = JSON.parse(prevBefore.cases_json) as Array<{ id: string; passed: boolean }>;
        const beforePassedIds = new Set(beforeCases.filter((c) => c.passed).map((c) => c.id));
        regressionDetected = suiteResult.cases.some((c) => beforePassedIds.has(c.id) && !c.passed);
      }
    }

    const testResultId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO test_results (
        id, project_id, bug_id, fix_id, phase, execution_mode,
        total_tests, passed_tests, failed_tests, regression_detected, validation_status, summary, cases_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      testResultId,
      String(bug.project_id),
      bugId,
      fix ? String(fix.id) : null,
      phase,
      suiteResult.executionMode,
      suiteResult.totalTests,
      suiteResult.passedTests,
      suiteResult.failedTests,
      regressionDetected ? 1 : 0,
      suiteResult.validationStatus,
      suiteResult.summary,
      JSON.stringify(suiteResult.cases)
    );

    appendPatchAuditEvent({
      patchId: fix ? String(fix.id) : `bug-${bugId.slice(0, 8)}`,
      projectId: String(bug.project_id),
      bugId,
      fileId: String(bug.file_id),
      filePath: String(bug.file_path),
      userId: req.user!.id,
      eventType: 'tests_executed',
      decisionStatus: fix ? String(fix.status) : 'pending',
      testStatus: regressionDetected ? 'regression' : suiteResult.validationStatus,
      testResultsJson: JSON.stringify({
        testResultId,
        phase,
        executionMode: suiteResult.executionMode,
        passedTests: suiteResult.passedTests,
        totalTests: suiteResult.totalTests,
        failedTests: suiteResult.failedTests,
        regressionDetected,
      }),
      summary: `${phase.toUpperCase()}-fix validation (${suiteResult.executionMode}): ${suiteResult.passedTests}/${suiteResult.totalTests} passed${regressionDetected ? ' — REGRESSION DETECTED' : ''}`,
    });

    // Strictly enforce: a bug is marked 'verified' ONLY when its patch has been explicitly accepted AND after-fix validation passes with zero regressions!
    let updatedBugStatus = String(bug.status);
    if (
      phase === 'after' &&
      fix &&
      fix.status === 'accepted' &&
      !regressionDetected &&
      (suiteResult.validationStatus === 'passed' || suiteResult.validationStatus === 'static_verified')
    ) {
      db.prepare(`UPDATE detected_bugs SET status = 'verified', updated_at = datetime('now') WHERE id = ?`).run(bugId);
      updatedBugStatus = 'verified';
      recalcProjectHealth(String(bug.project_id));
      appendPatchAuditEvent({
        patchId: String(fix.id),
        projectId: String(bug.project_id),
        bugId,
        fileId: String(bug.file_id),
        filePath: String(bug.file_path),
        userId: req.user!.id,
        eventType: 'patch_verified',
        decisionStatus: 'accepted',
        testStatus: suiteResult.validationStatus,
        summary: `Fix verified for "${bug.title}": ${suiteResult.passedTests}/${suiteResult.totalTests} checks passed with zero regressions.`,
        originalCode: String(fix.original_code),
        proposedCode: String(fix.patched_code),
        modifiedCode: String(bug.current_content),
      });
      createNotification(
        req.user!.id,
        String(bug.project_id),
        'success',
        `Fix Verified: ${bug.title}`,
        `${suiteResult.passedTests}/${suiteResult.totalTests} validation checks passed with zero regressions.`,
        { actionModule: 'testing', eventKey: `test-verified:${testResultId}` }
      );
    } else if (regressionDetected || suiteResult.validationStatus === 'failed' || suiteResult.validationStatus === 'error') {
      createNotification(
        req.user!.id,
        String(bug.project_id),
        'error',
        regressionDetected ? `Regression Detected: ${bug.title}` : `Validation Failed: ${bug.title}`,
        `${suiteResult.passedTests}/${suiteResult.totalTests} checks passed in ${phase.toUpperCase()}-fix run. ${suiteResult.summary}`,
        { actionModule: 'testing', eventKey: `test-fail:${testResultId}` }
      );
    } else if (phase === 'after') {
      createNotification(
        req.user!.id,
        String(bug.project_id),
        'success',
        `Tests Passed: ${bug.title}`,
        `${suiteResult.passedTests}/${suiteResult.totalTests} validation checks passed. Accept the patch in Repair & Diff to mark verified.`,
        { actionModule: 'testing', eventKey: `test-pass:${testResultId}` }
      );
    }

    const saved = db.prepare(`SELECT * FROM test_results WHERE id = ?`).get(testResultId) as Record<string, unknown>;
    res.json({
      testResult: {
        ...saved,
        cases: JSON.parse(String(saved.cases_json || '[]')),
        regression_detected: Boolean(saved.regression_detected),
      },
      bugStatus: updatedBugStatus,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Test execution failed.' });
  }
});

// ============================================================================
// PATCH ROLLBACK & AUDIT HISTORY
// ============================================================================

app.get('/api/projects/:projectId/history', requireAuth, (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  if (!assertProjectOwner(projectId, req.user!.id)) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const changes = db
    .prepare(
      `SELECT ch.*, u.name as user_name, u.email as user_email, f.file_path, f.current_content as latest_file_content, f.original_content as baseline_file_content,
              b.title as bug_title
       FROM change_history ch
       JOIN users u ON u.id = ch.user_id
       JOIN uploaded_files f ON f.id = ch.file_id
       LEFT JOIN detected_bugs b ON b.id = ch.bug_id
       WHERE ch.project_id = ?
       ORDER BY ch.created_at DESC`
    )
    .all(projectId);

  const scans = db
    .prepare(`SELECT * FROM scan_history WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId);

  res.json({ changes, scans });
});

app.post('/api/history/:changeId/rollback', requireAuth, (req: AuthedRequest, res) => {
  try {
    const changeId = String(req.params.changeId);
    const targetVersion = req.body?.target === 'after' ? 'after' : 'before';

    const change = db
      .prepare(
        `SELECT ch.*, p.user_id as project_owner, f.current_content as current_file_content, f.file_path
         FROM change_history ch
         JOIN projects p ON p.id = ch.project_id
         JOIN uploaded_files f ON f.id = ch.file_id
         WHERE ch.id = ? AND p.user_id = ?`
      )
      .get(changeId, req.user!.id) as Record<string, unknown> | undefined;

    if (!change) {
      res.status(404).json({ error: 'Change history record not found.' });
      return;
    }

    const restoredContent =
      targetVersion === 'after' ? String(change.after_content) : String(change.before_content);
    const previousCurrent = String(change.current_file_content);

    db.prepare(
      `UPDATE uploaded_files SET current_content = ?, line_count = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(restoredContent, restoredContent.split('\n').length, String(change.file_id));

    if (change.fix_id && targetVersion === 'before') {
      db.prepare(`UPDATE suggested_fixes SET status = 'rolled_back' WHERE id = ?`).run(String(change.fix_id));
    }
    if (change.bug_id && targetVersion === 'before') {
      db.prepare(`UPDATE detected_bugs SET status = 'open', updated_at = datetime('now') WHERE id = ?`).run(
        String(change.bug_id)
      );
    }

    db.prepare(
      `INSERT INTO change_history (id, project_id, file_id, bug_id, fix_id, user_id, action_type, before_content, after_content, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'rollback', ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      String(change.project_id),
      String(change.file_id),
      change.bug_id ? String(change.bug_id) : null,
      change.fix_id ? String(change.fix_id) : null,
      req.user!.id,
      previousCurrent,
      restoredContent,
      `Rolled back ${change.file_path} to ${targetVersion === 'before' ? 'pre-patch baseline' : 'archived patch snapshot'} from audit entry ${changeId.slice(0, 8)}`
    );

    appendPatchAuditEvent({
      patchId: change.fix_id ? String(change.fix_id) : `change-${changeId.slice(0, 8)}`,
      projectId: String(change.project_id),
      bugId: change.bug_id ? String(change.bug_id) : null,
      fileId: String(change.file_id),
      filePath: String(change.file_path),
      userId: req.user!.id,
      eventType: 'rollback_executed',
      decisionStatus: 'rolled_back',
      rollbackStatus: targetVersion === 'before' ? 'restored_baseline' : 'restored_snapshot',
      summary: `Rolled back ${change.file_path} to ${targetVersion === 'before' ? 'pre-patch baseline' : 'archived patch snapshot'} (audit entry ${changeId.slice(0, 8)})`,
      originalCode: previousCurrent,
      modifiedCode: restoredContent,
    });

    recalcProjectHealth(String(change.project_id));
    createNotification(
      req.user!.id,
      String(change.project_id),
      'warning',
      `Rollback Executed: ${change.file_path}`,
      `Restored previous file state and appended immutable rollback event to Patch Audit Trail.`,
      { actionModule: 'audit', eventKey: `rollback:${changeId}:${Date.now()}` }
    );

    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rollback failed.' });
  }
});

// ============================================================================
// DASHBOARD ANALYTICS, PATTERN INTELLIGENCE, LEARNING INSIGHTS & REPORTS
// ============================================================================

app.get('/api/dashboard', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const range = req.query.range === 'monthly' ? 'monthly' : 'weekly';

  const projectCountRow = db
    .prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN last_scan_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed FROM projects WHERE user_id = ?`)
    .get(userId) as { total: number; analyzed: number | null };

  const bugStats = db
    .prepare(
      `SELECT
        COUNT(*) as total_bugs,
        SUM(CASE WHEN b.severity = 'critical' THEN 1 ELSE 0 END) as critical_bugs,
        SUM(CASE WHEN b.severity = 'high' THEN 1 ELSE 0 END) as high_bugs,
        SUM(CASE WHEN b.severity = 'medium' THEN 1 ELSE 0 END) as medium_bugs,
        SUM(CASE WHEN b.severity = 'low' THEN 1 ELSE 0 END) as low_bugs,
        SUM(CASE WHEN b.status IN ('patched','verified') THEN 1 ELSE 0 END) as bugs_repaired,
        SUM(CASE WHEN b.status = 'verified' THEN 1 ELSE 0 END) as verified_fixes,
        SUM(CASE WHEN b.status IN ('open','patch_generated') THEN 1 ELSE 0 END) as pending_fixes
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       WHERE p.user_id = ?`
    )
    .get(userId) as Record<string, number | null>;

  const testStats = db
    .prepare(
      `SELECT
        SUM(t.failed_tests) as failed_tests,
        SUM(t.passed_tests) as passed_tests,
        SUM(CASE WHEN t.phase = 'after' AND t.validation_status = 'failed' THEN 1 ELSE 0 END) as failed_repairs
       FROM test_results t
       JOIN projects p ON p.id = t.project_id
       WHERE p.user_id = ?`
    )
    .get(userId) as Record<string, number | null>;

  const fixStats = db
    .prepare(
      `SELECT
        COUNT(*) as total_fixes,
        SUM(CASE WHEN sf.status = 'accepted' THEN 1 ELSE 0 END) as accepted_fixes,
        SUM(CASE WHEN sf.status = 'pending' THEN 1 ELSE 0 END) as pending_patches,
        SUM(CASE WHEN sf.status = 'rejected' THEN 1 ELSE 0 END) as rejected_patches
       FROM suggested_fixes sf
       JOIN projects p ON p.id = sf.project_id
       WHERE p.user_id = ?`
    )
    .get(userId) as Record<string, number | null>;

  const projects = (
    db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id) as total_bugs,
          (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id AND b.status = 'verified') as verified_bugs
         FROM projects p
         WHERE p.user_id = ?
         ORDER BY p.updated_at DESC
         LIMIT 8`
      )
      .all(userId) as Array<Record<string, unknown>>
  ).map((r) => ({ ...r, languages: JSON.parse(String(r.languages_json || '[]')) }));

  // Build real trend buckets from actual DB timestamps
  const daysBack = range === 'monthly' ? 30 : 7;
  const trends: Array<{ label: string; detected: number; resolved: number }> = [];
  const allUserBugs = db
    .prepare(
      `SELECT b.created_at, b.updated_at, b.status
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       WHERE p.user_id = ?`
    )
    .all(userId) as Array<{ created_at: string; updated_at: string; status: string }>;

  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    const isoDay = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    let detected = 0;
    let resolved = 0;
    for (const b of allUserBugs) {
      if (b.created_at.slice(0, 10) === isoDay) detected++;
      if ((b.status === 'patched' || b.status === 'verified') && b.updated_at.slice(0, 10) === isoDay) resolved++;
    }
    trends.push({ label, detected, resolved });
  }

  // Real Recent Activity combined from scans, changes, tests, and projects
  const recentScans = db
    .prepare(
      `SELECT sh.id, sh.created_at, p.name as project_name, p.id as project_id, sh.bugs_found, sh.status
       FROM scan_history sh JOIN projects p ON p.id = sh.project_id
       WHERE sh.user_id = ? ORDER BY sh.created_at DESC LIMIT 6`
    )
    .all(userId) as Array<Record<string, unknown>>;

  const recentChanges = db
    .prepare(
      `SELECT ch.id, ch.created_at, ch.action_type, ch.notes, p.name as project_name, p.id as project_id
       FROM change_history ch JOIN projects p ON p.id = ch.project_id
       WHERE p.user_id = ? ORDER BY ch.created_at DESC LIMIT 6`
    )
    .all(userId) as Array<Record<string, unknown>>;

  const recentTests = db
    .prepare(
      `SELECT t.id, t.created_at, t.phase, t.passed_tests, t.total_tests, t.validation_status, p.name as project_name, p.id as project_id
       FROM test_results t JOIN projects p ON p.id = t.project_id
       WHERE p.user_id = ? ORDER BY t.created_at DESC LIMIT 6`
    )
    .all(userId) as Array<Record<string, unknown>>;

  const activity = [
    ...recentScans.map((s) => ({
      id: `scan-${s.id}`,
      type: 'scan',
      title: `AI Scan ${s.status}: ${s.project_name}`,
      detail: `${s.bugs_found} defect(s) discovered`,
      projectId: s.project_id,
      timestamp: String(s.created_at),
    })),
    ...recentChanges.map((c) => ({
      id: `change-${c.id}`,
      type: String(c.action_type),
      title: `${String(c.action_type).replace('_', ' ')} · ${c.project_name}`,
      detail: String(c.notes || ''),
      projectId: c.project_id,
      timestamp: String(c.created_at),
    })),
    ...recentTests.map((t) => ({
      id: `test-${t.id}`,
      type: 'test',
      title: `Test Guardian (${t.phase}-fix) · ${t.project_name}`,
      detail: `${t.passed_tests}/${t.total_tests} passed (${t.validation_status})`,
      projectId: t.project_id,
      timestamp: String(t.created_at),
    })),
  ]
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, 10);

  const totalBugs = bugStats.total_bugs || 0;
  const verifiedFixes = bugStats.verified_fixes || 0;
  const bugsRepaired = bugStats.bugs_repaired || 0;
  const fixSuccessRate = totalBugs > 0 ? Math.round((verifiedFixes / totalBugs) * 100) : 0;

  res.json({
    stats: {
      totalProjects: projectCountRow.total || 0,
      projectsAnalyzed: projectCountRow.analyzed || 0,
      totalBugs,
      criticalBugs: bugStats.critical_bugs || 0,
      highBugs: bugStats.high_bugs || 0,
      mediumBugs: bugStats.medium_bugs || 0,
      lowBugs: bugStats.low_bugs || 0,
      bugsRepaired,
      verifiedFixes,
      pendingFixes: bugStats.pending_fixes || 0,
      failedTests: testStats.failed_tests || 0,
      passedTests: testStats.passed_tests || 0,
      failedRepairs: testStats.failed_repairs || 0,
      fixSuccessRate,
      acceptedFixes: fixStats.accepted_fixes || 0,
      pendingPatches: fixStats.pending_patches || 0,
      rejectedPatches: fixStats.rejected_patches || 0,
    },
    projects,
    trends,
    activity,
  });
});

app.get('/api/patterns', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const projectId = req.query.projectId ? String(req.query.projectId) : null;

  const whereClause = projectId ? 'WHERE p.user_id = ? AND b.project_id = ?' : 'WHERE p.user_id = ?';
  const params = projectId ? [userId, projectId] : [userId];

  const byCategory = db
    .prepare(
      `SELECT b.category, COUNT(*) as count,
        SUM(CASE WHEN b.severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
        SUM(CASE WHEN b.status = 'verified' THEN 1 ELSE 0 END) as verified_count
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       ${whereClause}
       GROUP BY b.category
       ORDER BY count DESC`
    )
    .all(...params);

  const byFile = db
    .prepare(
      `SELECT b.file_path, p.name as project_name, COUNT(*) as bug_count,
        MAX(CASE b.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) as max_sev_rank
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       ${whereClause}
       GROUP BY b.file_path, p.name
       ORDER BY bug_count DESC
       LIMIT 10`
    )
    .all(...params);

  const recurringRootCauses = db
    .prepare(
      `SELECT b.category, b.title, b.root_cause, b.suggested_solution, b.severity, b.file_path, p.name as project_name
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       ${whereClause}
       ORDER BY b.priority_score DESC
       LIMIT 12`
    )
    .all(...params);

  const trendRows = db
    .prepare(
      `SELECT substr(b.created_at, 1, 10) as day, COUNT(*) as detected,
        SUM(CASE WHEN b.status IN ('patched','verified') THEN 1 ELSE 0 END) as fixed
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       ${whereClause}
       GROUP BY substr(b.created_at, 1, 10)
       ORDER BY day ASC`
    )
    .all(...params);

  res.json({ byCategory, byFile, recurringRootCauses, trends: trendRows });
});

app.get('/api/learning', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const insights = db
    .prepare(`SELECT * FROM learning_insights WHERE user_id = ? ORDER BY frequency_count DESC, updated_at DESC`)
    .all(userId);

  const categoryBreakdown = db
    .prepare(
      `SELECT b.category, COUNT(*) as encountered,
        SUM(CASE WHEN b.status = 'verified' THEN 1 ELSE 0 END) as resolved
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       WHERE p.user_id = ?
       GROUP BY b.category
       ORDER BY encountered DESC`
    )
    .all(userId);

  res.json({ insights, categoryBreakdown });
});

app.post('/api/learning/refresh', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const bugs = db
      .prepare(
        `SELECT b.category, b.severity, b.title, b.root_cause as rootCause, b.file_path as filePath, b.project_id
         FROM detected_bugs b
         JOIN projects p ON p.id = b.project_id
         WHERE p.user_id = ?
         ORDER BY b.created_at DESC
         LIMIT 30`
      )
      .all(userId) as Array<{
      category: string;
      severity: string;
      title: string;
      rootCause: string;
      filePath: string;
      project_id: string;
    }>;

    if (bugs.length === 0) {
      res.status(400).json({ error: 'Run at least one AI scan before generating personalized learning insights.' });
      return;
    }

    const { insights } = await generateLearningInsightsWithAI(bugs);

    // Preserve mastered insights, refresh active ones
    db.prepare(`DELETE FROM learning_insights WHERE user_id = ? AND status != 'mastered'`).run(userId);

    const insert = db.prepare(
      `INSERT INTO learning_insights (id, user_id, project_id, concept_title, mistake_category, frequency_count, why_it_happens, explanation, recommendation, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    );

    for (const ins of insights) {
      insert.run(
        crypto.randomUUID(),
        userId,
        bugs[0].project_id,
        ins.conceptTitle,
        ins.mistakeCategory,
        Math.max(1, Number(ins.frequencyCount) || 1),
        ins.whyItHappens,
        ins.explanation,
        ins.recommendation
      );
    }

    const updated = db
      .prepare(`SELECT * FROM learning_insights WHERE user_id = ? ORDER BY frequency_count DESC, updated_at DESC`)
      .all(userId);

    res.json({ insights: updated });
  } catch (err: unknown) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Failed to refresh learning insights.' });
  }
});

app.patch('/api/learning/:insightId', requireAuth, (req: AuthedRequest, res) => {
  const insightId = String(req.params.insightId);
  const status = String(req.body?.status || '');
  if (!['active', 'practicing', 'mastered'].includes(status)) {
    res.status(400).json({ error: 'Invalid status value.' });
    return;
  }
  const resUpdate = db
    .prepare(`UPDATE learning_insights SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(status, insightId, req.user!.id);
  if (resUpdate.changes === 0) {
    res.status(404).json({ error: 'Learning insight not found.' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/projects/:projectId/report', requireAuth, (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  const proj = assertProjectOwner(projectId, req.user!.id);
  if (!proj) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const scans = db.prepare(`SELECT * FROM scan_history WHERE project_id = ? ORDER BY created_at DESC`).all(projectId);
  const bugs = db.prepare(`SELECT * FROM detected_bugs WHERE project_id = ? ORDER BY priority_score DESC`).all(projectId);
  const fixes = (
    db
      .prepare(
        `SELECT sf.*, b.title as bug_title, b.file_path
         FROM suggested_fixes sf
         JOIN detected_bugs b ON b.id = sf.bug_id
         WHERE sf.project_id = ?
         ORDER BY sf.created_at DESC`
      )
      .all(projectId) as Array<Record<string, unknown>>
  ).map((r) => ({ ...r, risks: JSON.parse(String(r.risks_json || '[]')) }));

  const tests = (
    db
      .prepare(
        `SELECT t.*, b.title as bug_title, b.file_path
         FROM test_results t
         JOIN detected_bugs b ON b.id = t.bug_id
         WHERE t.project_id = ?
         ORDER BY t.created_at DESC`
      )
      .all(projectId) as Array<Record<string, unknown>>
  ).map((r) => ({
    ...r,
    cases: JSON.parse(String(r.cases_json || '[]')),
    regression_detected: Boolean(r.regression_detected),
  }));

  const changes = db
    .prepare(
      `SELECT ch.*, u.name as user_name, f.file_path
       FROM change_history ch
       JOIN users u ON u.id = ch.user_id
       JOIN uploaded_files f ON f.id = ch.file_id
       WHERE ch.project_id = ?
       ORDER BY ch.created_at DESC`
    )
    .all(projectId);

  res.json({
    generatedAt: new Date().toISOString(),
    generatedBy: req.user,
    project: { ...proj, languages: JSON.parse(String(proj.languages_json || '[]')) },
    scans,
    bugs,
    fixes,
    tests,
    changes,
  });
});

registerAdvancedRoutes(app, {
  requireAuth,
  assertProjectOwner,
  createNotification,
});

// ============================================================================
// VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVING
// ============================================================================

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoPatch AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
