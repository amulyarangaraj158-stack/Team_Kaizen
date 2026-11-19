import crypto from 'node:crypto';
import type { Server as SocketIOServer } from 'socket.io';
import { db, rebuildProjectDependencies, recalculateProjectHealth } from '../db';
import { detectLanguage, runStaticAnalysis } from '../analyzers/staticAnalyzer';
import { runTestsInIsolatedSandbox } from '../analyzers/sandboxRunner';
import { analyzeProjectCodeWithGemini, generateAiPatchForBug, getAiServiceStatus } from './aiService';
import { calculatePatchScores } from '../utils/scoring';

export const SCAN_STAGES = [
  'Project validation',
  'File discovery',
  'Language detection',
  'Dependency analysis',
  'Static code analysis',
  'AI bug analysis',
  'Severity classification',
  'Fix generation',
  'Test preparation',
  'Report generation',
] as const;

export interface ScanProgressPayload {
  scanId: string;
  projectId: string;
  stageIndex: number;
  totalStages: number;
  stageName: string;
  progressPercent: number;
  filesAnalyzed: number;
  bugsFound: number;
  durationMs: number;
  status: 'running' | 'completed' | 'failed';
  detail: string;
}

export function createAndEmitNotification(
  io: SocketIOServer,
  params: {
    userId: string;
    projectId?: string | null;
    type: string;
    title: string;
    message: string;
    linkPath?: string;
  }
) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO notifications (id, user_id, project_id, type, title, message, link_path, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    params.userId,
    params.projectId ?? null,
    params.type,
    params.title,
    params.message,
    params.linkPath || '/',
    createdAt
  );

  const payload = {
    id,
    userId: params.userId,
    projectId: params.projectId ?? null,
    type: params.type,
    title: params.title,
    message: params.message,
    linkPath: params.linkPath || '/',
    isRead: false,
    createdAt,
  };
  io.to(`user:${params.userId}`).emit('notification:new', payload);
  return payload;
}

/**
 * Executes the genuine 10-stage AutoPatch AI scanning pipeline and broadcasts
 * real progress events over Socket.IO as each backend stage completes.
 */
export async function executeProjectScan(
  io: SocketIOServer,
  projectId: string,
  userId: string,
  options: { includeAiAnalysis?: boolean } = {}
): Promise<{
  scanId: string;
  filesAnalyzed: number;
  bugsFound: number;
  durationMs: number;
  healthScore: number;
  summary: string;
}> {
  const scanId = crypto.randomUUID();
  const startedAt = Date.now();

  db.prepare(`
    INSERT INTO scan_history (id, project_id, user_id, status, current_stage, progress_percent, files_analyzed, bugs_found, duration_ms, summary)
    VALUES (?, ?, ?, 'running', 'Project validation', 5, 0, 0, 0, 'Scan started')
  `).run(scanId, projectId, userId);

  const emitProgress = (
    stageIndex: number,
    progressPercent: number,
    filesAnalyzed: number,
    bugsFound: number,
    detail: string,
    status: 'running' | 'completed' | 'failed' = 'running'
  ) => {
    const stageName = SCAN_STAGES[stageIndex] ?? 'Report generation';
    const durationMs = Date.now() - startedAt;
    db.prepare(`
      UPDATE scan_history
      SET current_stage = ?, progress_percent = ?, files_analyzed = ?, bugs_found = ?, duration_ms = ?, status = ?, summary = ?
      WHERE id = ?
    `).run(stageName, progressPercent, filesAnalyzed, bugsFound, durationMs, status, detail, scanId);

    const payload: ScanProgressPayload = {
      scanId,
      projectId,
      stageIndex: stageIndex + 1,
      totalStages: SCAN_STAGES.length,
      stageName,
      progressPercent,
      filesAnalyzed,
      bugsFound,
      durationMs,
      status,
      detail,
    };
    io.to(`user:${userId}`).emit('scan:progress', payload);
  };

  try {
    // Stage 1: Project validation
    const project = db
      .prepare('SELECT id, name, user_id FROM projects WHERE id = ? AND user_id = ?')
      .get(projectId, userId) as { id: string; name: string; user_id: string } | undefined;
    if (!project) {
      throw new Error('Project not found or access denied.');
    }
    emitProgress(0, 10, 0, 0, `Validated ownership and workspace integrity for "${project.name}".`);

    // Stage 2: File discovery
    const files = db
      .prepare('SELECT id, path, language, content FROM uploaded_files WHERE project_id = ?')
      .all(projectId) as Array<{ id: string; path: string; language: string; content: string }>;
    emitProgress(1, 20, files.length, 0, `Discovered ${files.length} source file(s) in project repository.`);

    // Stage 3: Language detection
    const langCounts = new Map<string, number>();
    const updateLang = db.prepare('UPDATE uploaded_files SET language = ? WHERE id = ?');
    for (const f of files) {
      const detected = detectLanguage(f.path, f.content);
      f.language = detected;
      updateLang.run(detected, f.id);
      langCounts.set(detected, (langCounts.get(detected) ?? 0) + 1);
    }
    const primaryLang =
      Array.from(langCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'plaintext';
    db.prepare('UPDATE projects SET primary_language = ? WHERE id = ?').run(primaryLang, projectId);
    emitProgress(
      2,
      30,
      files.length,
      0,
      `Detected ${langCounts.size} language(s); primary language: ${primaryLang}.`
    );

    // Stage 4: Dependency analysis
    rebuildProjectDependencies(projectId);
    const edgeCount = (
      db.prepare('SELECT COUNT(*) as c FROM dependency_edges WHERE project_id = ?').get(projectId) as { c: number }
    ).c;
    emitProgress(
      3,
      42,
      files.length,
      0,
      `Mapped ${edgeCount} internal import relationship(s) for Code Impact Radar.`
    );

    // Stage 5: Static code analysis
    const staticFindings = runStaticAnalysis(files);
    emitProgress(
      4,
      56,
      files.length,
      staticFindings.length,
      `Static compiler & security rules identified ${staticFindings.length} finding(s).`
    );

    // Stage 6: AI bug analysis (Gemini)
    let aiFindings: Awaited<ReturnType<typeof analyzeProjectCodeWithGemini>> = [];
    let aiNote = '';
    const aiStatus = getAiServiceStatus();
    if (options.includeAiAnalysis !== false && aiStatus.configured && files.length > 0) {
      try {
        aiFindings = await analyzeProjectCodeWithGemini(
          files,
          staticFindings.map((f) => f.title)
        );
        aiNote = `Gemini (${aiStatus.model}) discovered ${aiFindings.length} additional deep-context issue(s).`;
      } catch (aiErr: unknown) {
        aiNote = `Gemini deep analysis skipped due to upstream error: ${aiErr instanceof Error ? aiErr.message : 'unknown error'}.`;
      }
    } else if (!aiStatus.configured) {
      aiNote = 'Gemini API key not configured; completed using configured static parsers and rule analyzers.';
    } else {
      aiNote = 'AI deep scan skipped by request option.';
    }
    emitProgress(5, 68, files.length, staticFindings.length + aiFindings.length, aiNote);

    // Stage 7: Severity classification & persistence
    const fileIdByPath = new Map(files.map((f) => [f.path, f.id]));
    const depMap = new Map<string, { direct: number; indirect: number }>();
    const depNodes = db
      .prepare('SELECT file_path, direct_dependents, indirect_dependents FROM dependency_nodes WHERE project_id = ?')
      .all(projectId) as Array<{ file_path: string; direct_dependents: number; indirect_dependents: number }>;
    for (const dn of depNodes) {
      depMap.set(dn.file_path, { direct: dn.direct_dependents, indirect: dn.indirect_dependents });
    }

    const existingOpenKeys = new Set(
      (
        db
          .prepare("SELECT file_path, line_number, title FROM detected_bugs WHERE project_id = ? AND status = 'open'")
          .all(projectId) as Array<{ file_path: string; line_number: number; title: string }>
      ).map((b) => `${b.file_path}:${b.line_number}:${b.title}`)
    );

    const newlyInsertedBugs: Array<{
      id: string;
      fileId: string | null;
      filePath: string;
      language: string;
      lineNumber: number;
      category: string;
      severity: 'critical' | 'high' | 'medium' | 'low';
      title: string;
      description: string;
      preGeneratedFix?: { proposedCode: string; explanation: string };
    }> = [];

    const insertBug = db.prepare(`
      INSERT INTO detected_bugs (id, project_id, scan_id, file_id, file_path, line_number, column_number, category, severity, title, description, root_cause, code_snippet, status, analyzer_source, prevention_tip, related_concepts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
    `);

    for (const f of staticFindings) {
      const key = `${f.filePath}:${f.lineNumber}:${f.title}`;
      if (existingOpenKeys.has(key)) continue;
      existingOpenKeys.add(key);
      const bugId = crypto.randomUUID();
      const fileId = fileIdByPath.get(f.filePath) ?? null;
      insertBug.run(
        bugId,
        projectId,
        scanId,
        fileId,
        f.filePath,
        f.lineNumber,
        f.columnNumber,
        f.category,
        f.severity,
        f.title,
        f.description,
        f.rootCause,
        f.codeSnippet,
        f.analyzerSource,
        f.preventionTip,
        JSON.stringify(f.relatedConcepts)
      );
      const fileObj = files.find((x) => x.path === f.filePath);
      newlyInsertedBugs.push({
        id: bugId,
        fileId,
        filePath: f.filePath,
        language: fileObj?.language || 'plaintext',
        lineNumber: f.lineNumber,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
      });
    }

    for (const af of aiFindings) {
      const key = `${af.filePath}:${af.lineNumber}:${af.title}`;
      if (existingOpenKeys.has(key)) continue;
      existingOpenKeys.add(key);
      const bugId = crypto.randomUUID();
      const fileId = fileIdByPath.get(af.filePath) ?? null;
      const fileObj = files.find((x) => x.path === af.filePath);
      const snippet = fileObj
        ? fileObj.content.split('\n').slice(Math.max(0, af.lineNumber - 2), af.lineNumber + 2).join('\n')
        : '';
      insertBug.run(
        bugId,
        projectId,
        scanId,
        fileId,
        af.filePath,
        af.lineNumber,
        1,
        af.category,
        af.severity,
        af.title,
        af.description,
        af.rootCause,
        snippet,
        `Gemini AI (${aiStatus.model})`,
        af.preventionTip,
        JSON.stringify(af.relatedConcepts)
      );
      newlyInsertedBugs.push({
        id: bugId,
        fileId,
        filePath: af.filePath,
        language: fileObj?.language || 'plaintext',
        lineNumber: af.lineNumber,
        category: af.category,
        severity: af.severity,
        title: af.title,
        description: af.description,
        preGeneratedFix:
          af.proposedCode && af.proposedCode.trim()
            ? { proposedCode: af.proposedCode, explanation: af.explanation }
            : undefined,
      });
    }

    const totalOpenBugs = (
      db.prepare("SELECT COUNT(*) as c FROM detected_bugs WHERE project_id = ? AND status = 'open'").get(projectId) as {
        c: number;
      }
    ).c;

    emitProgress(
      6,
      78,
      files.length,
      totalOpenBugs,
      `Classified severities and persisted ${newlyInsertedBugs.length} new issue(s) (${totalOpenBugs} open total).`
    );

    // Stage 8: Fix generation (for AI findings or top critical/high static bug when Gemini is active)
    const hasTests = files.some(
      (f) => /\.(test|spec)\.(mjs|cjs|js)$/.test(f.path) || /(^|\/)test_.*\.py$|_test\.py$/.test(f.path)
    );
    let fixesGenerated = 0;

    const insertFix = db.prepare(`
      INSERT INTO suggested_fixes (id, bug_id, project_id, file_id, original_code, proposed_code, explanation, confidence_score, risk_score, risk_category, score_explanation, score_factors_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    for (const bug of newlyInsertedBugs.slice(0, 3)) {
      const fileObj = files.find((x) => x.path === bug.filePath);
      if (!fileObj) continue;

      let proposedCode = bug.preGeneratedFix?.proposedCode;
      let explanation = bug.preGeneratedFix?.explanation;

      if (!proposedCode && options.includeAiAnalysis !== false && aiStatus.configured && (bug.severity === 'critical' || bug.severity === 'high')) {
        try {
          const aiPatch = await generateAiPatchForBug({
            filePath: bug.filePath,
            language: bug.language,
            fileContent: fileObj.content,
            bugTitle: bug.title,
            bugDescription: bug.description,
            bugCategory: bug.category,
            lineNumber: bug.lineNumber,
          });
          proposedCode = aiPatch.proposedCode;
          explanation = aiPatch.explanation;
        } catch {
          // Leave without auto-patch; user can trigger Generate AI Fix on demand to see explicit error
        }
      }

      if (proposedCode && proposedCode.trim() !== fileObj.content.trim()) {
        const deps = depMap.get(bug.filePath) ?? { direct: 0, indirect: 0 };
        const scores = calculatePatchScores({
          bugCategory: bug.category,
          bugSeverity: bug.severity,
          originalCode: fileObj.content,
          proposedCode,
          filePath: bug.filePath,
          changedFilesCount: 1,
          directDependentsCount: deps.direct,
          indirectDependentsCount: deps.indirect,
          hasUnitTests: hasTests,
          testsPassedAfterPatch: null,
          analyzerVerified: true,
        });

        const fixId = crypto.randomUUID();
        insertFix.run(
          fixId,
          bug.id,
          projectId,
          bug.fileId,
          fileObj.content,
          proposedCode,
          explanation || 'AI-suggested remediation ready for review.',
          scores.confidenceScore,
          scores.riskScore,
          scores.riskCategory,
          scores.scoreExplanation,
          JSON.stringify(scores.factors)
        );
        fixesGenerated++;

        db.prepare(`
          INSERT INTO patch_audit_events (id, user_id, project_id, bug_id, fix_id, action, bug_category, risk_level, confidence_score, risk_score, original_code, proposed_code, accepted_code, test_summary)
          VALUES (?, ?, ?, ?, ?, 'patch_suggested', ?, ?, ?, ?, ?, ?, '', 'Awaiting user review')
        `).run(
          crypto.randomUUID(),
          userId,
          projectId,
          bug.id,
          fixId,
          bug.category,
          scores.riskCategory,
          scores.confidenceScore,
          scores.riskScore,
          fileObj.content,
          proposedCode
        );
      }
    }

    emitProgress(
      7,
      86,
      files.length,
      totalOpenBugs,
      fixesGenerated > 0
        ? `Generated ${fixesGenerated} explainable patch suggestion(s) with Fix Confidence & Change Risk scores.`
        : 'Static issues cataloged; open Code Workbench to generate or review targeted AI patches.'
    );

    // Stage 9: Test preparation (run real isolated baseline check if tests exist)
    let testNote = 'No automated test files detected in repository.';
    if (hasTests) {
      const baseline = await runTestsInIsolatedSandbox(files);
      db.prepare(`
        INSERT INTO test_results (id, project_id, fix_id, run_type, status, total_tests, passed_tests, failed_tests, newly_failed_json, output_log, duration_ms)
        VALUES (?, ?, NULL, 'baseline', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        projectId,
        baseline.status,
        baseline.totalTests,
        baseline.passedTests,
        baseline.failedTests,
        JSON.stringify(baseline.failedTestNames),
        baseline.outputLog,
        baseline.durationMs
      );
      testNote = `Isolated baseline test suite (${baseline.runner}): ${baseline.passedTests}/${baseline.totalTests} passed.`;
    }
    emitProgress(8, 94, files.length, totalOpenBugs, testNote);

    // Stage 10: Report generation
    const healthScore = recalculateProjectHealth(projectId);
    const durationMs = Date.now() - startedAt;
    const summary = `Scanned ${files.length} file(s), found ${totalOpenBugs} open issue(s) (${newlyInsertedBugs.length} new), generated ${fixesGenerated} patch suggestion(s). ${testNote}`;

    db.prepare(`
      UPDATE scan_history
      SET status = 'completed', current_stage = 'Report generation', progress_percent = 100, files_analyzed = ?, bugs_found = ?, duration_ms = ?, summary = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(files.length, totalOpenBugs, durationMs, summary, scanId);

    emitProgress(9, 100, files.length, totalOpenBugs, summary, 'completed');

    // Emit confirmed real notifications
    createAndEmitNotification(io, {
      userId,
      projectId,
      type: 'scan_completed',
      title: `Scan Completed: ${project.name}`,
      message: summary,
      linkPath: '/workbench',
    });

    const criticalNew = newlyInsertedBugs.filter((b) => b.severity === 'critical');
    if (criticalNew.length > 0) {
      createAndEmitNotification(io, {
        userId,
        projectId,
        type: 'critical_issue',
        title: `${criticalNew.length} Critical Issue(s) Identified`,
        message: `${project.name}: ${criticalNew[0].title} in ${criticalNew[0].filePath}.`,
        linkPath: '/workbench',
      });
    }

    return {
      scanId,
      filesAnalyzed: files.length,
      bugsFound: totalOpenBugs,
      durationMs,
      healthScore,
      summary,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Scan failed unexpectedly.';
    emitProgress(9, 100, 0, 0, errMsg, 'failed');
    throw err;
  }
}
