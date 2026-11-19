import type { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { db, appendPatchAuditEvent } from './db.ts';
import { chatWithAutoPatchAI, analyzeMediaWithGeminiAI } from './gemini.ts';
import { LANGUAGE_CAPABILITIES, runLanguageDiagnosticsForFiles } from './languages.ts';
import { analyzePublicWebsite, type WebsiteIssue, type ProbedAsset } from './website.ts';
import {
  inspectImageBuffer,
  inspectVideoBuffer,
  inspectAudioBuffer,
  auditProjectMediaReferences,
  type MediaInspectionResult,
} from './multimedia.ts';

export interface RouteAuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  bio: string;
  created_at: string;
}

export interface RouteAuthedRequest extends Request {
  user?: RouteAuthUser;
  sessionToken?: string;
}

export interface NotificationOptions {
  actionModule?: string;
  projectName?: string;
  eventKey?: string;
}

export interface AdvancedRouteDeps {
  requireAuth: (req: RouteAuthedRequest, res: Response, next: NextFunction) => void;
  assertProjectOwner: (projectId: string, userId: string) => Record<string, unknown> | null;
  createNotification: (
    userId: string,
    projectId: string | null,
    type: string,
    title: string,
    message: string,
    opts?: NotificationOptions
  ) => void;
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB cap

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_MEDIA_BYTES,
    files: 1,
  },
});

function normalizeLanguageKey(lang: string): string {
  const key = (lang || '').toLowerCase().trim();
  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    'c++': 'cpp',
    'c#': 'csharp',
    cs: 'csharp',
    scss: 'css',
    htm: 'html',
  };
  return aliases[key] || key || 'plaintext';
}

function detectMediaTypeFromUpload(
  fileName: string,
  mimeType: string,
  requestedType?: string
): 'image' | 'video' | 'audio' | null {
  if (requestedType === 'image' || requestedType === 'video' || requestedType === 'audio') {
    return requestedType;
  }
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  const ext = path.extname(fileName || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus'].includes(ext)) return 'audio';
  return null;
}

function csvEscape(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function mapLanguageCapabilitiesForClient() {
  return LANGUAGE_CAPABILITIES.map((c) => ({
    id: c.id,
    name: c.label,
    extensions: c.extensions,
    syntaxCheck:
      c.syntaxCheck.includes('esbuild') ||
      c.syntaxCheck.includes('python3') ||
      c.syntaxCheck.includes('gcc') ||
      c.syntaxCheck.includes('g++') ||
      c.syntaxCheck.includes('Cheerio') ||
      c.syntaxCheck.includes('JSON.parse')
        ? ('compiler_parser' as const)
        : ('structural_parser' as const),
    syntaxEngine: c.syntaxCheck,
    staticAnalysis: true,
    aiReview: true,
    isolatedExecution: c.runtimeAvailable && (c.id === 'javascript' || c.id === 'typescript'),
    executionNotes: `${c.staticAnalysis}. ${c.testExecution}.`,
    commonDefectClasses: c.commonBugClasses,
  }));
}

function mapWebsiteCategory(cat: WebsiteIssue['category']): 'functional' | 'performance' | 'responsive' | 'accessibility' | 'seo' {
  switch (cat) {
    case 'Functional':
      return 'functional';
    case 'Performance':
      return 'performance';
    case 'Responsive Design':
      return 'responsive';
    case 'Accessibility':
      return 'accessibility';
    case 'SEO & Structure':
    default:
      return 'seo';
  }
}

function formatWebsiteScanRow(row: Record<string, unknown>) {
  const rawIssues = JSON.parse(String(row.issues_json || '[]')) as WebsiteIssue[];
  const rawAssets = JSON.parse(String(row.assets_json || '[]')) as ProbedAsset[];
  const rawMetrics = JSON.parse(String(row.metrics_json || '{}')) as Record<string, unknown>;

  const issues = rawIssues.map((iss) => ({
    id: iss.id,
    category: mapWebsiteCategory(iss.category),
    severity: iss.severity,
    title: iss.title,
    description: iss.explanation,
    evidence: iss.technicalEvidence,
    recommendation: iss.suggestedCorrection,
  }));

  const categoryCounts = {
    functional: issues.filter((i) => i.category === 'functional').length,
    performance: issues.filter((i) => i.category === 'performance').length,
    responsive: issues.filter((i) => i.category === 'responsive').length,
    accessibility: issues.filter((i) => i.category === 'accessibility').length,
    seo: issues.filter((i) => i.category === 'seo').length,
  };

  const assets = rawAssets.map((a) => ({
    url: a.url,
    kind: a.type === 'video' || a.type === 'audio' ? ('media' as const) : a.type,
    status: a.status,
    ok: a.ok,
    contentType: a.contentType || null,
    contentLength: a.sizeBytes ?? null,
    latencyMs: a.durationMs ?? 0,
    error: a.error,
  }));

  const missingAltCount = issues.filter((i) => i.title.toLowerCase().includes('alt')).length;
  const renderBlockingCount = issues.filter((i) => i.title.toLowerCase().includes('render-blocking')).length;
  const headingCounts = (rawMetrics.headingCounts || {}) as Record<string, number>;

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    url: String(row.url),
    final_url: String(row.final_url || row.url),
    status: String(row.status) as 'completed' | 'auth_required' | 'failed',
    http_status: row.http_status !== null && row.http_status !== undefined ? Number(row.http_status) : null,
    response_time_ms: Number(row.ttfb_ms ?? row.total_ms ?? 0),
    page_title: String(rawMetrics.pageTitle || ''),
    embed_allowed: Boolean(row.embed_allowed),
    embed_block_reason: row.embed_block_reason ? String(row.embed_block_reason) : null,
    auth_required: String(row.status) === 'auth_required',
    analysis_mode: String(rawMetrics.analysisMethod || 'Live SSRF-Guarded HTTP + Cheerio DOM + Asset Probe'),
    total_issues: Number(row.issues_count ?? issues.length),
    category_counts: categoryCounts,
    metrics: {
      htmlSizeBytes: Number(row.html_bytes || 0),
      redirectCount: 0,
      contentType: 'text/html',
      serverHeader: null,
      totalImages: Number(rawMetrics.totalImages || 0),
      imagesMissingAlt: missingAltCount,
      totalScripts: Number(rawMetrics.totalScripts || 0),
      renderBlockingScripts: renderBlockingCount,
      totalStylesheets: Number(rawMetrics.totalStylesheets || 0),
      totalLinks: Number(rawMetrics.totalLinks || 0),
      probedAssetsCount: Number(rawMetrics.probedAssetsCount || assets.length),
      brokenAssetsCount: Number(rawMetrics.brokenResourcesCount || assets.filter((a) => !a.ok).length),
      hasViewportMeta: Boolean(rawMetrics.hasViewport),
      hasH1: Number(headingCounts.h1 || 0) > 0,
      hasMetaDescription: Boolean(rawMetrics.metaDescription),
      hasCanonical: !issues.some((i) => i.title.toLowerCase().includes('canonical')),
      hasLangAttr: Boolean(rawMetrics.hasLang),
    },
    issues,
    assets,
    created_at: String(row.created_at),
  };
}

function formatMultimediaScanRow(row: Record<string, unknown>) {
  const rawIssues = JSON.parse(String(row.issues_json || '[]')) as Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    title: string;
    explanation?: string;
    detail?: string;
    recommendation: string;
    evidence?: string;
  }>;

  const issues = rawIssues.map((iss) => ({
    severity: iss.severity,
    category: iss.category,
    title: iss.title,
    detail: iss.detail || [iss.explanation, iss.evidence ? `(${iss.evidence})` : ''].filter(Boolean).join(' '),
    recommendation: iss.recommendation,
  }));

  const mediaType = String(row.media_type) as 'image' | 'video' | 'audio';
  const technicalEngine =
    mediaType === 'image'
      ? 'Magic-Byte + Sharp Binary Decoder'
      : mediaType === 'video'
        ? 'FFprobe Container & Stream Analyzer'
        : 'FFprobe + FFmpeg Volume/Clipping Analyzer';

  const rawStatus = String(row.status);
  const clientStatus: 'passed' | 'warnings' | 'failed' =
    rawStatus === 'failed' ? 'failed' : issues.length > 0 ? 'warnings' : 'passed';

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    project_id: row.project_id ? String(row.project_id) : null,
    media_type: mediaType,
    file_name: String(row.file_name),
    mime_type: String(row.mime_type),
    size_bytes: Number(row.size_bytes),
    status: clientStatus,
    technical_engine: technicalEngine,
    metadata: JSON.parse(String(row.metadata_json || '{}')),
    issues,
    ai_assessment: row.ai_assessment_json ? JSON.parse(String(row.ai_assessment_json)) : null,
    created_at: String(row.created_at),
  };
}

export function registerAdvancedRoutes(app: Express, deps: AdvancedRouteDeps): void {
  const { requireAuth, assertProjectOwner, createNotification } = deps;

  // ============================================================================
  // 1. AI DEBUGGING CHAT ("ASK AUTOPATCH")
  // ============================================================================

  app.get('/api/projects/:projectId/conversations', requireAuth, (req: RouteAuthedRequest, res) => {
    const projectId = String(req.params.projectId);
    if (!assertProjectOwner(projectId, req.user!.id)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const rows = db
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM ai_messages m WHERE m.conversation_id = c.id) as message_count,
          (SELECT m.content FROM ai_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) as last_message_preview,
          (SELECT m.mode FROM ai_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) as last_mode
         FROM ai_conversations c
         WHERE c.project_id = ? AND c.user_id = ?
         ORDER BY c.updated_at DESC`
      )
      .all(projectId, req.user!.id) as Array<Record<string, unknown>>;

    const conversations = rows.map((r) => ({
      id: String(r.id),
      project_id: String(r.project_id),
      user_id: String(r.user_id),
      title: String(r.title),
      explanation_mode: r.last_mode === 'advanced' ? 'advanced' : 'beginner',
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      message_count: Number(r.message_count || 0),
      last_message_preview: r.last_message_preview ? String(r.last_message_preview) : null,
    }));

    res.json({ conversations });
  });

  app.post('/api/projects/:projectId/conversations', requireAuth, (req: RouteAuthedRequest, res) => {
    const projectId = String(req.params.projectId);
    const proj = assertProjectOwner(projectId, req.user!.id);
    if (!proj) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const title = String(req.body?.title || `Debugging Session · ${proj.name}`).trim().slice(0, 120);
    const mode = req.body?.explanationMode === 'advanced' ? 'advanced' : 'beginner';
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO ai_conversations (id, project_id, user_id, title)
       VALUES (?, ?, ?, ?)`
    ).run(id, projectId, req.user!.id, title);

    const row = db.prepare(`SELECT * FROM ai_conversations WHERE id = ?`).get(id) as Record<string, unknown>;
    res.status(201).json({
      conversation: {
        ...row,
        explanation_mode: mode,
        message_count: 0,
        last_message_preview: null,
      },
    });
  });

  app.delete('/api/conversations/:conversationId', requireAuth, (req: RouteAuthedRequest, res) => {
    const conversationId = String(req.params.conversationId);
    const existing = db
      .prepare(`SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?`)
      .get(conversationId, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    db.prepare(`DELETE FROM ai_conversations WHERE id = ?`).run(conversationId);
    res.json({ ok: true });
  });

  app.get('/api/conversations/:conversationId/messages', requireAuth, (req: RouteAuthedRequest, res) => {
    const conversationId = String(req.params.conversationId);
    const convo = db
      .prepare(`SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?`)
      .get(conversationId, req.user!.id) as Record<string, unknown> | undefined;

    if (!convo) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const rows = db
      .prepare(`SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`)
      .all(conversationId) as Array<Record<string, unknown>>;

    const messages = rows.map((r) => {
      const ctx = r.selected_context_json ? (JSON.parse(String(r.selected_context_json)) as Record<string, unknown>) : null;
      const followUps = ctx && Array.isArray(ctx._followUps) ? (ctx._followUps as string[]) : [];
      const codeContext = ctx && ctx.filePath ? ctx : null;
      return {
        id: String(r.id),
        conversation_id: String(r.conversation_id),
        role: String(r.role) as 'user' | 'assistant',
        content: String(r.content),
        code_context: codeContext,
        referenced_bug_ids: JSON.parse(String(r.referenced_bugs_json || '[]')),
        referenced_files: JSON.parse(String(r.referenced_files_json || '[]')),
        follow_up_suggestions: followUps,
        created_at: String(r.created_at),
      };
    });

    const lastMode = rows.length > 0 && rows[rows.length - 1].mode === 'advanced' ? 'advanced' : 'beginner';
    res.json({
      conversation: { ...convo, explanation_mode: lastMode },
      messages,
    });
  });

  app.post('/api/conversations/:conversationId/messages', requireAuth, async (req: RouteAuthedRequest, res) => {
    try {
      const conversationId = String(req.params.conversationId);
      const convo = db
        .prepare(`SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?`)
        .get(conversationId, req.user!.id) as Record<string, unknown> | undefined;

      if (!convo) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      const projectId = String(convo.project_id);
      const proj = assertProjectOwner(projectId, req.user!.id);
      if (!proj) {
        res.status(404).json({ error: 'Associated project not found.' });
        return;
      }

      const content = String(req.body?.content || '').trim();
      if (!content) {
        res.status(400).json({ error: 'Message content cannot be empty.' });
        return;
      }

      const explanationMode: 'beginner' | 'advanced' =
        req.body?.explanationMode === 'advanced' ? 'advanced' : 'beginner';

      const selectedSnippet = req.body?.selectedSnippet
        ? {
            filePath: String(req.body.selectedSnippet.filePath || ''),
            lineStart: Math.max(1, Number(req.body.selectedSnippet.lineStart) || 1),
            lineEnd: Math.max(1, Number(req.body.selectedSnippet.lineEnd) || 1),
            code: String(req.body.selectedSnippet.code || '').slice(0, 5000),
          }
        : null;

      const files = db
        .prepare(`SELECT file_path, language, current_content FROM uploaded_files WHERE project_id = ? ORDER BY file_path ASC`)
        .all(projectId) as Array<{ file_path: string; language: string; current_content: string }>;

      const bugs = db
        .prepare(
          `SELECT id, title, file_path, line_start, line_end, severity, status, category, root_cause, suggested_solution
           FROM detected_bugs WHERE project_id = ? ORDER BY priority_score DESC`
        )
        .all(projectId) as Array<Record<string, unknown>>;

      const fixes = db
        .prepare(
          `SELECT sf.id, sf.bug_id, b.file_path, sf.status, sf.confidence, sf.explanation, sf.risks_json
           FROM suggested_fixes sf
           JOIN detected_bugs b ON b.id = sf.bug_id
           WHERE sf.project_id = ?
           ORDER BY sf.created_at DESC LIMIT 15`
        )
        .all(projectId) as Array<Record<string, unknown>>;

      const tests = db
        .prepare(
          `SELECT bug_id, phase, validation_status, passed_tests, total_tests, regression_detected, summary
           FROM test_results WHERE project_id = ? ORDER BY created_at DESC LIMIT 12`
        )
        .all(projectId) as Array<Record<string, unknown>>;

      const historyRows = db
        .prepare(`SELECT role, content FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`)
        .all(conversationId) as Array<{ role: 'user' | 'assistant'; content: string }>;

      const userMsgId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO ai_messages (id, conversation_id, role, content, mode, selected_context_json)
         VALUES (?, ?, 'user', ?, ?, ?)`
      ).run(userMsgId, conversationId, content, explanationMode, selectedSnippet ? JSON.stringify(selectedSnippet) : null);

      if (historyRows.length === 0) {
        const autoTitle = content.length > 62 ? `${content.slice(0, 59)}...` : content;
        db.prepare(`UPDATE ai_conversations SET title = ?, updated_at = datetime('now') WHERE id = ?`).run(
          autoTitle,
          conversationId
        );
      } else {
        db.prepare(`UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?`).run(conversationId);
      }

      const aiReply = await chatWithAutoPatchAI({
        projectName: String(proj.name),
        explanationMode,
        userMessage: content,
        selectedSnippet,
        files: files.map((f) => ({
          filePath: f.file_path,
          language: f.language,
          content: f.current_content,
        })),
        bugs: bugs.map((b) => ({
          id: String(b.id),
          title: String(b.title),
          filePath: String(b.file_path),
          lineStart: Number(b.line_start),
          lineEnd: Number(b.line_end),
          severity: String(b.severity),
          status: String(b.status),
          category: String(b.category),
          rootCause: String(b.root_cause),
          suggestedSolution: String(b.suggested_solution),
        })),
        fixes: fixes.map((f) => ({
          id: String(f.id),
          bugId: String(f.bug_id),
          filePath: String(f.file_path),
          status: String(f.status),
          confidence: Number(f.confidence),
          explanation: String(f.explanation),
          risks: JSON.parse(String(f.risks_json || '[]')),
        })),
        tests: tests.map((t) => ({
          bugId: String(t.bug_id),
          phase: String(t.phase),
          validationStatus: String(t.validation_status),
          passedTests: Number(t.passed_tests),
          totalTests: Number(t.total_tests),
          regressionDetected: Boolean(t.regression_detected),
          summary: String(t.summary),
        })),
        history: historyRows,
      });

      const assistantMsgId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO ai_messages (
          id, conversation_id, role, content, mode, selected_context_json,
          referenced_bugs_json, referenced_files_json
        ) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`
      ).run(
        assistantMsgId,
        conversationId,
        aiReply.answer,
        explanationMode,
        JSON.stringify({ _followUps: aiReply.followUpSuggestions }),
        JSON.stringify(aiReply.referencedBugIds),
        JSON.stringify(aiReply.referencedFiles)
      );

      db.prepare(`UPDATE ai_conversations SET updated_at = datetime('now') WHERE id = ?`).run(conversationId);

      const userRow = db.prepare(`SELECT * FROM ai_messages WHERE id = ?`).get(userMsgId) as Record<string, unknown>;
      const assistantRow = db.prepare(`SELECT * FROM ai_messages WHERE id = ?`).get(assistantMsgId) as Record<string, unknown>;

      res.status(201).json({
        userMessage: {
          id: String(userRow.id),
          conversation_id: String(userRow.conversation_id),
          role: 'user',
          content: String(userRow.content),
          code_context: selectedSnippet,
          referenced_bug_ids: [],
          referenced_files: [],
          follow_up_suggestions: [],
          created_at: String(userRow.created_at),
        },
        assistantMessage: {
          id: String(assistantRow.id),
          conversation_id: String(assistantRow.conversation_id),
          role: 'assistant',
          content: String(assistantRow.content),
          code_context: null,
          referenced_bug_ids: aiReply.referencedBugIds,
          referenced_files: aiReply.referencedFiles,
          follow_up_suggestions: aiReply.followUpSuggestions,
          created_at: String(assistantRow.created_at),
        },
      });
    } catch (err: unknown) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Ask AutoPatch failed to generate a response.',
      });
    }
  });

  // ============================================================================
  // 2. MULTI-LANGUAGE INTELLIGENCE
  // ============================================================================

  app.get('/api/languages/capabilities', requireAuth, (_req: RouteAuthedRequest, res) => {
    res.json({ capabilities: mapLanguageCapabilitiesForClient() });
  });

  app.get('/api/projects/:projectId/languages', requireAuth, (req: RouteAuthedRequest, res) => {
    const projectId = String(req.params.projectId);
    if (!assertProjectOwner(projectId, req.user!.id)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const files = db
      .prepare(`SELECT id, file_path, file_name, language, line_count, size_bytes FROM uploaded_files WHERE project_id = ?`)
      .all(projectId) as Array<{
        id: string;
        file_path: string;
        file_name: string;
        language: string;
        line_count: number;
        size_bytes: number;
      }>;

    const bugs = db
      .prepare(
        `SELECT b.id, b.severity, b.status, f.language
         FROM detected_bugs b
         JOIN uploaded_files f ON f.id = b.file_id
         WHERE b.project_id = ?`
      )
      .all(projectId) as Array<{ id: string; severity: string; status: string; language: string }>;

    interface LangAcc {
      language: string;
      fileCount: number;
      totalLines: number;
      totalBytes: number;
      bugCount: number;
      openBugs: number;
      files: Array<{ id: string; filePath: string; lineCount: number }>;
    }

    const byLang = new Map<string, LangAcc>();

    for (const f of files) {
      const lang = normalizeLanguageKey(f.language);
      let entry = byLang.get(lang);
      if (!entry) {
        entry = {
          language: lang,
          fileCount: 0,
          totalLines: 0,
          totalBytes: 0,
          bugCount: 0,
          openBugs: 0,
          files: [],
        };
        byLang.set(lang, entry);
      }
      entry.fileCount++;
      entry.totalLines += f.line_count;
      entry.totalBytes += f.size_bytes;
      entry.files.push({ id: f.id, filePath: f.file_path, lineCount: f.line_count });
    }

    for (const b of bugs) {
      const lang = normalizeLanguageKey(b.language);
      const entry = byLang.get(lang);
      if (entry) {
        entry.bugCount++;
        if (b.status === 'open' || b.status === 'patch_generated') entry.openBugs++;
      }
    }

    const capabilities = mapLanguageCapabilitiesForClient();
    const capMap = new Map(capabilities.map((c) => [c.id, c]));
    const breakdown = Array.from(byLang.values())
      .map((item) => ({
        ...item,
        capability: capMap.get(item.language) || null,
      }))
      .sort((a, b) => b.fileCount - a.fileCount);

    res.json({
      totalFiles: files.length,
      detectedLanguagesCount: breakdown.length,
      breakdown,
      capabilities,
    });
  });

  app.post('/api/projects/:projectId/languages/analyze', requireAuth, async (req: RouteAuthedRequest, res) => {
    try {
      const projectId = String(req.params.projectId);
      const proj = assertProjectOwner(projectId, req.user!.id);
      if (!proj) {
        res.status(404).json({ error: 'Project not found.' });
        return;
      }

      const filterLang = req.body?.language ? normalizeLanguageKey(String(req.body.language)) : null;

      const files = db
        .prepare(`SELECT id, file_path, language, current_content FROM uploaded_files WHERE project_id = ? ORDER BY file_path ASC`)
        .all(projectId) as Array<{ id: string; file_path: string; language: string; current_content: string }>;

      const filtered = filterLang
        ? files.filter((f) => normalizeLanguageKey(f.language) === filterLang)
        : files;

      const fileIdByPath = new Map(filtered.map((f) => [f.file_path, f.id]));
      const rawReport = await runLanguageDiagnosticsForFiles(
        filtered.map((f) => ({
          file_path: f.file_path,
          language: f.language,
          current_content: f.current_content,
        }))
      );

      const diagnostics = rawReport.diagnostics.map((d) => ({
        fileId: fileIdByPath.get(d.filePath) || '',
        filePath: d.filePath,
        language: normalizeLanguageKey(d.language),
        line: d.line,
        severity:
          d.severity === 'critical'
            ? ('error' as const)
            : d.severity === 'high' || d.severity === 'medium'
              ? ('warning' as const)
              : ('info' as const),
        source: d.checkType === 'syntax' ? ('syntax_engine' as const) : ('static_rule' as const),
        engine: d.tool,
        code: `${d.language.toUpperCase()}_${d.checkType.toUpperCase()}`,
        message: d.message,
      }));

      const summary = {
        errors: diagnostics.filter((d) => d.severity === 'error').length,
        warnings: diagnostics.filter((d) => d.severity === 'warning').length,
        infos: diagnostics.filter((d) => d.severity === 'info').length,
      };
      const languagesChecked = Array.from(new Set(filtered.map((f) => normalizeLanguageKey(f.language))));

      createNotification(
        req.user!.id,
        projectId,
        summary.errors > 0 ? 'warning' : 'success',
        `Multi-Language Diagnostics: ${proj.name}`,
        `Checked ${filtered.length} file(s) across ${languagesChecked.length} language(s): ${summary.errors} error(s), ${summary.warnings} warning(s).`,
        {
          actionModule: 'languages',
          projectName: String(proj.name),
          eventKey: `lang-diag:${projectId}:${filterLang || 'all'}`,
        }
      );

      res.json({
        filesAnalyzed: filtered.length,
        languagesChecked,
        syntaxEnginesUsed: rawReport.syntaxEnginesUsed,
        diagnostics,
        summary,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Multi-language diagnostic analysis failed.' });
    }
  });

  // ============================================================================
  // 3. WEBSITE DEBUGGING ("WEBSITE DEBUGGER")
  // ============================================================================

  app.get('/api/website-scans', requireAuth, (req: RouteAuthedRequest, res) => {
    const rows = db
      .prepare(`SELECT * FROM website_scans WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`)
      .all(req.user!.id) as Array<Record<string, unknown>>;

    res.json({ scans: rows.map(formatWebsiteScanRow) });
  });

  app.post('/api/website-scans', requireAuth, async (req: RouteAuthedRequest, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Please enter a website URL to start debugging.' });
      return;
    }

    const scanId = crypto.randomUUID();
    try {
      const result = await analyzePublicWebsite(rawUrl);

      const crit = result.issues.filter((i) => i.severity === 'critical').length;
      const high = result.issues.filter((i) => i.severity === 'high').length;
      const med = result.issues.filter((i) => i.severity === 'medium').length;
      const low = result.issues.filter((i) => i.severity === 'low').length;

      db.prepare(
        `INSERT INTO website_scans (
          id, user_id, url, final_url, status, http_status, ttfb_ms, total_ms, html_bytes,
          embed_allowed, embed_block_reason, issues_count, critical_count, high_count, medium_count, low_count,
          metrics_json, issues_json, assets_json, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scanId,
        req.user!.id,
        result.url,
        result.finalUrl,
        result.status,
        result.httpStatus,
        result.ttfbMs,
        result.totalMs,
        result.htmlBytes,
        result.embedAllowed ? 1 : 0,
        result.embedBlockReason,
        result.issues.length,
        crit,
        high,
        med,
        low,
        JSON.stringify(result.metrics),
        JSON.stringify(result.issues),
        JSON.stringify(result.assets),
        result.errorMessage || null
      );

      let hostLabel = result.finalUrl;
      try {
        hostLabel = new URL(result.finalUrl).hostname;
      } catch {
        // keep full URL
      }

      const authRequired = result.status === 'auth_required';
      createNotification(
        req.user!.id,
        null,
        authRequired ? 'warning' : result.issues.length > 0 ? 'warning' : 'success',
        `Website Scan Completed: ${hostLabel}`,
        authRequired
          ? `HTTP ${result.httpStatus} authentication wall detected. Public page inspection completed without bypassing login.`
          : `Inspected live HTML & ${result.assets.length} asset(s) in ${result.ttfbMs}ms. Detected ${result.issues.length} issue(s).`,
        {
          actionModule: 'website',
          projectName: hostLabel,
          eventKey: `website-scan:${scanId}`,
        }
      );

      const saved = db.prepare(`SELECT * FROM website_scans WHERE id = ?`).get(scanId) as Record<string, unknown>;
      res.status(201).json({ scan: formatWebsiteScanRow(saved) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Website scan failed.';
      createNotification(req.user!.id, null, 'error', 'Website Scan Blocked or Failed', msg, {
        actionModule: 'website',
        projectName: rawUrl.slice(0, 60),
        eventKey: `website-scan-err:${Date.now()}`,
      });
      res.status(400).json({ error: msg });
    }
  });

  app.delete('/api/website-scans/:scanId', requireAuth, (req: RouteAuthedRequest, res) => {
    const scanId = String(req.params.scanId);
    const result = db.prepare(`DELETE FROM website_scans WHERE id = ? AND user_id = ?`).run(scanId, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Website scan record not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // ============================================================================
  // 4. AUDIO, VIDEO & IMAGE BUG DETECTION ("MULTIMEDIA DEBUGGER")
  // ============================================================================

  app.get('/api/multimedia-scans', requireAuth, (req: RouteAuthedRequest, res) => {
    const mediaType = req.query.mediaType ? String(req.query.mediaType) : null;
    const rows = (
      mediaType && ['image', 'video', 'audio'].includes(mediaType)
        ? db
            .prepare(`SELECT * FROM multimedia_scans WHERE user_id = ? AND media_type = ? ORDER BY created_at DESC LIMIT 40`)
            .all(req.user!.id, mediaType)
        : db.prepare(`SELECT * FROM multimedia_scans WHERE user_id = ? ORDER BY created_at DESC LIMIT 40`).all(req.user!.id)
    ) as Array<Record<string, unknown>>;

    res.json({ scans: rows.map(formatMultimediaScanRow) });
  });

  app.post('/api/multimedia-scans/upload', requireAuth, mediaUpload.single('file'), async (req: RouteAuthedRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Please select an image, video, or audio file to analyze.' });
        return;
      }

      const requestedType = req.body?.mediaType ? String(req.body.mediaType).toLowerCase() : undefined;
      const includeAiAssessment =
        req.body?.includeAiAssessment === 'true' || req.body?.includeAiAssessment === true;
      const projectId = req.body?.projectId ? String(req.body.projectId) : null;

      if (projectId && !assertProjectOwner(projectId, req.user!.id)) {
        res.status(404).json({ error: 'Selected project not found.' });
        return;
      }

      const mediaType = detectMediaTypeFromUpload(file.originalname, file.mimetype, requestedType);
      if (!mediaType) {
        res.status(400).json({
          error: 'Unsupported media file type. Supported: PNG, JPG, WebP, GIF, SVG, MP4, WebM, MOV, MP3, WAV, OGG, AAC, M4A.',
        });
        return;
      }

      let technical: MediaInspectionResult;
      if (mediaType === 'image') {
        technical = await inspectImageBuffer(file.originalname, file.buffer);
      } else if (mediaType === 'video') {
        technical = await inspectVideoBuffer(file.originalname, file.buffer);
      } else {
        technical = await inspectAudioBuffer(file.originalname, file.buffer);
      }

      let aiAssessment: Record<string, unknown> | null = null;
      let aiAssessmentError: string | null = null;

      if (includeAiAssessment) {
        const ext = path.extname(file.originalname).toLowerCase();
        if (mediaType === 'image') {
          const supportedImgMime: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
          };
          const mime = supportedImgMime[ext];
          if (!mime) {
            aiAssessmentError = 'Gemini AI visual assessment supports raster PNG, JPEG, and WebP images (SVG/GIF inspected technically only).';
          } else if (file.size > 4 * 1024 * 1024) {
            aiAssessmentError = 'File exceeds 4 MB limit for optional Gemini AI visual assessment. Technical validation completed.';
          } else if (technical.status === 'failed') {
            aiAssessmentError = 'Skipped Gemini AI visual assessment because the file failed binary decoding.';
          } else {
            try {
              const resAi = await analyzeMediaWithGeminiAI({
                mediaType: 'image',
                mimeType: mime,
                base64Data: file.buffer.toString('base64'),
                fileName: file.originalname,
                technicalMetadata: technical.metadata,
              });
              aiAssessment = resAi as unknown as Record<string, unknown>;
            } catch (err: unknown) {
              aiAssessmentError = err instanceof Error ? err.message : 'Gemini AI image assessment failed.';
            }
          }
        } else if (mediaType === 'audio') {
          const supportedAudioMime: Record<string, string> = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.aac': 'audio/aac',
            '.m4a': 'audio/mp4',
          };
          const mime = supportedAudioMime[ext];
          if (!mime) {
            aiAssessmentError = 'Gemini AI audio assessment supports MP3, WAV, OGG, AAC, and M4A files.';
          } else if (file.size > 6 * 1024 * 1024) {
            aiAssessmentError = 'File exceeds 6 MB limit for optional Gemini AI audio assessment. Technical ffprobe/ffmpeg inspection completed.';
          } else if (technical.status === 'failed') {
            aiAssessmentError = 'Skipped Gemini AI audio assessment because the file failed ffprobe decoding.';
          } else {
            try {
              const resAi = await analyzeMediaWithGeminiAI({
                mediaType: 'audio',
                mimeType: mime,
                base64Data: file.buffer.toString('base64'),
                fileName: file.originalname,
                technicalMetadata: technical.metadata,
              });
              aiAssessment = resAi as unknown as Record<string, unknown>;
            } catch (err: unknown) {
              aiAssessmentError = err instanceof Error ? err.message : 'Gemini AI audio assessment failed.';
            }
          }
        } else {
          aiAssessmentError = 'Video files are validated with deterministic ffprobe container, codec, bitrate, resolution, and audio-track inspection.';
        }
      }

      const scanId = crypto.randomUUID();
      const persistedAi = aiAssessment
        ? aiAssessment
        : aiAssessmentError
          ? { note: aiAssessmentError, unavailable: true }
          : null;

      db.prepare(
        `INSERT INTO multimedia_scans (
          id, user_id, project_id, media_type, file_name, detected_format, mime_type, size_bytes,
          status, issues_count, metadata_json, issues_json, ai_assessment_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scanId,
        req.user!.id,
        projectId,
        mediaType,
        file.originalname,
        technical.detectedFormat,
        technical.mimeType || file.mimetype || 'application/octet-stream',
        file.size,
        technical.status,
        technical.issues.length,
        JSON.stringify(technical.metadata),
        JSON.stringify(technical.issues),
        persistedAi ? JSON.stringify(persistedAi) : null
      );

      createNotification(
        req.user!.id,
        projectId,
        technical.status === 'failed' ? 'error' : technical.issues.length > 0 ? 'warning' : 'success',
        `Multimedia Scan Completed: ${file.originalname}`,
        `${mediaType.toUpperCase()} (${technical.detectedFormat.toUpperCase()}) inspected. ${technical.issues.length} technical finding(s).`,
        {
          actionModule: 'multimedia',
          projectName: file.originalname,
          eventKey: `media-scan:${scanId}`,
        }
      );

      const saved = db.prepare(`SELECT * FROM multimedia_scans WHERE id = ?`).get(scanId) as Record<string, unknown>;
      res.status(201).json({ scan: formatMultimediaScanRow(saved) });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Multimedia inspection failed.' });
    }
  });

  app.get('/api/projects/:projectId/media-audit', requireAuth, (req: RouteAuthedRequest, res) => {
    const projectId = String(req.params.projectId);
    if (!assertProjectOwner(projectId, req.user!.id)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const files = db
      .prepare(`SELECT file_path, language, current_content FROM uploaded_files WHERE project_id = ?`)
      .all(projectId) as Array<{ file_path: string; language: string; current_content: string }>;

    const audit = auditProjectMediaReferences(files);

    res.json({
      filesScanned: files.length,
      totalReferences: audit.totalReferences,
      issues: audit.issues.map((iss) => ({
        ...iss,
        line: 1,
      })),
    });
  });

  app.delete('/api/multimedia-scans/:scanId', requireAuth, (req: RouteAuthedRequest, res) => {
    const scanId = String(req.params.scanId);
    const result = db.prepare(`DELETE FROM multimedia_scans WHERE id = ? AND user_id = ?`).run(scanId, req.user!.id);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Multimedia scan record not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // ============================================================================
  // 5. ENHANCED NOTIFICATIONS
  // ============================================================================

  app.patch('/api/notifications/:notificationId/read', requireAuth, (req: RouteAuthedRequest, res) => {
    const notificationId = String(req.params.notificationId);
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(notificationId, req.user!.id);
    res.json({ ok: true });
  });

  app.delete('/api/notifications', requireAuth, (req: RouteAuthedRequest, res) => {
    db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(req.user!.id);
    res.json({ ok: true });
  });

  app.post('/api/notifications/report-generated', requireAuth, (req: RouteAuthedRequest, res) => {
    const projectId = req.body?.projectId ? String(req.body.projectId) : null;
    const reportType = String(req.body?.reportType || 'PDF Engineering Report').trim();
    const projectName = String(req.body?.projectName || 'Workspace').trim();

    createNotification(
      req.user!.id,
      projectId,
      'success',
      `Report Exported: ${reportType}`,
      `Generated ${reportType} for ${projectName}.`,
      {
        actionModule: projectId ? 'reports' : 'audit',
        projectName,
        eventKey: `report:${projectId || 'global'}:${reportType}:${Math.floor(Date.now() / 15000)}`,
      }
    );

    res.json({ ok: true });
  });

  // ============================================================================
  // 6. PATCH AUDIT TRAIL (APPEND-ONLY)
  // ============================================================================

  app.post('/api/fixes/:fixId/review', requireAuth, (req: RouteAuthedRequest, res) => {
    const fixId = String(req.params.fixId);
    const fix = db
      .prepare(
        `SELECT sf.*, p.user_id, b.title as bug_title, b.file_path
         FROM suggested_fixes sf
         JOIN projects p ON p.id = sf.project_id
         JOIN detected_bugs b ON b.id = sf.bug_id
         WHERE sf.id = ? AND p.user_id = ?`
      )
      .get(fixId, req.user!.id) as Record<string, unknown> | undefined;

    if (!fix) {
      res.status(404).json({ error: 'Suggested fix not found.' });
      return;
    }

    const recentReview = db
      .prepare(
        `SELECT id FROM patch_audit_events
         WHERE patch_id = ? AND user_id = ? AND event_type = 'patch_reviewed'
           AND created_at >= datetime('now', '-5 minutes')
         LIMIT 1`
      )
      .get(fixId, req.user!.id);

    if (!recentReview) {
      appendPatchAuditEvent({
        patchId: fixId,
        projectId: String(fix.project_id),
        bugId: String(fix.bug_id),
        fileId: String(fix.file_id),
        filePath: String(fix.file_path),
        userId: req.user!.id,
        eventType: 'patch_reviewed',
        decisionStatus: String(fix.status),
        confidenceScore: Number(fix.confidence || 0),
        summary: `Developer ${req.user!.name} opened side-by-side diff review for "${fix.bug_title}"`,
        originalCode: String(fix.original_code),
        proposedCode: String(fix.patched_code),
      });
    }

    res.json({ ok: true });
  });

  interface AuditEventRow {
    id: string;
    project_id: string;
    project_name: string;
    bug_id: string | null;
    bug_title: string | null;
    bug_severity: string | null;
    patch_id: string | null;
    file_id: string | null;
    file_path: string;
    user_id: string;
    actor_name: string;
    event_type: string;
    decision_status: string | null;
    test_status: string | null;
    summary: string;
    original_code: string | null;
    proposed_code: string | null;
    modified_code: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }

  function queryAuditEvents(userId: string, query: Record<string, unknown>): AuditEventRow[] {
    const conditions: string[] = ['p.user_id = ?'];
    const params: Array<string | number> = [userId];

    if (query.projectId && String(query.projectId) !== 'all') {
      conditions.push('e.project_id = ?');
      params.push(String(query.projectId));
    }
    if (query.file && String(query.file).trim()) {
      conditions.push('LOWER(e.file_path) LIKE ?');
      params.push(`%${String(query.file).trim().toLowerCase()}%`);
    }
    if (query.bugId && String(query.bugId).trim()) {
      conditions.push("(LOWER(COALESCE(e.bug_id, '')) LIKE ? OR LOWER(COALESCE(b.title, '')) LIKE ?)");
      const q = `%${String(query.bugId).trim().toLowerCase()}%`;
      params.push(q, q);
    }
    if (query.developer && String(query.developer).trim()) {
      conditions.push('LOWER(COALESCE(u.name, \'\')) LIKE ?');
      params.push(`%${String(query.developer).trim().toLowerCase()}%`);
    }
    if (query.decision && String(query.decision) !== 'all') {
      conditions.push('e.decision_status = ?');
      params.push(String(query.decision));
    }
    if (query.eventType && String(query.eventType) !== 'all') {
      conditions.push('e.event_type = ?');
      params.push(String(query.eventType));
    }
    if (query.testStatus && String(query.testStatus) !== 'all') {
      conditions.push('e.test_status = ?');
      params.push(String(query.testStatus));
    }
    if (query.dateFrom && String(query.dateFrom).trim()) {
      conditions.push('date(e.created_at) >= date(?)');
      params.push(String(query.dateFrom).trim());
    }
    if (query.dateTo && String(query.dateTo).trim()) {
      conditions.push('date(e.created_at) <= date(?)');
      params.push(String(query.dateTo).trim());
    }

    const sql = `
      SELECT e.*, p.name as project_name, u.name as actor_name, b.title as bug_title, b.severity as bug_severity
      FROM patch_audit_events e
      JOIN projects p ON p.id = e.project_id
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN detected_bugs b ON b.id = e.bug_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at DESC, e.rowid DESC
      LIMIT 300
    `;

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => {
      let parsedTestMeta: Record<string, unknown> = {};
      if (r.test_results_json) {
        try {
          parsedTestMeta = JSON.parse(String(r.test_results_json)) as Record<string, unknown>;
        } catch {
          parsedTestMeta = {};
        }
      }
      return {
        id: String(r.id),
        project_id: String(r.project_id),
        project_name: String(r.project_name || ''),
        bug_id: r.bug_id ? String(r.bug_id) : null,
        bug_title: r.bug_title ? String(r.bug_title) : null,
        bug_severity: r.bug_severity ? String(r.bug_severity) : null,
        patch_id: r.patch_id ? String(r.patch_id) : null,
        file_id: r.file_id ? String(r.file_id) : null,
        file_path: String(r.file_path || ''),
        user_id: String(r.user_id),
        actor_name: String(r.actor_name || 'AutoPatch AI'),
        event_type: String(r.event_type),
        decision_status: r.decision_status ? String(r.decision_status) : null,
        test_status: r.test_status ? String(r.test_status) : null,
        summary: String(r.summary || ''),
        original_code: r.original_code ? String(r.original_code) : null,
        proposed_code: r.proposed_code ? String(r.proposed_code) : null,
        modified_code: r.modified_code ? String(r.modified_code) : null,
        metadata: {
          ...parsedTestMeta,
          ...(r.confidence_score !== null && r.confidence_score !== undefined
            ? { confidenceScore: Number(r.confidence_score) }
            : {}),
          ...(r.risk_score !== null && r.risk_score !== undefined ? { riskScore: Number(r.risk_score) } : {}),
          ...(r.rollback_status && r.rollback_status !== 'none' ? { rollbackStatus: String(r.rollback_status) } : {}),
        },
        created_at: String(r.created_at),
      };
    });
  }

  app.get('/api/audit-trail', requireAuth, (req: RouteAuthedRequest, res) => {
    const events = queryAuditEvents(req.user!.id, req.query as Record<string, unknown>);
    const counts = {
      total: events.length,
      accepted: events.filter((e) => e.event_type === 'patch_accepted').length,
      rejected: events.filter((e) => e.event_type === 'patch_rejected').length,
      verified: events.filter((e) => e.event_type === 'patch_verified').length,
      rollbacks: events.filter((e) => e.event_type === 'rollback_executed').length,
    };
    res.json({ events, counts });
  });

  app.get('/api/audit-trail/export-csv', requireAuth, (req: RouteAuthedRequest, res) => {
    const events = queryAuditEvents(req.user!.id, req.query as Record<string, unknown>);
    const header = [
      'Event ID',
      'Timestamp',
      'Event Type',
      'Project',
      'Bug ID',
      'Bug Title',
      'Patch ID',
      'File Path',
      'Actor',
      'Decision Status',
      'Test Status',
      'Summary',
    ].join(',');

    const lines = events.map((e) =>
      [
        e.id,
        e.created_at,
        e.event_type,
        e.project_name,
        e.bug_id || '',
        e.bug_title || '',
        e.patch_id || '',
        e.file_path,
        e.actor_name,
        e.decision_status || '',
        e.test_status || '',
        e.summary,
      ]
        .map(csvEscape)
        .join(',')
    );

    const csv = [header, ...lines].join('\n');
    createNotification(
      req.user!.id,
      req.query.projectId && req.query.projectId !== 'all' ? String(req.query.projectId) : null,
      'success',
      'Audit Trail Exported (CSV)',
      `Exported ${events.length} append-only audit event(s) to CSV.`,
      {
        actionModule: 'audit',
        projectName: 'Patch Audit Trail',
        eventKey: `audit-csv:${Math.floor(Date.now() / 15000)}`,
      }
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="autopatch-audit-trail.csv"');
    res.send(csv);
  });

  // ============================================================================
  // 7. ADVANCED DASHBOARD SUMMARY (LIVE DB METRICS FOR 6 FEATURE CARDS)
  // ============================================================================

  app.get('/api/dashboard/advanced', requireAuth, (req: RouteAuthedRequest, res) => {
    const userId = req.user!.id;

    const chatConvoCount = Number(
      (db.prepare(`SELECT COUNT(*) as c FROM ai_conversations WHERE user_id = ?`).get(userId) as { c: number }).c
    );
    const chatMessageCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM ai_messages m
             JOIN ai_conversations c2 ON c2.id = m.conversation_id
             WHERE c2.user_id = ?`
          )
          .get(userId) as { c: number }
      ).c
    );

    const projectLangRows = db
      .prepare(
        `SELECT DISTINCT f.language FROM uploaded_files f
         JOIN projects p ON p.id = f.project_id
         WHERE p.user_id = ?`
      )
      .all(userId) as Array<{ language: string }>;
    const activeLanguages = Array.from(new Set(projectLangRows.map((r) => normalizeLanguageKey(r.language))));

    const websiteScanStats = db
      .prepare(
        `SELECT COUNT(*) as total, COALESCE(SUM(issues_count), 0) as issues, MAX(created_at) as last_scan
         FROM website_scans WHERE user_id = ?`
      )
      .get(userId) as { total: number; issues: number; last_scan: string | null };

    const mediaScanRows = db
      .prepare(`SELECT media_type, issues_count FROM multimedia_scans WHERE user_id = ?`)
      .all(userId) as Array<{ media_type: string; issues_count: number }>;
    const mediaIssues = mediaScanRows.reduce((acc, r) => acc + Number(r.issues_count || 0), 0);

    const notifStats = db
      .prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread,
                SUM(CASE WHEN type = 'success' THEN 1 ELSE 0 END) as successes
         FROM notifications WHERE user_id = ?`
      )
      .get(userId) as { total: number; unread: number | null; successes: number | null };

    const auditStats = db
      .prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN e.event_type = 'patch_verified' THEN 1 ELSE 0 END) as verified,
                SUM(CASE WHEN e.event_type = 'rollback_executed' THEN 1 ELSE 0 END) as rollbacks
         FROM patch_audit_events e
         JOIN projects p ON p.id = e.project_id
         WHERE p.user_id = ?`
      )
      .get(userId) as { total: number; verified: number | null; rollbacks: number | null };

    res.json({
      chat: {
        conversations: chatConvoCount,
        messages: chatMessageCount,
      },
      languages: {
        supportedTotal: LANGUAGE_CAPABILITIES.length,
        activeInWorkspace: activeLanguages.length,
        activeList: activeLanguages,
      },
      website: {
        totalScans: Number(websiteScanStats.total || 0),
        totalIssues: Number(websiteScanStats.issues || 0),
        lastScanAt: websiteScanStats.last_scan,
      },
      multimedia: {
        totalScans: mediaScanRows.length,
        totalIssues: mediaIssues,
        imageCount: mediaScanRows.filter((r) => r.media_type === 'image').length,
        videoCount: mediaScanRows.filter((r) => r.media_type === 'video').length,
        audioCount: mediaScanRows.filter((r) => r.media_type === 'audio').length,
      },
      notifications: {
        total: Number(notifStats.total || 0),
        unread: Number(notifStats.unread || 0),
        successes: Number(notifStats.successes || 0),
      },
      audit: {
        totalEvents: Number(auditStats.total || 0),
        verifiedEvents: Number(auditStats.verified || 0),
        rollbackEvents: Number(auditStats.rollbacks || 0),
      },
    });
  });
}
