import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import { createServer as createViteServer } from 'vite';

import { db, initializeDatabase, rebuildProjectDependencies, recalculateProjectHealth } from './server/db';
import { AuthedRequest, requireAuth, signAuthToken, verifyAuthToken } from './server/middleware/auth';
import { classifyMediaMime, sanitizeProjectFilePath } from './server/utils/security';
import { calculatePatchScores } from './server/utils/scoring';
import { detectLanguage, getLanguageCapabilityMatrix, isPythonAvailable } from './server/analyzers/staticAnalyzer';
import { runRegressionGuardian } from './server/analyzers/sandboxRunner';
import { scanLocalProjectWebAssets, scanRemoteWebsite } from './server/analyzers/websiteAnalyzer';
import { inspectMultimediaBuffer, scanProjectMultimediaReferences } from './server/analyzers/multimediaAnalyzer';
import {
  analyzeImageSemanticsWithGemini,
  askAutoPatchChat,
  generateAiPatchForBug,
  generatePatternPreventionRecommendations,
  getAiServiceStatus,
} from './server/services/aiService';
import { createAndEmitNotification, executeProjectScan } from './server/services/scanEngine';

initializeDatabase();

const app = express();
const httpServer = http.createServer(app);

const corsOrigin = process.env.CORS_ORIGIN || '*';
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigin === '*' ? true : corsOrigin.split(','),
    credentials: true,
  },
});

io.use((socket, next) => {
  const token = (socket.handshake.auth?.token as string | undefined) || '';
  const user = verifyAuthToken(token);
  if (!user) {
    return next(new Error('Unauthorized socket connection'));
  }
  (socket.data as { user?: typeof user }).user = user;
  next();
});

io.on('connection', (socket) => {
  const user = (socket.data as { user?: { id: string } }).user;
  if (user?.id) {
    socket.join(`user:${user.id}`);
  }
});

// Security headers (iframe-safe for preview environments)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(
  cors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(','),
    credentials: true,
  })
);
app.use(express.json({ limit: '6mb' }));
app.use(express.urlencoded({ extended: true, limit: '6mb' }));

// Rate limiting on auth and API endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again shortly.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'API rate limit exceeded. Slow down requests.' },
});

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// Multer in-memory upload handlers with strict size caps
const codeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 40 },
});

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

// ============================================================================
// SYSTEM HEALTH (Live backend-derived status — never fakes green)
// ============================================================================
app.get('/api/health', (_req, res) => {
  let dbHealthy = false;
  let dbTables = 0;
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'").get() as { c: number };
    dbHealthy = row.c > 0;
    dbTables = row.c;
  } catch {
    dbHealthy = false;
  }

  const aiStatus = getAiServiceStatus();
  const pythonReady = isPythonAvailable();

  res.json({
    status: dbHealthy ? 'operational' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      backendApi: {
        status: 'operational',
        detail: `Express + Socket.IO online (Node ${process.version})`,
      },
      database: {
        status: dbHealthy ? 'operational' : 'unavailable',
        detail: dbHealthy ? `SQLite WAL connected (${dbTables} tables)` : 'SQLite connection error',
      },
      aiService: {
        status: aiStatus.configured ? 'operational' : 'unconfigured',
        provider: aiStatus.provider,
        model: aiStatus.model,
        detail: aiStatus.configured
          ? `Google Gemini active (${aiStatus.model})`
          : 'GEMINI_API_KEY not set — static analysis active; configure key in Settings > Secrets for AI patches & chat',
      },
      codeAnalysisEngine: {
        status: 'operational',
        detail: `TypeScript Compiler API + ${pythonReady ? 'Python 3 AST' : 'Rule Engine'} + 14-language registry`,
      },
      testingEngine: {
        status: 'operational',
        detail: `Isolated temp-dir sandbox (node:test${pythonReady ? ' & python3 unittest' : ''})`,
      },
    },
  });
});

// ============================================================================
// AUTHENTICATION (JWT + bcrypt)
// ============================================================================
const registerSchema = z.object({
  email: z.string().email().max(160),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(128),
});

app.post('/api/auth/register', (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration payload.' });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync(parsed.data.password, 10);
  db.prepare('INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
    id,
    email,
    parsed.data.name.trim(),
    hash,
    'Security Engineer'
  );
  const user = { id, email, name: parsed.data.name.trim(), role: 'Security Engineer' };
  const token = signAuthToken(user);
  res.status(201).json({ user, token });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post('/api/auth/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please provide a valid email and password.' });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const row = db
    .prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = ?')
    .get(email) as { id: string; email: string; name: string; role: string; password_hash: string } | undefined;

  if (!row || !bcrypt.compareSync(parsed.data.password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const user = { id: row.id, email: row.email, name: row.name, role: row.role };
  const token = signAuthToken(user);
  res.json({ user, token });
});

// Issues a real signed JWT for the seeded default workspace engineer
app.post('/api/auth/demo-session', (_req, res) => {
  const row = db
    .prepare('SELECT id, email, name, role FROM users WHERE email = ?')
    .get('engineer@autopatch.ai') as { id: string; email: string; name: string; role: string } | undefined;
  if (!row) {
    res.status(404).json({ error: 'Starter workspace account not found.' });
    return;
  }
  const token = signAuthToken(row);
  res.json({ user: row, token });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

// ============================================================================
// CAPABILITIES & GLOBAL SEARCH
// ============================================================================
app.get('/api/capabilities/languages', requireAuth, (_req, res) => {
  res.json({ languages: getLanguageCapabilityMatrix() });
});

app.get('/api/search', requireAuth, (req: AuthedRequest, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ projects: [], files: [], bugs: [] });
    return;
  }
  const like = `%${q}%`;
  const userId = req.user!.id;

  const projects = db
    .prepare('SELECT id, name, primary_language, health_score FROM projects WHERE user_id = ? AND (name LIKE ? OR description LIKE ?) LIMIT 6')
    .all(userId, like, like);

  const files = db
    .prepare(`
      SELECT f.id, f.project_id, f.path, f.language, p.name as project_name
      FROM uploaded_files f
      JOIN projects p ON p.id = f.project_id
      WHERE p.user_id = ? AND (f.path LIKE ? OR f.content LIKE ?)
      LIMIT 8
    `)
    .all(userId, like, like);

  const bugs = db
    .prepare(`
      SELECT b.id, b.project_id, b.file_path, b.title, b.severity, b.status, p.name as project_name
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? AND (b.title LIKE ? OR b.description LIKE ? OR b.file_path LIKE ? OR b.category LIKE ?)
      LIMIT 10
    `)
    .all(userId, like, like, like, like);

  res.json({ projects, files, bugs });
});

// ============================================================================
// DASHBOARD OVERVIEW (100% real SQL aggregates)
// ============================================================================
app.get('/api/dashboard', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;

  const projectFilterSql = projectId ? 'AND b.project_id = ?' : '';
  const bugParams = projectId ? [userId, projectId] : [userId];

  const bugStats = db
    .prepare(`
      SELECT
        COUNT(*) as totalBugs,
        SUM(CASE WHEN b.status = 'resolved' THEN 1 ELSE 0 END) as resolvedBugs,
        SUM(CASE WHEN b.status = 'open' AND b.severity = 'critical' THEN 1 ELSE 0 END) as criticalOpen,
        SUM(CASE WHEN b.status = 'open' THEN 1 ELSE 0 END) as openBugs
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? ${projectFilterSql}
    `)
    .get(...bugParams) as {
    totalBugs: number;
    resolvedBugs: number | null;
    criticalOpen: number | null;
    openBugs: number | null;
  };

  let healthScore = 100;
  if (projectId) {
    const p = db.prepare('SELECT health_score FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as
      | { health_score: number }
      | undefined;
    healthScore = p?.health_score ?? 100;
  } else {
    const avg = db.prepare('SELECT AVG(health_score) as avgScore FROM projects WHERE user_id = ?').get(userId) as {
      avgScore: number | null;
    };
    healthScore = avg.avgScore !== null ? Math.round(avg.avgScore) : 100;
  }

  // Feature usage counts from real tables
  const counts = {
    projects: (db.prepare('SELECT COUNT(*) as c FROM projects WHERE user_id = ?').get(userId) as { c: number }).c,
    scans: (db.prepare('SELECT COUNT(*) as c FROM scan_history WHERE user_id = ?').get(userId) as { c: number }).c,
    pendingFixes: (
      db
        .prepare(`SELECT COUNT(*) as c FROM suggested_fixes sf JOIN projects p ON p.id = sf.project_id WHERE p.user_id = ? AND sf.status = 'pending'`)
        .get(userId) as { c: number }
    ).c,
    regressionRuns: (
      db
        .prepare(`SELECT COUNT(*) as c FROM test_results tr JOIN projects p ON p.id = tr.project_id WHERE p.user_id = ?`)
        .get(userId) as { c: number }
    ).c,
    dependencyEdges: (
      db
        .prepare(`SELECT COUNT(*) as c FROM dependency_edges de JOIN projects p ON p.id = de.project_id WHERE p.user_id = ?`)
        .get(userId) as { c: number }
    ).c,
    conversations: (db.prepare('SELECT COUNT(*) as c FROM ai_conversations WHERE user_id = ?').get(userId) as { c: number }).c,
    websiteScans: (db.prepare('SELECT COUNT(*) as c FROM website_scan_results WHERE user_id = ?').get(userId) as { c: number }).c,
    multimediaScans: (db.prepare('SELECT COUNT(*) as c FROM multimedia_analysis WHERE user_id = ?').get(userId) as { c: number }).c,
    auditEvents: (db.prepare('SELECT COUNT(*) as c FROM patch_audit_events WHERE user_id = ?').get(userId) as { c: number }).c,
    snapshots: (db.prepare("SELECT COUNT(*) as c FROM patch_snapshots WHERE user_id = ? AND status = 'active'").get(userId) as { c: number }).c,
  };

  // Activity timeline combined from real DB tables
  const recentScans = db
    .prepare(`
      SELECT s.id, 'scan_completed' as eventType, p.name as projectName, s.summary as detail, s.started_at as createdAt, s.project_id as projectId
      FROM scan_history s
      JOIN projects p ON p.id = s.project_id
      WHERE s.user_id = ?
      ORDER BY s.started_at DESC LIMIT 6
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const recentAudit = db
    .prepare(`
      SELECT a.id, a.action as eventType, p.name as projectName,
             CASE
               WHEN a.action = 'patch_applied' THEN 'Applied approved patch (' || a.bug_category || ') · ' || a.test_summary
               WHEN a.action = 'rollback' THEN 'Rolled back snapshot cleanly'
               WHEN a.action = 'regression_tested' THEN 'Regression Guardian check · ' || a.test_summary
               WHEN a.action = 'patch_rejected' THEN 'Rejected proposed patch (' || a.bug_category || ')'
               ELSE 'Suggested patch (' || a.bug_category || ') · Risk: ' || a.risk_level
             END as detail,
             a.created_at as createdAt, a.project_id as projectId
      FROM patch_audit_events a
      JOIN projects p ON p.id = a.project_id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC LIMIT 8
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const recentProjects = db
    .prepare(`
      SELECT id, 'project_uploaded' as eventType, name as projectName, 'Repository initialized (' || primary_language || ')' as detail, created_at as createdAt, id as projectId
      FROM projects
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 4
    `)
    .all(userId) as Array<Record<string, unknown>>;

  const activityTimeline = [...recentAudit, ...recentScans, ...recentProjects]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 12);

  // Severity distribution for chart
  const severityBreakdown = db
    .prepare(`
      SELECT b.severity, COUNT(*) as count
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? ${projectFilterSql}
      GROUP BY b.severity
    `)
    .all(...bugParams);

  res.json({
    metrics: {
      totalBugsDetected: bugStats.totalBugs || 0,
      bugsResolved: bugStats.resolvedBugs || 0,
      criticalIssues: bugStats.criticalOpen || 0,
      openBugs: bugStats.openBugs || 0,
      projectHealthScore: healthScore,
    },
    counts,
    severityBreakdown,
    activityTimeline,
  });
});

// ============================================================================
// PROJECTS & FILES
// ============================================================================
app.get('/api/projects', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM uploaded_files f WHERE f.project_id = p.id) as file_count,
        (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id AND b.status = 'open') as open_bugs,
        (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id AND b.status = 'resolved') as resolved_bugs,
        (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = p.id AND b.status = 'open' AND b.severity = 'critical') as critical_bugs,
        (SELECT MAX(started_at) FROM scan_history s WHERE s.project_id = p.id) as last_scan_at
      FROM projects p
      WHERE p.user_id = ?
      ORDER BY p.updated_at DESC
    `)
    .all(req.user!.id);
  res.json({ projects: rows });
});

const createProjectSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(600).optional().default(''),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(260),
        content: z.string().max(500_000),
      })
    )
    .optional()
    .default([]),
});

app.post('/api/projects', requireAuth, codeUpload.array('files', 40), (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const uploadedFilesMulter = (req.files as Express.Multer.File[] | undefined) || [];

  let name = String(req.body.name || '').trim();
  let description = String(req.body.description || '').trim();
  let rawFiles: Array<{ path: string; content: string }> = [];

  if (uploadedFilesMulter.length > 0) {
    if (name.length < 2) {
      res.status(400).json({ error: 'Project name must be at least 2 characters.' });
      return;
    }
    rawFiles = uploadedFilesMulter.map((f) => ({
      path: f.originalname,
      content: f.buffer.toString('utf8'),
    }));
  } else {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid project data.' });
      return;
    }
    name = parsed.data.name.trim();
    description = parsed.data.description.trim();
    rawFiles = parsed.data.files;
  }

  const sanitizedFiles: Array<{ path: string; content: string; language: string }> = [];
  try {
    for (const f of rawFiles) {
      const safePath = sanitizeProjectFilePath(f.path);
      sanitizedFiles.push({
        path: safePath,
        content: f.content,
        language: detectLanguage(safePath, f.content),
      });
    }
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid file path.' });
    return;
  }

  const projectId = crypto.randomUUID();
  const primaryLanguage = sanitizedFiles[0]?.language || 'typescript';

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO projects (id, user_id, name, description, primary_language, health_score)
      VALUES (?, ?, ?, ?, ?, 100)
    `).run(projectId, userId, name, description, primaryLanguage);

    const insertFile = db.prepare(`
      INSERT INTO uploaded_files (id, project_id, path, language, content, original_content, size_bytes, line_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const f of sanitizedFiles) {
      insertFile.run(
        crypto.randomUUID(),
        projectId,
        f.path,
        f.language,
        f.content,
        f.content,
        Buffer.byteLength(f.content, 'utf8'),
        f.content.split('\n').length
      );
    }
  });
  tx();

  if (sanitizedFiles.length > 0) {
    rebuildProjectDependencies(projectId);
  }

  createAndEmitNotification(io, {
    userId,
    projectId,
    type: 'project_uploaded',
    title: `Project Uploaded: ${name}`,
    message: `Initialized "${name}" with ${sanitizedFiles.length} source file(s). Ready for autonomous scan.`,
    linkPath: '/scan',
  });

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  res.status(201).json({ project, filesUploaded: sanitizedFiles.length });
});

app.get('/api/projects/:projectId', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.projectId, userId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const files = db
    .prepare('SELECT * FROM uploaded_files WHERE project_id = ? ORDER BY path ASC')
    .all(req.params.projectId);
  const scans = db
    .prepare('SELECT * FROM scan_history WHERE project_id = ? ORDER BY started_at DESC LIMIT 10')
    .all(req.params.projectId);
  const snapshots = db
    .prepare('SELECT * FROM patch_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(req.params.projectId);

  res.json({ project, files, scans, snapshots });
});

app.delete('/api/projects/:projectId', requireAuth, (req: AuthedRequest, res) => {
  const result = db
    .prepare('DELETE FROM projects WHERE id = ? AND user_id = ?')
    .run(req.params.projectId, req.user!.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ deleted: true });
});

app.post('/api/projects/:projectId/files', requireAuth, codeUpload.array('files', 30), (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.projectId, userId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const multerFiles = (req.files as Express.Multer.File[] | undefined) || [];
  let incoming: Array<{ path: string; content: string }> = [];
  if (multerFiles.length > 0) {
    incoming = multerFiles.map((f) => ({ path: f.originalname, content: f.buffer.toString('utf8') }));
  } else if (Array.isArray(req.body.files)) {
    incoming = req.body.files;
  } else if (typeof req.body.path === 'string' && typeof req.body.content === 'string') {
    incoming = [{ path: req.body.path, content: req.body.content }];
  }

  if (incoming.length === 0) {
    res.status(400).json({ error: 'No files provided.' });
    return;
  }

  const upsert = db.prepare(`
    INSERT INTO uploaded_files (id, project_id, path, language, content, original_content, size_bytes, line_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id, path) DO UPDATE SET
      content = excluded.content,
      language = excluded.language,
      size_bytes = excluded.size_bytes,
      line_count = excluded.line_count,
      updated_at = datetime('now')
  `);

  try {
    const tx = db.transaction(() => {
      for (const f of incoming) {
        const safePath = sanitizeProjectFilePath(f.path);
        const lang = detectLanguage(safePath, f.content);
        upsert.run(
          crypto.randomUUID(),
          req.params.projectId,
          safePath,
          lang,
          f.content,
          f.content,
          Buffer.byteLength(f.content, 'utf8'),
          f.content.split('\n').length
        );
      }
    });
    tx();
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid file input.' });
    return;
  }

  rebuildProjectDependencies(req.params.projectId);
  const files = db.prepare('SELECT * FROM uploaded_files WHERE project_id = ? ORDER BY path ASC').all(req.params.projectId);
  res.status(201).json({ files });
});

app.put('/api/projects/:projectId/files/:fileId', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const content = typeof req.body.content === 'string' ? req.body.content : null;
  if (content === null) {
    res.status(400).json({ error: 'File content string is required.' });
    return;
  }
  const file = db
    .prepare(`
      SELECT f.id, f.path, f.project_id
      FROM uploaded_files f
      JOIN projects p ON p.id = f.project_id
      WHERE f.id = ? AND f.project_id = ? AND p.user_id = ?
    `)
    .get(req.params.fileId, req.params.projectId, userId) as { id: string; path: string; project_id: string } | undefined;

  if (!file) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  const lang = typeof req.body.language === 'string' && req.body.language ? req.body.language : detectLanguage(file.path, content);
  db.prepare(`
    UPDATE uploaded_files
    SET content = ?, language = ?, size_bytes = ?, line_count = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(content, lang, Buffer.byteLength(content, 'utf8'), content.split('\n').length, file.id);

  db.prepare(`
    INSERT INTO change_history (id, project_id, file_id, user_id, change_type, diff_summary)
    VALUES (?, ?, ?, ?, 'manual_edit', ?)
  `).run(crypto.randomUUID(), file.project_id, file.id, userId, `Saved edits to ${file.path} in Code Workbench`);

  rebuildProjectDependencies(file.project_id);
  const updated = db.prepare('SELECT * FROM uploaded_files WHERE id = ?').get(file.id);
  res.json({ file: updated });
});

// ============================================================================
// LIVE 10-STAGE SCANNER
// ============================================================================
app.post('/api/projects/:projectId/scan', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const includeAiAnalysis = req.body?.includeAiAnalysis !== false;
  try {
    const result = await executeProjectScan(io, req.params.projectId, userId, { includeAiAnalysis });
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Scan failed.' });
  }
});

app.get('/api/projects/:projectId/scans', requireAuth, (req: AuthedRequest, res) => {
  const scans = db
    .prepare('SELECT * FROM scan_history WHERE project_id = ? AND user_id = ? ORDER BY started_at DESC LIMIT 20')
    .all(req.params.projectId, req.user!.id);
  res.json({ scans });
});

// ============================================================================
// BUGS, SMART PATCH SUGGESTIONS, REGRESSION GUARDIAN, APPLY & ROLLBACK
// ============================================================================
app.get('/api/projects/:projectId/bugs', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const project = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.projectId, userId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const bugs = db
    .prepare(`
      SELECT * FROM detected_bugs
      WHERE project_id = ?
      ORDER BY
        CASE status WHEN 'open' THEN 0 ELSE 1 END,
        CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        created_at DESC
    `)
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  const fixes = db
    .prepare('SELECT * FROM suggested_fixes WHERE project_id = ? ORDER BY created_at DESC')
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  const testRuns = db
    .prepare('SELECT * FROM test_results WHERE project_id = ? ORDER BY created_at DESC')
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  const fixesByBug = new Map<string, Array<Record<string, unknown>>>();
  for (const fx of fixes) {
    const bid = String(fx.bug_id);
    const list = fixesByBug.get(bid) || [];
    const linkedTests = testRuns.filter((tr) => tr.fix_id === fx.id);
    list.push({
      ...fx,
      scoreFactors: JSON.parse(String(fx.score_factors_json || '[]')),
      latestTest: linkedTests[0] || null,
    });
    fixesByBug.set(bid, list);
  }

  const enriched = bugs.map((b) => ({
    ...b,
    relatedConcepts: JSON.parse(String(b.related_concepts || '[]')),
    fixes: fixesByBug.get(String(b.id)) || [],
  }));

  res.json({ bugs: enriched });
});

app.post('/api/bugs/:bugId/suggest-fix', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const bug = db
    .prepare(`
      SELECT b.*, p.user_id, p.name as project_name
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE b.id = ? AND p.user_id = ?
    `)
    .get(req.params.bugId, userId) as
    | {
        id: string;
        project_id: string;
        file_id: string | null;
        file_path: string;
        line_number: number;
        category: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        title: string;
        description: string;
        project_name: string;
      }
    | undefined;

  if (!bug) {
    res.status(404).json({ error: 'Bug record not found.' });
    return;
  }

  const file = db
    .prepare('SELECT id, path, language, content FROM uploaded_files WHERE project_id = ? AND path = ?')
    .get(bug.project_id, bug.file_path) as { id: string; path: string; language: string; content: string } | undefined;

  if (!file) {
    res.status(404).json({ error: `Source file "${bug.file_path}" not found in project.` });
    return;
  }

  const depNode = db
    .prepare('SELECT direct_dependents, indirect_dependents FROM dependency_nodes WHERE project_id = ? AND file_path = ?')
    .get(bug.project_id, bug.file_path) as { direct_dependents: number; indirect_dependents: number } | undefined;

  const relatedEdges = db
    .prepare('SELECT source_path, target_path FROM dependency_edges WHERE project_id = ? AND (source_path = ? OR target_path = ?)')
    .all(bug.project_id, bug.file_path, bug.file_path) as Array<{ source_path: string; target_path: string }>;

  const hasTests = Boolean(
    db
      .prepare("SELECT id FROM uploaded_files WHERE project_id = ? AND (path LIKE '%.test.%' OR path LIKE '%.spec.%' OR path LIKE '%test_%.py') LIMIT 1")
      .get(bug.project_id)
  );

  try {
    const aiPatch = await generateAiPatchForBug({
      filePath: file.path,
      language: file.language,
      fileContent: file.content,
      bugTitle: bug.title,
      bugDescription: bug.description,
      bugCategory: bug.category,
      lineNumber: bug.line_number,
      relatedFilesContext: relatedEdges.map((e) => `${e.source_path} -> ${e.target_path}`).join('\n'),
    });

    const scores = calculatePatchScores({
      bugCategory: bug.category,
      bugSeverity: bug.severity,
      originalCode: file.content,
      proposedCode: aiPatch.proposedCode,
      filePath: file.path,
      changedFilesCount: 1,
      directDependentsCount: depNode?.direct_dependents ?? 0,
      indirectDependentsCount: depNode?.indirect_dependents ?? 0,
      hasUnitTests: hasTests,
      testsPassedAfterPatch: null,
      analyzerVerified: true,
    });

    const fixId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO suggested_fixes (id, bug_id, project_id, file_id, original_code, proposed_code, explanation, confidence_score, risk_score, risk_category, score_explanation, score_factors_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      fixId,
      bug.id,
      bug.project_id,
      file.id,
      file.content,
      aiPatch.proposedCode,
      aiPatch.explanation,
      scores.confidenceScore,
      scores.riskScore,
      scores.riskCategory,
      scores.scoreExplanation,
      JSON.stringify(scores.factors)
    );

    db.prepare('UPDATE detected_bugs SET root_cause = ?, prevention_tip = ?, related_concepts = ? WHERE id = ?').run(
      aiPatch.rootCause,
      aiPatch.preventionTip,
      JSON.stringify(aiPatch.relatedConcepts),
      bug.id
    );

    db.prepare(`
      INSERT INTO patch_audit_events (id, user_id, project_id, bug_id, fix_id, action, bug_category, risk_level, confidence_score, risk_score, original_code, proposed_code, accepted_code, test_summary)
      VALUES (?, ?, ?, ?, ?, 'patch_suggested', ?, ?, ?, ?, ?, ?, '', 'Awaiting Regression Guardian run')
    `).run(
      crypto.randomUUID(),
      userId,
      bug.project_id,
      bug.id,
      fixId,
      bug.category,
      scores.riskCategory,
      scores.confidenceScore,
      scores.riskScore,
      file.content,
      aiPatch.proposedCode
    );

    createAndEmitNotification(io, {
      userId,
      projectId: bug.project_id,
      type: 'patch_suggested',
      title: `AI Patch Ready: ${bug.title}`,
      message: `${bug.project_name} (${file.path}) · Confidence ${scores.confidenceScore}% · Risk ${scores.riskCategory}.`,
      linkPath: '/workbench',
    });

    const fix = db.prepare('SELECT * FROM suggested_fixes WHERE id = ?').get(fixId) as Record<string, unknown>;
    res.status(201).json({
      fix: {
        ...fix,
        scoreFactors: scores.factors,
      },
    });
  } catch (err: unknown) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to generate AI patch via Gemini.',
    });
  }
});

// FEATURE 2: Regression Guardian (isolated baseline vs patched sandbox execution)
app.post('/api/fixes/:fixId/regression-test', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const fix = db
    .prepare(`
      SELECT sf.*, b.file_path, b.category as bug_category, b.severity as bug_severity, b.title as bug_title, p.name as project_name
      FROM suggested_fixes sf
      JOIN detected_bugs b ON b.id = sf.bug_id
      JOIN projects p ON p.id = sf.project_id
      WHERE sf.id = ? AND p.user_id = ?
    `)
    .get(req.params.fixId, userId) as
    | {
        id: string;
        bug_id: string;
        project_id: string;
        file_path: string;
        original_code: string;
        proposed_code: string;
        bug_category: string;
        bug_severity: 'critical' | 'high' | 'medium' | 'low';
        bug_title: string;
        project_name: string;
      }
    | undefined;

  if (!fix) {
    res.status(404).json({ error: 'Suggested fix not found.' });
    return;
  }

  const candidateCode = typeof req.body?.proposedCode === 'string' && req.body.proposedCode.trim()
    ? req.body.proposedCode
    : fix.proposed_code;

  const projectFiles = db
    .prepare('SELECT path, content, language FROM uploaded_files WHERE project_id = ?')
    .all(fix.project_id) as Array<{ path: string; content: string; language: string }>;

  const report = await runRegressionGuardian(projectFiles, fix.file_path, candidateCode);

  const testResultId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO test_results (id, project_id, fix_id, run_type, status, total_tests, passed_tests, failed_tests, newly_failed_json, baseline_summary_json, output_log, duration_ms)
    VALUES (?, ?, ?, 'regression', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    testResultId,
    fix.project_id,
    fix.id,
    report.patched.status,
    report.patched.totalTests,
    report.patched.passedTests,
    report.patched.failedTests,
    JSON.stringify(report.newlyFailedTests),
    JSON.stringify({
      baseline: report.baseline,
      patched: report.patched,
      resolvedTests: report.resolvedTests,
      regressionDetected: report.regressionDetected,
      summary: report.summary,
    }),
    report.patched.outputLog,
    report.baseline.durationMs + report.patched.durationMs
  );

  // Recalculate Smart Fix Confidence & Change Risk incorporating REAL sandbox test results
  const depNode = db
    .prepare('SELECT direct_dependents, indirect_dependents FROM dependency_nodes WHERE project_id = ? AND file_path = ?')
    .get(fix.project_id, fix.file_path) as { direct_dependents: number; indirect_dependents: number } | undefined;

  const updatedScores = calculatePatchScores({
    bugCategory: fix.bug_category,
    bugSeverity: fix.bug_severity,
    originalCode: fix.original_code,
    proposedCode: candidateCode,
    filePath: fix.file_path,
    changedFilesCount: 1,
    directDependentsCount: depNode?.direct_dependents ?? 0,
    indirectDependentsCount: depNode?.indirect_dependents ?? 0,
    hasUnitTests: report.patched.executed,
    testsPassedAfterPatch: report.patched.executed ? !report.regressionDetected && report.patched.failedTests === 0 : null,
    newlyFailedTestsCount: report.newlyFailedTests.length,
    analyzerVerified: true,
  });

  db.prepare(`
    UPDATE suggested_fixes
    SET confidence_score = ?, risk_score = ?, risk_category = ?, score_explanation = ?, score_factors_json = ?
    WHERE id = ?
  `).run(
    updatedScores.confidenceScore,
    updatedScores.riskScore,
    updatedScores.riskCategory,
    updatedScores.scoreExplanation,
    JSON.stringify(updatedScores.factors),
    fix.id
  );

  db.prepare(`
    INSERT INTO patch_audit_events (id, user_id, project_id, bug_id, fix_id, action, bug_category, risk_level, confidence_score, risk_score, original_code, proposed_code, accepted_code, test_summary)
    VALUES (?, ?, ?, ?, ?, 'regression_tested', ?, ?, ?, ?, ?, ?, '', ?)
  `).run(
    crypto.randomUUID(),
    userId,
    fix.project_id,
    fix.bug_id,
    fix.id,
    fix.bug_category,
    updatedScores.riskCategory,
    updatedScores.confidenceScore,
    updatedScores.riskScore,
    fix.original_code,
    candidateCode,
    report.summary
  );

  createAndEmitNotification(io, {
    userId,
    projectId: fix.project_id,
    type: report.regressionDetected || report.patched.status === 'failed' ? 'tests_failed' : 'tests_passed',
    title: report.regressionDetected ? 'Regression Guardian: Failure Detected' : 'Regression Guardian: Verification Complete',
    message: `${fix.project_name}: ${report.summary}`,
    linkPath: '/regression',
  });

  res.json({
    testResultId,
    report,
    updatedScores,
  });
});

// Explicit user approval required to apply a patch; creates snapshot BEFORE modifying file
app.post('/api/fixes/:fixId/apply', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const fix = db
    .prepare(`
      SELECT sf.*, b.file_path, b.category as bug_category, b.title as bug_title, p.name as project_name
      FROM suggested_fixes sf
      JOIN detected_bugs b ON b.id = sf.bug_id
      JOIN projects p ON p.id = sf.project_id
      WHERE sf.id = ? AND p.user_id = ?
    `)
    .get(req.params.fixId, userId) as
    | {
        id: string;
        bug_id: string;
        project_id: string;
        file_id: string | null;
        file_path: string;
        original_code: string;
        proposed_code: string;
        confidence_score: number;
        risk_score: number;
        risk_category: string;
        bug_category: string;
        bug_title: string;
        project_name: string;
      }
    | undefined;

  if (!fix) {
    res.status(404).json({ error: 'Suggested fix not found.' });
    return;
  }

  const file = db
    .prepare('SELECT id, path, content FROM uploaded_files WHERE project_id = ? AND path = ?')
    .get(fix.project_id, fix.file_path) as { id: string; path: string; content: string } | undefined;
  if (!file) {
    res.status(404).json({ error: 'Target file no longer exists in project.' });
    return;
  }

  const acceptedCode =
    typeof req.body?.acceptedCode === 'string' && req.body.acceptedCode.trim()
      ? req.body.acceptedCode
      : fix.proposed_code;

  const snapshotId = crypto.randomUUID();
  const latestTest = db
    .prepare('SELECT status, passed_tests, total_tests FROM test_results WHERE fix_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(fix.id) as { status: string; passed_tests: number; total_tests: number } | undefined;

  const testSummary = latestTest
    ? `Sandbox ${latestTest.status} (${latestTest.passed_tests}/${latestTest.total_tests} tests)`
    : 'Applied after manual code review (no test run attached)';

  const tx = db.transaction(() => {
    // Save exact pre-patch file snapshot for safe One-Click Rollback
    db.prepare(`
      INSERT INTO patch_snapshots (id, project_id, user_id, fix_id, label, files_snapshot_json, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(
      snapshotId,
      fix.project_id,
      userId,
      fix.id,
      `Pre-patch: ${fix.bug_title} (${file.path})`,
      JSON.stringify([{ fileId: file.id, path: file.path, contentBefore: file.content, bugId: fix.bug_id }])
    );

    db.prepare(`
      UPDATE uploaded_files
      SET content = ?, size_bytes = ?, line_count = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(acceptedCode, Buffer.byteLength(acceptedCode, 'utf8'), acceptedCode.split('\n').length, file.id);

    db.prepare("UPDATE suggested_fixes SET status = 'accepted' WHERE id = ?").run(fix.id);
    db.prepare("UPDATE detected_bugs SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(fix.bug_id);

    db.prepare(`
      INSERT INTO patch_audit_events (id, user_id, project_id, bug_id, fix_id, action, bug_category, risk_level, confidence_score, risk_score, original_code, proposed_code, accepted_code, test_summary, metadata_json)
      VALUES (?, ?, ?, ?, ?, 'patch_applied', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      fix.project_id,
      fix.bug_id,
      fix.id,
      fix.bug_category,
      fix.risk_category,
      fix.confidence_score,
      fix.risk_score,
      file.content,
      fix.proposed_code,
      acceptedCode,
      testSummary,
      JSON.stringify({ snapshotId, filePath: file.path })
    );

    db.prepare(`
      INSERT INTO change_history (id, project_id, file_id, user_id, change_type, diff_summary)
      VALUES (?, ?, ?, ?, 'patch_applied', ?)
    `).run(crypto.randomUUID(), fix.project_id, file.id, userId, `Applied approved patch for "${fix.bug_title}"`);
  });
  tx();

  rebuildProjectDependencies(fix.project_id);
  const healthScore = recalculateProjectHealth(fix.project_id);

  createAndEmitNotification(io, {
    userId,
    projectId: fix.project_id,
    type: 'patch_applied',
    title: `Patch Applied: ${file.path}`,
    message: `${fix.project_name}: Resolved "${fix.bug_title}". Snapshot saved for one-click rollback.`,
    linkPath: '/audit',
  });

  res.json({ applied: true, snapshotId, healthScore });
});

app.post('/api/fixes/:fixId/reject', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const fix = db
    .prepare(`
      SELECT sf.*, b.category as bug_category
      FROM suggested_fixes sf
      JOIN detected_bugs b ON b.id = sf.bug_id
      JOIN projects p ON p.id = sf.project_id
      WHERE sf.id = ? AND p.user_id = ?
    `)
    .get(req.params.fixId, userId) as
    | {
        id: string;
        bug_id: string;
        project_id: string;
        original_code: string;
        proposed_code: string;
        confidence_score: number;
        risk_score: number;
        risk_category: string;
        bug_category: string;
      }
    | undefined;

  if (!fix) {
    res.status(404).json({ error: 'Fix not found.' });
    return;
  }

  db.prepare("UPDATE suggested_fixes SET status = 'rejected' WHERE id = ?").run(fix.id);
  db.prepare(`
    INSERT INTO patch_audit_events (id, user_id, project_id, bug_id, fix_id, action, bug_category, risk_level, confidence_score, risk_score, original_code, proposed_code, accepted_code, test_summary)
    VALUES (?, ?, ?, ?, ?, 'patch_rejected', ?, ?, ?, ?, ?, ?, '', 'Rejected by developer')
  `).run(
    crypto.randomUUID(),
    userId,
    fix.project_id,
    fix.bug_id,
    fix.id,
    fix.bug_category,
    fix.risk_category,
    fix.confidence_score,
    fix.risk_score,
    fix.original_code,
    fix.proposed_code
  );

  res.json({ rejected: true });
});

// FEATURE 6: One-Click Rollback
app.get('/api/projects/:projectId/snapshots', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT s.*
      FROM patch_snapshots s
      JOIN projects p ON p.id = s.project_id
      WHERE s.project_id = ? AND p.user_id = ?
      ORDER BY s.created_at DESC
    `)
    .all(req.params.projectId, req.user!.id) as Array<Record<string, unknown>>;

  const snapshots = rows.map((r) => ({
    ...r,
    files: JSON.parse(String(r.files_snapshot_json || '[]')),
  }));
  res.json({ snapshots });
});

app.post('/api/snapshots/:snapshotId/rollback', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const snapshot = db
    .prepare(`
      SELECT s.*, p.name as project_name
      FROM patch_snapshots s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = ? AND p.user_id = ?
    `)
    .get(req.params.snapshotId, userId) as
    | {
        id: string;
        project_id: string;
        fix_id: string | null;
        label: string;
        files_snapshot_json: string;
        status: string;
        project_name: string;
      }
    | undefined;

  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found.' });
    return;
  }

  const entries = JSON.parse(snapshot.files_snapshot_json || '[]') as Array<{
    fileId: string;
    path: string;
    contentBefore: string;
    bugId?: string;
  }>;

  const restoredPaths: string[] = [];

  const tx = db.transaction(() => {
    for (const entry of entries) {
      const current = db
        .prepare('SELECT id, content FROM uploaded_files WHERE project_id = ? AND path = ?')
        .get(snapshot.project_id, entry.path) as { id: string; content: string } | undefined;

      if (current) {
        db.prepare(`
          UPDATE uploaded_files
          SET content = ?, size_bytes = ?, line_count = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          entry.contentBefore,
          Buffer.byteLength(entry.contentBefore, 'utf8'),
          entry.contentBefore.split('\n').length,
          current.id
        );
        restoredPaths.push(entry.path);

        db.prepare(`
          INSERT INTO patch_audit_events (id, user_id, project_id, bug_id, fix_id, action, bug_category, risk_level, original_code, proposed_code, accepted_code, test_summary, metadata_json)
          VALUES (?, ?, ?, ?, ?, 'rollback', 'rollback', 'Low', ?, ?, ?, 'Restored pre-patch snapshot', ?)
        `).run(
          crypto.randomUUID(),
          userId,
          snapshot.project_id,
          entry.bugId ?? null,
          snapshot.fix_id,
          current.content,
          entry.contentBefore,
          entry.contentBefore,
          JSON.stringify({ snapshotId: snapshot.id, restoredPath: entry.path })
        );
      }
      if (entry.bugId) {
        db.prepare("UPDATE detected_bugs SET status = 'open', resolved_at = NULL WHERE id = ?").run(entry.bugId);
      }
    }

    if (snapshot.fix_id) {
      db.prepare("UPDATE suggested_fixes SET status = 'rolled_back' WHERE id = ?").run(snapshot.fix_id);
    }
    db.prepare("UPDATE patch_snapshots SET status = 'rolled_back' WHERE id = ?").run(snapshot.id);
  });
  tx();

  rebuildProjectDependencies(snapshot.project_id);
  const healthScore = recalculateProjectHealth(snapshot.project_id);

  createAndEmitNotification(io, {
    userId,
    projectId: snapshot.project_id,
    type: 'rollback_completed',
    title: `Rollback Completed: ${snapshot.project_name}`,
    message: `Restored ${restoredPaths.join(', ')} to pre-patch snapshot state. Audit trail preserved.`,
    linkPath: '/audit',
  });

  res.json({ rolledBack: true, restoredPaths, healthScore });
});

// ============================================================================
// FEATURE 3: CODE IMPACT RADAR
// ============================================================================
app.get('/api/projects/:projectId/impact', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const project = db
    .prepare('SELECT id, name FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.projectId, userId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const nodes = db
    .prepare(`
      SELECT n.*,
        (SELECT COUNT(*) FROM detected_bugs b WHERE b.project_id = n.project_id AND b.file_path = n.file_path AND b.status = 'open') as open_bugs
      FROM dependency_nodes n
      WHERE n.project_id = ?
    `)
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  const edges = db
    .prepare('SELECT * FROM dependency_edges WHERE project_id = ?')
    .all(req.params.projectId) as Array<Record<string, unknown>>;

  res.json({
    nodes: nodes.map((n) => ({
      ...n,
      exports: JSON.parse(String(n.exports_json || '[]')),
    })),
    edges: edges.map((e) => ({
      ...e,
      symbols: JSON.parse(String(e.symbols_json || '[]')),
    })),
  });
});

// ============================================================================
// FEATURES 4 & 5: BUG PATTERN INTELLIGENCE & LEARN FROM YOUR BUGS
// ============================================================================
app.get('/api/intelligence/patterns', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
  const filter = projectId ? 'AND b.project_id = ?' : '';
  const params = projectId ? [userId, projectId] : [userId];

  const byCategory = db
    .prepare(`
      SELECT b.category, COUNT(*) as count
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? ${filter}
      GROUP BY b.category
      ORDER BY count DESC
    `)
    .all(...params);

  const repeatedTitles = db
    .prepare(`
      SELECT b.title, b.category, b.severity, COUNT(*) as occurrences
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? ${filter}
      GROUP BY b.title, b.category, b.severity
      ORDER BY occurrences DESC
      LIMIT 10
    `)
    .all(...params);

  const hotFiles = db
    .prepare(`
      SELECT b.file_path as filePath, p.name as projectName, COUNT(*) as bugCount,
             SUM(CASE WHEN b.severity IN ('critical', 'high') THEN 1 ELSE 0 END) as severeCount
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? ${filter}
      GROUP BY b.file_path, p.name
      ORDER BY bugCount DESC
      LIMIT 10
    `)
    .all(...params);

  const timeline = db
    .prepare(`
      SELECT substr(b.created_at, 1, 10) as date,
             COUNT(*) as detected,
             SUM(CASE WHEN b.status = 'resolved' THEN 1 ELSE 0 END) as resolved
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? ${filter}
      GROUP BY substr(b.created_at, 1, 10)
      ORDER BY date ASC
    `)
    .all(...params);

  const commonCauses = db
    .prepare(`
      SELECT b.root_cause as rootCause, b.category, COUNT(*) as count
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ? AND b.root_cause != '' ${filter}
      GROUP BY b.root_cause, b.category
      ORDER BY count DESC
      LIMIT 6
    `)
    .all(...params);

  res.json({ byCategory, repeatedTitles, hotFiles, timeline, commonCauses });
});

app.post('/api/intelligence/recommendations', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const rows = db
    .prepare(`
      SELECT b.category, b.title, b.file_path, b.root_cause, COUNT(*) as c
      FROM detected_bugs b
      JOIN projects p ON p.id = b.project_id
      WHERE p.user_id = ?
      GROUP BY b.category, b.title, b.file_path, b.root_cause
      ORDER BY c DESC LIMIT 15
    `)
    .all(userId) as Array<{ category: string; title: string; file_path: string; root_cause: string; c: number }>;

  if (rows.length === 0) {
    res.json({ recommendations: ['Run your first project scan to unlock historical pattern-based prevention recommendations.'] });
    return;
  }

  const summary = rows
    .map((r) => `- [${r.category}] ${r.title} (${r.c}x in ${r.file_path}): ${r.root_cause}`)
    .join('\n');

  try {
    const recommendations = await generatePatternPreventionRecommendations(summary);
    res.json({ recommendations });
  } catch (err: unknown) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Unable to generate AI recommendations.' });
  }
});

app.get('/api/intelligence/learning', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
  const category = typeof req.query.category === 'string' && req.query.category && req.query.category !== 'all' ? req.query.category : null;
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;

  let sql = `
    SELECT b.id, b.project_id, p.name as project_name, b.file_path, b.category, b.severity,
           b.title, b.description, b.root_cause, b.code_snippet, b.prevention_tip,
           b.related_concepts, b.resolved_at,
           sf.original_code, sf.proposed_code, sf.explanation as fix_explanation
    FROM detected_bugs b
    JOIN projects p ON p.id = b.project_id
    LEFT JOIN suggested_fixes sf ON sf.bug_id = b.id AND sf.status = 'accepted'
    WHERE p.user_id = ? AND b.status = 'resolved'
  `;
  const params: unknown[] = [userId];
  if (projectId) {
    sql += ' AND b.project_id = ?';
    params.push(projectId);
  }
  if (category) {
    sql += ' AND b.category = ?';
    params.push(category);
  }
  if (q) {
    sql += ' AND (b.title LIKE ? OR b.root_cause LIKE ? OR b.prevention_tip LIKE ? OR b.file_path LIKE ?)';
    params.push(q, q, q, q);
  }
  sql += ' ORDER BY b.resolved_at DESC, b.created_at DESC';

  const items = (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    relatedConcepts: JSON.parse(String(row.related_concepts || '[]')),
  }));

  res.json({ lessons: items });
});

// ============================================================================
// FEATURE 7: ASK AUTOPATCH AI CHAT
// ============================================================================
app.get('/api/chat/conversations', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : null;
  const rows = projectId
    ? db
        .prepare('SELECT * FROM ai_conversations WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC')
        .all(userId, projectId)
    : db.prepare('SELECT * FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  res.json({ conversations: rows });
});

app.post('/api/chat/conversations', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const projectId = String(req.body.projectId || '');
  const title = String(req.body.title || 'New Debugging Session').slice(0, 120);

  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId);
  if (!project) {
    res.status(404).json({ error: 'Select a valid project to start a conversation.' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO ai_conversations (id, project_id, user_id, title) VALUES (?, ?, ?, ?)').run(
    id,
    projectId,
    userId,
    title
  );
  const conversation = db.prepare('SELECT * FROM ai_conversations WHERE id = ?').get(id);
  res.status(201).json({ conversation });
});

app.get('/api/chat/conversations/:conversationId/messages', requireAuth, (req: AuthedRequest, res) => {
  const conv = db
    .prepare('SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?')
    .get(req.params.conversationId, req.user!.id);
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }
  const messages = db
    .prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(req.params.conversationId);
  res.json({ messages });
});

app.post('/api/chat/conversations/:conversationId/messages', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const conv = db
    .prepare(`
      SELECT c.*, p.name as project_name
      FROM ai_conversations c
      JOIN projects p ON p.id = c.project_id
      WHERE c.id = ? AND c.user_id = ?
    `)
    .get(req.params.conversationId, userId) as
    | { id: string; project_id: string; project_name: string }
    | undefined;

  if (!conv) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }

  const content = String(req.body.content || '').trim();
  const contextFile = typeof req.body.contextFile === 'string' ? req.body.contextFile : undefined;
  const contextCode = typeof req.body.contextCode === 'string' ? req.body.contextCode : undefined;
  if (!content) {
    res.status(400).json({ error: 'Message content cannot be empty.' });
    return;
  }

  const userMsgId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO ai_messages (id, conversation_id, role, content, context_file, context_code)
    VALUES (?, ?, 'user', ?, ?, ?)
  `).run(userMsgId, conv.id, content, contextFile ?? null, contextCode ?? null);

  // Update conversation title on first message
  const msgCount = (db.prepare('SELECT COUNT(*) as c FROM ai_messages WHERE conversation_id = ?').get(conv.id) as { c: number }).c;
  if (msgCount === 1) {
    db.prepare("UPDATE ai_conversations SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
      content.slice(0, 72),
      conv.id
    );
  }

  const projectFiles = db
    .prepare('SELECT path, language, line_count FROM uploaded_files WHERE project_id = ?')
    .all(conv.project_id) as Array<{ path: string; language: string; line_count: number }>;

  const openBugs = db
    .prepare("SELECT file_path, line_number, severity, title, category FROM detected_bugs WHERE project_id = ? AND status = 'open' LIMIT 12")
    .all(conv.project_id) as Array<{ file_path: string; line_number: number; severity: string; title: string; category: string }>;

  const history = db
    .prepare('SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conv.id) as Array<{ role: 'user' | 'assistant'; content: string }>;

  try {
    const reply = await askAutoPatchChat({
      projectName: conv.project_name,
      projectFilesSummary: projectFiles.map((f) => `- ${f.path} (${f.language}, ${f.line_count} lines)`).join('\n') || 'No files uploaded yet.',
      openBugsSummary:
        openBugs.map((b) => `- [${b.severity.toUpperCase()}] ${b.title} (${b.file_path}:${b.line_number})`).join('\n') ||
        'No open bugs currently detected.',
      history: history.slice(0, -1),
      userMessage: content,
      contextFile,
      contextCode,
    });

    const assistantMsgId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO ai_messages (id, conversation_id, role, content)
      VALUES (?, ?, 'assistant', ?)
    `).run(assistantMsgId, conv.id, reply);

    db.prepare("UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?").run(conv.id);

    const userMessage = db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(userMsgId);
    const assistantMessage = db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(assistantMsgId);
    res.status(201).json({ userMessage, assistantMessage });
  } catch (err: unknown) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Ask AutoPatch failed to reach Gemini API.',
    });
  }
});

// ============================================================================
// FEATURE 9: WEBSITE DEBUGGER (with strict SSRF protection)
// ============================================================================
app.post('/api/tools/website-scan', requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const mode = req.body.mode === 'local_project' ? 'local_project' : 'remote_url';
  const projectId = typeof req.body.projectId === 'string' && req.body.projectId ? req.body.projectId : null;

  try {
    let report;
    if (mode === 'local_project') {
      if (!projectId) {
        res.status(400).json({ error: 'Select a project to audit local web files.' });
        return;
      }
      const proj = db.prepare('SELECT id, name FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as
        | { id: string; name: string }
        | undefined;
      if (!proj) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }
      const files = db
        .prepare('SELECT path, content, language FROM uploaded_files WHERE project_id = ?')
        .all(projectId) as Array<{ path: string; content: string; language: string }>;
      report = scanLocalProjectWebAssets(proj.name, files);
    } else {
      const targetUrl = String(req.body.url || '').trim();
      report = await scanRemoteWebsite(targetUrl);
    }

    const scanId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO website_scan_results (id, project_id, user_id, target_url, scan_mode, status, http_status, response_time_ms, payload_bytes, health_score, metrics_json, issues_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      scanId,
      projectId,
      userId,
      report.targetUrl,
      report.scanMode,
      report.status,
      report.httpStatus ?? null,
      report.responseTimeMs,
      report.payloadBytes,
      report.healthScore,
      JSON.stringify(report.metrics),
      JSON.stringify(report.issues)
    );

    res.status(201).json({ id: scanId, report });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Website scan failed.';
    const isBlocked = message.toLowerCase().includes('ssrf') || message.toLowerCase().includes('blocked');
    res.status(isBlocked ? 403 : 400).json({ error: message, ssrfBlocked: isBlocked });
  }
});

app.get('/api/tools/website-scans', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM website_scan_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 15')
    .all(req.user!.id) as Array<Record<string, unknown>>;

  res.json({
    scans: rows.map((r) => ({
      ...r,
      metrics: JSON.parse(String(r.metrics_json || '{}')),
      issues: JSON.parse(String(r.issues_json || '[]')),
    })),
  });
});

// ============================================================================
// FEATURE 10: MULTIMEDIA BUG DETECTION (ffprobe + magic bytes + AI semantic split)
// ============================================================================
app.post('/api/tools/multimedia-scan', requireAuth, mediaUpload.single('file'), async (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const file = req.file;
  const projectId = typeof req.body.projectId === 'string' && req.body.projectId ? req.body.projectId : null;
  const includeAiSemantics = req.body.includeAiSemantics === 'true';

  if (!file) {
    res.status(400).json({ error: 'Upload an image, audio, or video file to inspect.' });
    return;
  }

  const mediaType = classifyMediaMime(file.mimetype);
  if (!mediaType) {
    res.status(400).json({ error: `Unsupported or blocked MIME type "${file.mimetype}".` });
    return;
  }

  try {
    const technical = await inspectMultimediaBuffer(file.buffer, file.originalname, file.mimetype);
    let aiInterpretation: string | null = null;
    if (includeAiSemantics && mediaType === 'image' && technical.magicHeaderValid) {
      try {
        aiInterpretation = await analyzeImageSemanticsWithGemini(file.buffer, file.mimetype, file.originalname);
      } catch {
        aiInterpretation = null;
      }
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO multimedia_analysis (id, project_id, user_id, filename, media_type, mime_type, size_bytes, technical_checks_json, ai_interpretation, issues_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      userId,
      file.originalname,
      technical.mediaType,
      technical.mimeType,
      technical.sizeBytes,
      JSON.stringify({
        magicHeaderValid: technical.magicHeaderValid,
        ffprobeAvailable: technical.ffprobeAvailable,
        metadata: technical.metadata,
      }),
      aiInterpretation,
      JSON.stringify(technical.issues),
      technical.status
    );

    res.status(201).json({ id, technical, aiInterpretation });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Multimedia inspection failed.' });
  }
});

app.post('/api/tools/multimedia-scan-project', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const projectId = String(req.body.projectId || '');
  const proj = db.prepare('SELECT id, name FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId) as
    | { id: string; name: string }
    | undefined;
  if (!proj) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const files = db
    .prepare('SELECT path, content FROM uploaded_files WHERE project_id = ?')
    .all(projectId) as Array<{ path: string; content: string }>;

  const issues = scanProjectMultimediaReferences(files);
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO multimedia_analysis (id, project_id, user_id, filename, media_type, mime_type, size_bytes, technical_checks_json, ai_interpretation, issues_json, status)
    VALUES (?, ?, ?, ?, 'project_audit', 'text/plain', 0, ?, NULL, ?, ?)
  `).run(
    id,
    projectId,
    userId,
    `${proj.name} (Media References)`,
    JSON.stringify({ filesScanned: files.length }),
    JSON.stringify(issues),
    issues.length > 0 ? 'warning' : 'healthy'
  );

  res.status(201).json({ id, issues, filesScanned: files.length });
});

app.get('/api/tools/multimedia-scans', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM multimedia_analysis WHERE user_id = ? ORDER BY created_at DESC LIMIT 15')
    .all(req.user!.id) as Array<Record<string, unknown>>;

  res.json({
    scans: rows.map((r) => ({
      ...r,
      technicalChecks: JSON.parse(String(r.technical_checks_json || '{}')),
      issues: JSON.parse(String(r.issues_json || '[]')),
    })),
  });
});

// ============================================================================
// FEATURE 12: PATCH AUDIT TRAIL & CSV EXPORT
// ============================================================================
app.get('/api/audit', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  let sql = `
    SELECT a.*, p.name as project_name, u.name as user_name, u.email as user_email, b.title as bug_title, b.file_path
    FROM patch_audit_events a
    JOIN projects p ON p.id = a.project_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN detected_bugs b ON b.id = a.bug_id
    WHERE a.user_id = ?
  `;
  const params: unknown[] = [userId];

  if (req.query.projectId && req.query.projectId !== 'all') {
    sql += ' AND a.project_id = ?';
    params.push(String(req.query.projectId));
  }
  if (req.query.category && req.query.category !== 'all') {
    sql += ' AND a.bug_category = ?';
    params.push(String(req.query.category));
  }
  if (req.query.action && req.query.action !== 'all') {
    sql += ' AND a.action = ?';
    params.push(String(req.query.action));
  }
  if (req.query.riskLevel && req.query.riskLevel !== 'all') {
    sql += ' AND a.risk_level = ?';
    params.push(String(req.query.riskLevel));
  }
  if (req.query.from) {
    sql += ' AND a.created_at >= ?';
    params.push(String(req.query.from));
  }
  if (req.query.to) {
    sql += ' AND a.created_at <= ?';
    params.push(`${String(req.query.to)}T23:59:59`);
  }

  sql += ' ORDER BY a.created_at DESC LIMIT 200';
  const events = db.prepare(sql).all(...params);
  res.json({ events });
});

app.get('/api/audit/export/csv', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT a.created_at, p.name as project_name, u.email as user_email, a.action,
             a.bug_category, a.risk_level, a.confidence_score, a.risk_score, a.test_summary
      FROM patch_audit_events a
      JOIN projects p ON p.id = a.project_id
      JOIN users u ON u.id = a.user_id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC
    `)
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const headers = ['Timestamp', 'Project', 'User', 'Action', 'Bug Category', 'Risk Level', 'Confidence', 'Risk Score', 'Test Summary'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvLines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.created_at,
        r.project_name,
        r.user_email,
        r.action,
        r.bug_category,
        r.risk_level,
        r.confidence_score,
        r.risk_score,
        r.test_summary,
      ]
        .map(esc)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="autopatch-audit-trail.csv"');
  res.send(csvLines.join('\n'));
});

// ============================================================================
// FEATURE 11: NOTIFICATIONS
// ============================================================================
app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
  const userId = req.user!.id;
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
    .all(userId) as Array<Record<string, unknown>>;
  const unreadCount = rows.filter((r) => r.is_read === 0).length;
  res.json({
    unreadCount,
    notifications: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      projectId: r.project_id,
      type: r.type,
      title: r.title,
      message: r.message,
      linkPath: r.link_path,
      isRead: r.is_read === 1,
      createdAt: r.created_at,
    })),
  });
});

app.patch('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
  res.json({ updated: true });
});

app.patch('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ updated: true });
});

// ============================================================================
// REGRESSION TEST HISTORY
// ============================================================================
app.get('/api/projects/:projectId/test-results', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT tr.*, b.title as bug_title, b.file_path
      FROM test_results tr
      JOIN projects p ON p.id = tr.project_id
      LEFT JOIN suggested_fixes sf ON sf.id = tr.fix_id
      LEFT JOIN detected_bugs b ON b.id = sf.bug_id
      WHERE tr.project_id = ? AND p.user_id = ?
      ORDER BY tr.created_at DESC
      LIMIT 30
    `)
    .all(req.params.projectId, req.user!.id) as Array<Record<string, unknown>>;

  res.json({
    testResults: rows.map((r) => ({
      ...r,
      newlyFailed: JSON.parse(String(r.newly_failed_json || '[]')),
      baselineComparison: JSON.parse(String(r.baseline_summary_json || '{}')),
    })),
  });
});

// Express error handler (never leaks raw stack traces to clients)
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[AutoPatch Server Error]', err);
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `File upload limit exceeded: ${err.message}` });
    return;
  }
  res.status(500).json({ error: 'An internal server error occurred.' });
});

// ============================================================================
// VITE DEV MIDDLEWARE / PRODUCTION STATIC HOSTING ON PORT 3000
// ============================================================================
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AutoPatch AI Command Centre server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start AutoPatch AI server:', err);
  process.exit(1);
});
