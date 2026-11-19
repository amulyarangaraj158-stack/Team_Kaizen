import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SAMPLE_PROJECTS } from './samples.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'autopatch.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

export function detectLanguageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cc': 'cpp',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.json': 'json',
    '.sql': 'sql',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.cs': 'csharp',
    '.md': 'markdown',
  };
  return map[ext] || 'plaintext';
}

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Software Engineer',
      bio TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      primary_language TEXT NOT NULL DEFAULT 'Unknown',
      languages_json TEXT NOT NULL DEFAULT '[]',
      total_files INTEGER NOT NULL DEFAULT 0,
      total_lines INTEGER NOT NULL DEFAULT 0,
      health_status TEXT NOT NULL DEFAULT 'unscanned' CHECK (health_status IN ('healthy','warning','critical','unscanned')),
      last_scan_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      language TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      line_count INTEGER NOT NULL,
      original_content TEXT NOT NULL,
      current_content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, file_path)
    );

    CREATE TABLE IF NOT EXISTS scan_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
      model_used TEXT NOT NULL,
      files_scanned INTEGER NOT NULL DEFAULT 0,
      bugs_found INTEGER NOT NULL DEFAULT 0,
      critical_count INTEGER NOT NULL DEFAULT 0,
      high_count INTEGER NOT NULL DEFAULT 0,
      medium_count INTEGER NOT NULL DEFAULT 0,
      low_count INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS detected_bugs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scan_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
      impact_score INTEGER NOT NULL,
      confidence INTEGER NOT NULL,
      priority_score INTEGER NOT NULL,
      description TEXT NOT NULL,
      why_occurred TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      potential_impact TEXT NOT NULL,
      suggested_solution TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','patch_generated','patched','verified','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (scan_id) REFERENCES scan_history(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS suggested_fixes (
      id TEXT PRIMARY KEY,
      bug_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      original_code TEXT NOT NULL,
      patched_code TEXT NOT NULL,
      explanation TEXT NOT NULL,
      confidence INTEGER NOT NULL,
      risks_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','rolled_back')),
      applied_by_user_id TEXT,
      applied_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (bug_id) REFERENCES detected_bugs(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE,
      FOREIGN KEY (applied_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      bug_id TEXT NOT NULL,
      fix_id TEXT,
      phase TEXT NOT NULL CHECK (phase IN ('before','after')),
      execution_mode TEXT NOT NULL CHECK (execution_mode IN ('isolated_vm','static_validation')),
      total_tests INTEGER NOT NULL,
      passed_tests INTEGER NOT NULL,
      failed_tests INTEGER NOT NULL,
      regression_detected INTEGER NOT NULL DEFAULT 0,
      validation_status TEXT NOT NULL CHECK (validation_status IN ('passed','failed','static_verified','error')),
      summary TEXT NOT NULL,
      cases_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (bug_id) REFERENCES detected_bugs(id) ON DELETE CASCADE,
      FOREIGN KEY (fix_id) REFERENCES suggested_fixes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS change_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      bug_id TEXT,
      fix_id TEXT,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('patch_accepted','patch_rejected','rollback')),
      before_content TEXT NOT NULL,
      after_content TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS learning_insights (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      concept_title TEXT NOT NULL,
      mistake_category TEXT NOT NULL,
      frequency_count INTEGER NOT NULL DEFAULT 1,
      why_it_happens TEXT NOT NULL,
      explanation TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','practicing','mastered')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'standard',
      selected_context_json TEXT,
      referenced_bugs_json TEXT DEFAULT '[]',
      referenced_files_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS website_scans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      url TEXT NOT NULL,
      final_url TEXT,
      status TEXT NOT NULL CHECK (status IN ('completed','failed','auth_required')),
      http_status INTEGER,
      ttfb_ms INTEGER,
      total_ms INTEGER,
      html_bytes INTEGER,
      embed_allowed INTEGER NOT NULL DEFAULT 1,
      embed_block_reason TEXT,
      issues_count INTEGER NOT NULL DEFAULT 0,
      critical_count INTEGER NOT NULL DEFAULT 0,
      high_count INTEGER NOT NULL DEFAULT 0,
      medium_count INTEGER NOT NULL DEFAULT 0,
      low_count INTEGER NOT NULL DEFAULT 0,
      metrics_json TEXT NOT NULL DEFAULT '{}',
      issues_json TEXT NOT NULL DEFAULT '[]',
      assets_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS multimedia_scans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      media_type TEXT NOT NULL CHECK (media_type IN ('image','video','audio')),
      file_name TEXT NOT NULL,
      detected_format TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('completed','failed')),
      issues_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      issues_json TEXT NOT NULL DEFAULT '[]',
      ai_assessment_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patch_audit_events (
      id TEXT PRIMARY KEY,
      patch_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      bug_id TEXT,
      file_id TEXT,
      file_path TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'bug_detected','patch_generated','patch_reviewed','patch_accepted',
        'patch_rejected','tests_executed','patch_verified','rollback_executed'
      )),
      decision_status TEXT NOT NULL DEFAULT 'pending',
      confidence_score INTEGER,
      risk_score INTEGER,
      test_status TEXT DEFAULT 'not_run',
      rollback_status TEXT DEFAULT 'none',
      original_code TEXT,
      proposed_code TEXT,
      modified_code TEXT,
      test_results_json TEXT,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_files_project ON uploaded_files(project_id);
    CREATE INDEX IF NOT EXISTS idx_scans_project ON scan_history(project_id);
    CREATE INDEX IF NOT EXISTS idx_bugs_project ON detected_bugs(project_id);
    CREATE INDEX IF NOT EXISTS idx_bugs_status ON detected_bugs(status);
    CREATE INDEX IF NOT EXISTS idx_fixes_bug ON suggested_fixes(bug_id);
    CREATE INDEX IF NOT EXISTS idx_tests_bug ON test_results(bug_id);
    CREATE INDEX IF NOT EXISTS idx_changes_project ON change_history(project_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_ai_conv_user_proj ON ai_conversations(user_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_web_scans_user ON website_scans(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_media_scans_user ON multimedia_scans(user_id, media_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_patch_audit_proj ON patch_audit_events(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_patch_audit_patch ON patch_audit_events(patch_id, created_at);
  `);

  // Backward-compatible migrations for existing notifications table
  const notifCols = (db.prepare(`PRAGMA table_info(notifications)`).all() as Array<{ name: string }>).map((c) => c.name);
  if (!notifCols.includes('action_module')) {
    db.exec(`ALTER TABLE notifications ADD COLUMN action_module TEXT DEFAULT 'dashboard'`);
  }
  if (!notifCols.includes('project_name')) {
    db.exec(`ALTER TABLE notifications ADD COLUMN project_name TEXT DEFAULT ''`);
  }
  if (!notifCols.includes('event_key')) {
    db.exec(`ALTER TABLE notifications ADD COLUMN event_key TEXT`);
  }

  seedDemoAccountIfNeeded();
  backfillPatchAuditEventsIfNeeded();
}

export function appendPatchAuditEvent(params: {
  patchId: string;
  projectId: string;
  bugId?: string | null;
  fileId?: string | null;
  filePath: string;
  userId: string;
  eventType:
    | 'bug_detected'
    | 'patch_generated'
    | 'patch_reviewed'
    | 'patch_accepted'
    | 'patch_rejected'
    | 'tests_executed'
    | 'patch_verified'
    | 'rollback_executed';
  decisionStatus?: string;
  confidenceScore?: number | null;
  riskScore?: number | null;
  testStatus?: string;
  rollbackStatus?: string;
  originalCode?: string | null;
  proposedCode?: string | null;
  modifiedCode?: string | null;
  testResultsJson?: string | null;
  summary: string;
  createdAt?: string;
}): string {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO patch_audit_events (
      id, patch_id, project_id, bug_id, file_id, file_path, user_id, event_type,
      decision_status, confidence_score, risk_score, test_status, rollback_status,
      original_code, proposed_code, modified_code, test_results_json, summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(
    id,
    params.patchId,
    params.projectId,
    params.bugId ?? null,
    params.fileId ?? null,
    params.filePath,
    params.userId,
    params.eventType,
    params.decisionStatus ?? 'pending',
    params.confidenceScore ?? null,
    params.riskScore ?? null,
    params.testStatus ?? 'not_run',
    params.rollbackStatus ?? 'none',
    params.originalCode ?? null,
    params.proposedCode ?? null,
    params.modifiedCode ?? null,
    params.testResultsJson ?? null,
    params.summary,
    params.createdAt ?? null
  );
  return id;
}

function backfillPatchAuditEventsIfNeeded(): void {
  const existingCount = (db.prepare(`SELECT COUNT(*) as c FROM patch_audit_events`).get() as { c: number }).c;
  if (existingCount > 0) return;

  // Backfill from existing detected_bugs and suggested_fixes so existing databases immediately show traceable history
  const bugs = db
    .prepare(
      `SELECT b.*, p.user_id as owner_id
       FROM detected_bugs b
       JOIN projects p ON p.id = b.project_id
       ORDER BY b.created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;

  for (const b of bugs) {
    appendPatchAuditEvent({
      patchId: `bug-${String(b.id).slice(0, 8)}`,
      projectId: String(b.project_id),
      bugId: String(b.id),
      fileId: String(b.file_id),
      filePath: String(b.file_path),
      userId: String(b.owner_id),
      eventType: 'bug_detected',
      decisionStatus: String(b.status || 'open'),
      confidenceScore: Number(b.confidence || 0),
      riskScore: Number(b.impact_score || 0),
      summary: `Detected [${String(b.severity).toUpperCase()}] ${b.title} at lines ${b.line_start}-${b.line_end}`,
      createdAt: String(b.created_at),
    });
  }

  const fixes = db
    .prepare(
      `SELECT sf.*, b.title as bug_title, b.file_path, b.created_at as bug_created_at, p.user_id as owner_id
       FROM suggested_fixes sf
       JOIN detected_bugs b ON b.id = sf.bug_id
       JOIN projects p ON p.id = sf.project_id
       ORDER BY sf.created_at ASC`
    )
    .all() as Array<Record<string, unknown>>;

  for (const fx of fixes) {
    const risks = JSON.parse(String(fx.risks_json || '[]')) as string[];
    const riskScore = Math.min(100, Math.max(10, risks.length * 22));
    appendPatchAuditEvent({
      patchId: String(fx.id),
      projectId: String(fx.project_id),
      bugId: String(fx.bug_id),
      fileId: String(fx.file_id),
      filePath: String(fx.file_path),
      userId: String(fx.applied_by_user_id || fx.owner_id),
      eventType: 'patch_generated',
      decisionStatus: String(fx.status),
      confidenceScore: Number(fx.confidence),
      riskScore,
      originalCode: String(fx.original_code),
      proposedCode: String(fx.patched_code),
      summary: `AI generated suggested patch for "${fx.bug_title}" (${fx.confidence}% confidence)`,
      createdAt: String(fx.created_at),
    });

    if (fx.status === 'accepted' || fx.status === 'rejected') {
      appendPatchAuditEvent({
        patchId: String(fx.id),
        projectId: String(fx.project_id),
        bugId: String(fx.bug_id),
        fileId: String(fx.file_id),
        filePath: String(fx.file_path),
        userId: String(fx.applied_by_user_id || fx.owner_id),
        eventType: fx.status === 'accepted' ? 'patch_accepted' : 'patch_rejected',
        decisionStatus: String(fx.status),
        confidenceScore: Number(fx.confidence),
        riskScore,
        originalCode: String(fx.original_code),
        proposedCode: String(fx.patched_code),
        modifiedCode: fx.status === 'accepted' ? String(fx.patched_code) : String(fx.original_code),
        summary: `Developer ${fx.status} patch for "${fx.bug_title}"`,
        createdAt: String(fx.applied_at || fx.created_at),
      });
    }
  }
}

export function createProjectWithFiles(
  userId: string,
  name: string,
  description: string,
  files: Array<{ filePath: string; content: string }>
): { projectId: string; fileIds: Record<string, string> } {
  const projectId = crypto.randomUUID();
  const langCounts: Record<string, number> = {};
  let totalLines = 0;

  for (const f of files) {
    const lang = detectLanguageFromPath(f.filePath);
    if (lang !== 'plaintext' && lang !== 'markdown' && lang !== 'json') {
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
    totalLines += f.content.split('\n').length;
  }

  const languages = Object.keys(langCounts).sort((a, b) => langCounts[b] - langCounts[a]);
  const primaryLanguage = languages[0] || detectLanguageFromPath(files[0]?.filePath || '') || 'Unknown';

  db.prepare(
    `INSERT INTO projects (id, user_id, name, description, primary_language, languages_json, total_files, total_lines, health_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unscanned')`
  ).run(projectId, userId, name, description, primaryLanguage, JSON.stringify(languages.length ? languages : [primaryLanguage]), files.length, totalLines);

  const fileIds: Record<string, string> = {};
  const insertFile = db.prepare(
    `INSERT INTO uploaded_files (id, project_id, file_path, file_name, language, size_bytes, line_count, original_content, current_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const f of files) {
    const fid = crypto.randomUUID();
    const cleanPath = f.filePath.replace(/^\/+/, '');
    const fileName = path.basename(cleanPath);
    const lang = detectLanguageFromPath(cleanPath);
    const sizeBytes = Buffer.byteLength(f.content, 'utf8');
    const lineCount = f.content.split('\n').length;
    insertFile.run(fid, projectId, cleanPath, fileName, lang, sizeBytes, lineCount, f.content, f.content);
    fileIds[cleanPath] = fid;
  }

  return { projectId, fileIds };
}

export function recalcProjectHealth(projectId: string): void {
  const counts = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status IN ('open','patch_generated') AND severity = 'critical' THEN 1 ELSE 0 END) as open_crit,
        SUM(CASE WHEN status IN ('open','patch_generated') AND severity = 'high' THEN 1 ELSE 0 END) as open_high,
        SUM(CASE WHEN status IN ('open','patch_generated') THEN 1 ELSE 0 END) as open_total,
        COUNT(*) as all_bugs
      FROM detected_bugs WHERE project_id = ?`
    )
    .get(projectId) as { open_crit: number | null; open_high: number | null; open_total: number | null; all_bugs: number };

  const scanCount = (
    db.prepare(`SELECT COUNT(*) as c FROM scan_history WHERE project_id = ? AND status = 'completed'`).get(projectId) as { c: number }
  ).c;

  let health: 'healthy' | 'warning' | 'critical' | 'unscanned' = 'unscanned';
  if (scanCount > 0) {
    if ((counts.open_crit || 0) > 0) health = 'critical';
    else if ((counts.open_high || 0) > 0 || (counts.open_total || 0) > 0) health = 'warning';
    else health = 'healthy';
  }

  db.prepare(`UPDATE projects SET health_status = ?, updated_at = datetime('now') WHERE id = ?`).run(health, projectId);
}

function seedDemoAccountIfNeeded(): void {
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get('demo@autopatch.dev') as { id: string } | undefined;
  if (existing) return;

  const userId = crypto.randomUUID();
  const { hash, salt } = hashPassword('DemoPass123!');
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, password_salt, role, bio)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    'Alex Rivera',
    'demo@autopatch.dev',
    hash,
    salt,
    'Lead Reliability Engineer',
    'Focused on automated static analysis, safe patch verification, and eliminating runtime regressions.'
  );

  // Seed Sample Project 1: CommerceCart Core (JS) with an initial scan
  const jsSample = SAMPLE_PROJECTS.javascript;
  const { projectId: jsProjectId, fileIds: jsFiles } = createProjectWithFiles(
    userId,
    jsSample.name,
    jsSample.description,
    jsSample.files
  );

  const scan1Id = crypto.randomUUID();
  const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  const oneDayAgo = new Date(Date.now() - 1 * 86400_000).toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    `INSERT INTO scan_history (id, project_id, user_id, status, model_used, files_scanned, bugs_found, critical_count, high_count, medium_count, low_count, duration_ms, created_at)
     VALUES (?, ?, ?, 'completed', 'gemini-4-hydrogen', 3, 3, 1, 1, 1, 0, 2180, ?)`
  ).run(scan1Id, jsProjectId, userId, twoDaysAgo);

  db.prepare(`UPDATE projects SET last_scan_at = ? WHERE id = ?`).run(twoDaysAgo, jsProjectId);

  const bug1Id = crypto.randomUUID();
  const bug2Id = crypto.randomUUID();
  const bug3Id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO detected_bugs (id, project_id, scan_id, file_id, file_path, line_start, line_end, title, category, severity, impact_score, confidence, priority_score, description, why_occurred, root_cause, potential_impact, suggested_solution, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bug1Id,
    jsProjectId,
    scan1Id,
    jsFiles['src/coupons.js'],
    'src/coupons.js',
    13,
    16,
    'Arbitrary Code Execution via eval() in Custom Promo Rule Parser',
    'Security Vulnerability',
    'critical',
    98,
    99,
    98,
    'parseCustomRule() directly passes untrusted expression strings into JavaScript eval(), enabling arbitrary code execution.',
    'Dynamic rule evaluation was implemented with eval() instead of a safe allowlisted parser.',
    'Direct invocation of eval(expression) executes arbitrary JavaScript with full runtime privileges.',
    'Attackers crafting malicious promotional rule payloads can execute arbitrary commands, exfiltrate secrets, or corrupt server state.',
    'Replace eval() with a strict declarative allowlist parser or JSON-based rule schema evaluator.',
    'open',
    twoDaysAgo
  );

  db.prepare(
    `INSERT INTO detected_bugs (id, project_id, scan_id, file_id, file_path, line_start, line_end, title, category, severity, impact_score, confidence, priority_score, description, why_occurred, root_cause, potential_impact, suggested_solution, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bug2Id,
    jsProjectId,
    scan1Id,
    jsFiles['src/pricing.js'],
    'src/pricing.js',
    5,
    8,
    'Off-by-One Loop Boundary Throws TypeError on Undefined Cart Item',
    'Runtime Error',
    'high',
    92,
    97,
    90,
    'The for-loop condition i <= items.length reads one index past the end of the items array, causing item.price to throw a TypeError.',
    'Inclusive <= comparison was used instead of strict < when iterating zero-indexed array elements.',
    'At i === items.length, items[i] evaluates to undefined and dereferencing item.price crashes checkout.',
    'Every checkout calculation fails unconditionally with an uncaught TypeError, blocking order placement.',
    'Change the loop condition from i <= items.length to i < items.length and guard against non-array input.',
    'open',
    twoDaysAgo
  );

  db.prepare(
    `INSERT INTO detected_bugs (id, project_id, scan_id, file_id, file_path, line_start, line_end, title, category, severity, impact_score, confidence, priority_score, description, why_occurred, root_cause, potential_impact, suggested_solution, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bug3Id,
    jsProjectId,
    scan1Id,
    jsFiles['src/checkout.js'],
    'src/checkout.js',
    16,
    18,
    'Unguarded Division by Zero in splitPayment Installment Calculator',
    'Edge-Case Error',
    'medium',
    76,
    95,
    74,
    'splitPayment(total, installments) divides total by installments without verifying that installments is a positive integer.',
    'Missing input validation on the divisor parameter.',
    'Passing 0 or negative values yields Infinity, NaN, or negative billing installments.',
    'Malformed checkout requests can produce Infinity totals or corrupted billing schedules.',
    'Validate that installments is a positive finite number (>= 1) and throw a RangeError otherwise.',
    'open',
    twoDaysAgo
  );

  recalcProjectHealth(jsProjectId);

  // Seed Sample Project 2: LedgerPulse Analytics (Python)
  const pySample = SAMPLE_PROJECTS.python;
  const { projectId: pyProjectId, fileIds: pyFiles } = createProjectWithFiles(
    userId,
    pySample.name,
    pySample.description,
    pySample.files
  );

  const scan2Id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO scan_history (id, project_id, user_id, status, model_used, files_scanned, bugs_found, critical_count, high_count, medium_count, low_count, duration_ms, created_at)
     VALUES (?, ?, ?, 'completed', 'gemini-4-hydrogen', 3, 2, 1, 1, 0, 0, 1940, ?)`
  ).run(scan2Id, pyProjectId, userId, oneDayAgo);

  db.prepare(`UPDATE projects SET last_scan_at = ? WHERE id = ?`).run(oneDayAgo, pyProjectId);

  const pyBug1Id = crypto.randomUUID();
  const pyBug2Id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO detected_bugs (id, project_id, scan_id, file_id, file_path, line_start, line_end, title, category, severity, impact_score, confidence, priority_score, description, why_occurred, root_cause, potential_impact, suggested_solution, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    pyBug1Id,
    pyProjectId,
    scan2Id,
    pyFiles['ledger/repository.py'],
    'ledger/repository.py',
    1,
    3,
    'SQL Injection via Unsanitized f-String Interpolation in build_account_query',
    'Security Vulnerability',
    'critical',
    97,
    99,
    97,
    'account_id and status are interpolated directly into a raw SQL string using an f-string.',
    'Query string concatenation was used instead of parameterized placeholders.',
    'Single quotes or SQL clauses in account_id break out of the literal and alter the SQL AST.',
    'Unauthorized callers can bypass account filters, dump financial records, or modify database rows.',
    'Return a parameterized query tuple (sql, params) using ? or %s placeholders.',
    'open',
    oneDayAgo
  );

  db.prepare(
    `INSERT INTO detected_bugs (id, project_id, scan_id, file_id, file_path, line_start, line_end, title, category, severity, impact_score, confidence, priority_score, description, why_occurred, root_cause, potential_impact, suggested_solution, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    pyBug2Id,
    pyProjectId,
    scan2Id,
    pyFiles['ledger/metrics.py'],
    'ledger/metrics.py',
    3,
    6,
    'ZeroDivisionError When Normalized Transaction List Is Empty',
    'Runtime Error',
    'high',
    85,
    96,
    84,
    'compute_average_spend divides total by len(clean) without handling empty or filtered-out transaction lists.',
    'The function assumes at least one valid positive transaction exists after normalization.',
    'When transactions is empty or all amounts are negative, len(clean) is 0, raising ZeroDivisionError.',
    'Batch financial reporting jobs crash on accounts with zero qualifying transactions.',
    'Check if not clean and return 0.0 before dividing.',
    'open',
    oneDayAgo
  );

  recalcProjectHealth(pyProjectId);

  // Seed initial learning insights tied to the real detected bugs
  db.prepare(
    `INSERT INTO learning_insights (id, user_id, project_id, concept_title, mistake_category, frequency_count, why_it_happens, explanation, recommendation, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    userId,
    jsProjectId,
    'Safe Input Evaluation & Parameterization',
    'Security Vulnerability',
    2,
    'Interpolating untrusted input into eval() or raw SQL strings mixes executable instructions with user data.',
    'Always separate code/query structure from untrusted values. Use parameterized SQL statements and explicit rule parsers instead of dynamic evaluation.',
    'Review src/coupons.js and ledger/repository.py to replace dynamic string execution with structured parameter binding.',
    'active'
  );

  db.prepare(
    `INSERT INTO learning_insights (id, user_id, project_id, concept_title, mistake_category, frequency_count, why_it_happens, explanation, recommendation, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    userId,
    jsProjectId,
    'Boundary Conditions & Zero-Length Guards',
    'Runtime Error',
    3,
    'Loop upper bounds and divisors are common sources of crashes when inputs hit 0 or array boundaries.',
    'Zero-indexed arrays end at length - 1, so loops should use i < arr.length. Divisions should always verify divisor !== 0 before computing.',
    'Add boundary unit tests (empty arrays, zero divisors, negative values) in Test Guardian for every calculation helper.',
    'practicing'
  );

  db.prepare(
    `INSERT INTO notifications (id, user_id, project_id, type, title, message, is_read)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(
    crypto.randomUUID(),
    userId,
    jsProjectId,
    'warning',
    'Initial Scan Completed: CommerceCart Core (JS)',
    '3 defects detected (1 critical, 1 high, 1 medium). Open Scanner & RCA or Repair & Diff to review and patch safely.'
  );
}
