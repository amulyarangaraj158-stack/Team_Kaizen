import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Code2,
  FileCode2,
  Loader2,
  Play,
  Plus,
  ScanSearch,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../components/ui/Primitives';

const SCAN_STAGE_LABELS = [
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
];

interface ScanRecord {
  id: string;
  status: string;
  current_stage: string;
  progress_percent: number;
  files_analyzed: number;
  bugs_found: number;
  duration_ms: number;
  summary: string;
  started_at: string;
}

export function UploadScanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    fetchProjects,
    liveScan,
    scanLog,
    clearScanLog,
    pushToast,
  } = useAppStore();

  const [tab, setTab] = useState<'scan' | 'upload'>(searchParams.get('mode') === 'upload' ? 'upload' : 'scan');
  const [includeAi, setIncludeAi] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanRecord[]>([]);

  // Upload form state
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [draftFiles, setDraftFiles] = useState<Array<{ path: string; content: string }>>([
    {
      path: 'src/orderService.mjs',
      content: `export function getOrderQuery(orderId) {\n  return \`SELECT * FROM orders WHERE id = '\${orderId}'\`;\n}\n\nexport function computeTotal(price, qty) {\n  if (price < 0 || qty < 0) throw new RangeError('Negative values not allowed');\n  return price * qty;\n}\n`,
    },
    {
      path: 'tests/order.test.mjs',
      content: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { computeTotal } from '../src/orderService.mjs';\n\ntest('computeTotal multiplies price and quantity', () => {\n  assert.equal(computeTotal(25, 4), 100);\n});\n`,
    },
  ]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const loadHistory = async (pid: string | null) => {
    if (!pid) {
      setScanHistory([]);
      return;
    }
    try {
      const res = await apiFetch<{ scans: ScanRecord[] }>(`/api/projects/${pid}/scans`);
      setScanHistory(res.scans);
    } catch {
      setScanHistory([]);
    }
  };

  useEffect(() => {
    loadHistory(activeProjectId);
  }, [activeProjectId]);

  const handleStartScan = async (targetProjectId?: string) => {
    const pid = targetProjectId || activeProjectId;
    if (!pid) {
      pushToast({ tone: 'warning', title: 'Select a project', message: 'Choose or upload a project before scanning.' });
      return;
    }
    clearScanLog();
    setScanning(true);
    try {
      const res = await apiFetch<{
        scanId: string;
        filesAnalyzed: number;
        bugsFound: number;
        durationMs: number;
        summary: string;
      }>(`/api/projects/${pid}/scan`, {
        method: 'POST',
        body: JSON.stringify({ includeAiAnalysis: includeAi }),
      });
      await fetchProjects();
      await loadHistory(pid);
      pushToast({
        tone: 'success',
        title: 'Autonomous scan finished',
        message: `${res.filesAnalyzed} files scanned · ${res.bugsFound} open issue(s) · ${res.durationMs}ms`,
      });
    } catch (err: unknown) {
      pushToast({
        tone: 'error',
        title: 'Scan failed',
        message: err instanceof Error ? err.message : 'Unable to execute scan.',
      });
    } finally {
      setScanning(false);
    }
  };

  const handleFilePicker = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const loaded: Array<{ path: string; content: string }> = [];
    for (const f of Array.from(fileList)) {
      if (f.size > 1024 * 1024) continue;
      const text = await f.text();
      loaded.push({ path: f.webkitRelativePath || f.name, content: text });
    }
    if (loaded.length > 0) {
      setDraftFiles((prev) => [...prev, ...loaded]);
    }
  };

  const handleCreateAndScan = async (e: React.FormEvent, autoScan: boolean) => {
    e.preventDefault();
    setUploadError('');
    if (projectName.trim().length < 2) {
      setUploadError('Project name must be at least 2 characters.');
      return;
    }
    const validFiles = draftFiles.filter((f) => f.path.trim() && f.content.trim());
    if (validFiles.length === 0) {
      setUploadError('Provide at least one source file with content.');
      return;
    }
    setUploading(true);
    try {
      const res = await apiFetch<{ project: { id: string; name: string } }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: projectName.trim(),
          description: projectDesc.trim(),
          files: validFiles,
        }),
      });
      await fetchProjects();
      setActiveProjectId(res.project.id);
      setProjectName('');
      setProjectDesc('');
      setTab('scan');
      if (autoScan) {
        await handleStartScan(res.project.id);
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const activeStageIndex = liveScan?.projectId === activeProjectId ? liveScan.stageIndex : 0;
  const activeProgress = liveScan?.projectId === activeProjectId ? liveScan.progressPercent : 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Upload & Autonomous Scan</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Upload project repositories and execute the 10-stage real-time static, dependency, AI, and sandbox analysis pipeline.
          </p>
        </div>

        <div className="inline-flex rounded-md border border-[#00F5FF]/20 bg-[#0B1220] p-1">
          <button
            type="button"
            onClick={() => setTab('scan')}
            className={cn(
              'rounded px-3.5 py-1.5 text-xs font-semibold transition-colors',
              tab === 'scan' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            )}
          >
            Live Scanner
          </button>
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={cn(
              'rounded px-3.5 py-1.5 text-xs font-semibold transition-colors',
              tab === 'upload' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
            )}
          >
            Upload New Project
          </button>
        </div>
      </div>

      {tab === 'upload' ? (
        <form onSubmit={(e) => handleCreateAndScan(e, true)} className="cyber-panel space-y-5 rounded-lg p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="new-project-name" className="block text-xs font-medium text-[#94A3B8]">
                Project Name
              </label>
              <input
                id="new-project-name"
                type="text"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Checkout Microservice"
                className="mt-1.5 w-full rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 text-sm text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="new-project-desc" className="block text-xs font-medium text-[#94A3B8]">
                Description
              </label>
              <input
                id="new-project-desc"
                type="text"
                value={projectDesc}
                onChange={(e) => setProjectDesc(e.target.value)}
                placeholder="Order processing API and unit tests"
                className="mt-1.5 w-full rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 text-sm text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#00F5FF]/15 pt-4">
            <div>
              <div className="text-sm font-semibold text-[#F1F5F9]">Project Source Files</div>
              <p className="text-xs text-[#94A3B8]">
                Upload local source files (max 2MB each) or edit inline files below. Path traversal is automatically blocked.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#00F5FF]/30 bg-[#142238] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] hover:border-[#00F5FF]">
                <Upload className="h-3.5 w-3.5 text-[#00F5FF]" />
                Import Files
                <input type="file" multiple className="hidden" onChange={handleFilePicker} />
              </label>
              <button
                type="button"
                onClick={() => setDraftFiles((prev) => [...prev, { path: `src/module${prev.length + 1}.ts`, content: '' }])}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#0B1220] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] hover:border-[#00F5FF]/40"
              >
                <Plus className="h-3.5 w-3.5" />
                Add File
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {draftFiles.map((file, idx) => (
              <div key={idx} className="rounded-md border border-[#00F5FF]/15 bg-[#0B1220] p-4">
                <div className="flex items-center gap-3">
                  <FileCode2 className="h-4 w-4 shrink-0 text-[#00F5FF]" />
                  <input
                    type="text"
                    value={file.path}
                    aria-label={`File path ${idx + 1}`}
                    onChange={(e) =>
                      setDraftFiles((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, path: e.target.value } : item))
                      )
                    }
                    placeholder="src/index.ts"
                    className="flex-1 rounded border border-[#00F5FF]/15 bg-[#070B14] px-2.5 py-1.5 font-mono text-xs text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
                  />
                  {draftFiles.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setDraftFiles((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remove file ${file.path}`}
                      className="rounded p-1.5 text-[#94A3B8] hover:text-[#FF3864]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <textarea
                  value={file.content}
                  aria-label={`Code content for ${file.path}`}
                  onChange={(e) =>
                    setDraftFiles((prev) =>
                      prev.map((item, i) => (i === idx ? { ...item, content: e.target.value } : item))
                    )
                  }
                  rows={6}
                  placeholder="Paste source code here..."
                  className="mt-3 w-full rounded border border-[#00F5FF]/15 bg-[#070B14] p-3 font-mono text-xs text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
                />
              </div>
            ))}
          </div>

          {uploadError && (
            <div className="rounded-md border border-[#FF3864]/40 bg-[#FF3864]/10 p-3 text-xs text-[#FF3864]">
              {uploadError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#00F5FF]/15 pt-4">
            <button
              type="button"
              disabled={uploading}
              onClick={(e) => handleCreateAndScan(e, false)}
              className="rounded-md border border-[#00F5FF]/25 bg-[#142238] px-4 py-2 text-sm font-medium text-[#F1F5F9] hover:border-[#00F5FF] disabled:opacity-50"
            >
              Upload Only
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="cyber-glow-cyan inline-flex items-center gap-2 rounded-md bg-[#00F5FF] px-5 py-2 text-sm font-semibold text-[#070B14] hover:bg-[#33f7ff] disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              Upload & Start 10-Stage Scan
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-6">
          {/* Scan Launcher & Live 10-Stage Telemetry */}
          <section className="cyber-panel relative overflow-hidden rounded-lg p-6">
            {scanning && (
              <div
                aria-hidden="true"
                className="animate-scanline pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#00F5FF]/15 via-[#00F5FF]/5 to-transparent"
              />
            )}

            <div className="relative flex flex-col justify-between gap-4 border-b border-[#00F5FF]/15 pb-5 lg:flex-row lg:items-center">
              <div className="space-y-1">
                <div className="text-xs font-mono text-[#00F5FF]">Autonomous Scan Pipeline</div>
                <h2 className="text-lg font-semibold text-[#F1F5F9]">
                  {projects.find((p) => p.id === activeProjectId)?.name || 'Select a Project'}
                </h2>
                <p className="text-xs text-[#94A3B8]">
                  Streams authentic backend completion events via Socket.IO across all 10 analysis phases.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[#F1F5F9]">
                  <input
                    type="checkbox"
                    checked={includeAi}
                    onChange={(e) => setIncludeAi(e.target.checked)}
                    className="h-4 w-4 rounded border-[#00F5FF]/40 bg-[#070B14] accent-[#00F5FF]"
                  />
                  Include Gemini Deep Analysis
                </label>

                <button
                  type="button"
                  disabled={scanning || !activeProjectId}
                  onClick={() => handleStartScan()}
                  className="cyber-glow-cyan inline-flex items-center gap-2 rounded-md bg-[#00F5FF] px-5 py-2.5 text-sm font-semibold text-[#070B14] hover:bg-[#33f7ff] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {scanning ? 'Scanning Repository...' : 'Execute Full Scan'}
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[#F1F5F9]">
                  {liveScan && liveScan.projectId === activeProjectId
                    ? `Stage ${liveScan.stageIndex}/${liveScan.totalStages}: ${liveScan.stageName}`
                    : 'Ready to launch scan'}
                </span>
                <span className="font-mono font-semibold tabular-nums text-[#00F5FF]">{activeProgress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#070B14]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#00F5FF] to-[#A855F7] transition-all duration-300"
                  style={{ width: `${activeProgress}%` }}
                />
              </div>
            </div>

            {/* 10 Real Stages Grid */}
            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
              {SCAN_STAGE_LABELS.map((stage, idx) => {
                const stageNum = idx + 1;
                const logEntry = scanLog.find((l) => l.projectId === activeProjectId && l.stageIndex === stageNum);
                const isDone = activeStageIndex > stageNum || (activeStageIndex === stageNum && liveScan?.status === 'completed');
                const isCurrent = scanning && activeStageIndex === stageNum;
                return (
                  <div
                    key={stage}
                    className={cn(
                      'rounded-md border p-3 transition-colors',
                      isDone
                        ? 'border-[#39FF88]/30 bg-[#39FF88]/[0.05]'
                        : isCurrent
                          ? 'border-[#00F5FF]/50 bg-[#00F5FF]/[0.08]'
                          : 'border-[#00F5FF]/10 bg-[#0B1220]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-[#94A3B8]">
                        {String(stageNum).padStart(2, '0')}
                      </span>
                      {isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#39FF88]" />
                      ) : isCurrent ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00F5FF]" />
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-[#F1F5F9]">{stage}</div>
                    {logEntry && (
                      <p className="mt-1 text-[11px] leading-snug text-[#94A3B8] line-clamp-2">{logEntry.detail}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {liveScan && liveScan.projectId === activeProjectId && liveScan.status === 'completed' && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-md border border-[#39FF88]/30 bg-[#39FF88]/10 px-4 py-3">
                <div className="text-xs text-[#F1F5F9]">
                  <strong className="font-semibold text-[#39FF88]">Scan Complete:</strong> {liveScan.detail} (
                  <span className="font-mono tabular-nums">{liveScan.durationMs}ms</span>)
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/workbench')}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#00F5FF] px-3 py-1.5 text-xs font-semibold text-[#070B14]"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Inspect in Workbench
                </button>
              </div>
            )}
          </section>

          {/* Historical Scans Table */}
          <section className="cyber-panel rounded-lg p-5">
            <h2 className="text-base font-semibold text-[#F1F5F9]">Scan History</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#00F5FF]/15 text-[#94A3B8]">
                    <th className="py-2.5 pr-4 font-medium">Timestamp</th>
                    <th className="py-2.5 pr-4 font-medium">Status</th>
                    <th className="py-2.5 pr-4 font-medium text-right">Files</th>
                    <th className="py-2.5 pr-4 font-medium text-right">Bugs</th>
                    <th className="py-2.5 pr-4 font-medium text-right">Duration</th>
                    <th className="py-2.5 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#00F5FF]/10">
                  {scanHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-[#94A3B8]">
                        No scans executed for this project yet.
                      </td>
                    </tr>
                  ) : (
                    scanHistory.map((s) => (
                      <tr key={s.id} className="hover:bg-[#142238]/50">
                        <td className="py-3 pr-4 font-mono tabular-nums text-[#94A3B8] whitespace-nowrap">
                          {new Date(s.started_at).toLocaleString()}
                        </td>
                        <td className="py-3 pr-4 font-mono font-semibold text-[#39FF88]">{s.status}</td>
                        <td className="py-3 pr-4 text-right font-mono tabular-nums text-[#F1F5F9]">
                          {s.files_analyzed}
                        </td>
                        <td className="py-3 pr-4 text-right font-mono tabular-nums text-[#FFB020]">
                          {s.bugs_found}
                        </td>
                        <td className="py-3 pr-4 text-right font-mono tabular-nums text-[#94A3B8]">
                          {s.duration_ms}ms
                        </td>
                        <td className="py-3 text-[#F1F5F9]">{s.summary}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
