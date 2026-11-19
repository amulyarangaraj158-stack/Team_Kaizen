import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Code2,
  Cpu,
  FileCode2,
  GitCompare,
  Loader2,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch, DetectedBug, PatchSnapshot, ProjectFile, SuggestedFix } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import {
  CircularGauge,
  cn,
  ConfirmDialog,
  EmptyState,
  RiskText,
  SeverityIndicator,
} from '../components/ui/Primitives';
import { MonacoCodeEditor, MonacoDiffViewer } from '../components/MonacoCodeViewer';

export function WorkbenchPage() {
  const { activeProjectId, projects, fetchProjects, pushToast } = useAppStore();
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [bugs, setBugs] = useState<DetectedBug[]>([]);
  const [snapshots, setSnapshots] = useState<PatchSnapshot[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorLang, setEditorLang] = useState('typescript');
  const [proposedDraft, setProposedDraft] = useState('');
  const [viewMode, setViewMode] = useState<'editor' | 'diff'>('editor');
  const [fileSearch, setFileSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [savingFile, setSavingFile] = useState(false);
  const [generatingFix, setGeneratingFix] = useState(false);
  const [runningRegression, setRunningRegression] = useState(false);
  const [applyingPatch, setApplyingPatch] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<PatchSnapshot | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [lastRegressionSummary, setLastRegressionSummary] = useState<{
    summary: string;
    regressionDetected: boolean;
    baselinePassed: number;
    baselineTotal: number;
    patchedPassed: number;
    patchedTotal: number;
  } | null>(null);

  const loadWorkspace = async () => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [projRes, bugsRes, snapRes] = await Promise.all([
        apiFetch<{ files: ProjectFile[] }>(`/api/projects/${activeProjectId}`),
        apiFetch<{ bugs: DetectedBug[] }>(`/api/projects/${activeProjectId}/bugs`),
        apiFetch<{ snapshots: PatchSnapshot[] }>(`/api/projects/${activeProjectId}/snapshots`),
      ]);
      setFiles(projRes.files);
      setBugs(bugsRes.bugs);
      setSnapshots(snapRes.snapshots);

      const nextBug =
        bugsRes.bugs.find((b) => b.id === selectedBugId) ||
        bugsRes.bugs.find((b) => b.status === 'open') ||
        bugsRes.bugs[0] ||
        null;
      setSelectedBugId(nextBug?.id ?? null);
      const pendingFix = nextBug?.fixes.find((f) => f.status === 'pending') || nextBug?.fixes[0];
      if (pendingFix) {
        setProposedDraft(pendingFix.proposed_code);
      }

      const nextFile =
        projRes.files.find((f) => f.id === selectedFileId) ||
        (nextBug ? projRes.files.find((f) => f.path === nextBug.file_path) : undefined) ||
        projRes.files[0] ||
        null;
      if (nextFile) {
        setSelectedFileId(nextFile.id);
        setEditorContent(nextFile.content);
        setEditorLang(nextFile.language);
      }
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Failed to load workbench', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLastRegressionSummary(null);
    loadWorkspace();
  }, [activeProjectId]);

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null;
  const selectedBug = bugs.find((b) => b.id === selectedBugId) ?? null;
  const activeFix: SuggestedFix | null =
    selectedBug?.fixes.find((f) => f.status === 'pending') || selectedBug?.fixes[0] || null;

  const filteredFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q) || f.content.toLowerCase().includes(q));
  }, [files, fileSearch]);

  const fileMarkers = useMemo(() => {
    if (!selectedFile) return [];
    return bugs
      .filter((b) => b.file_path === selectedFile.path && b.status === 'open')
      .map((b) => ({
        lineNumber: b.line_number,
        columnNumber: b.column_number,
        severity: b.severity,
        message: `[${b.severity.toUpperCase()}] ${b.title}: ${b.description}`,
      }));
  }, [bugs, selectedFile]);

  const selectFile = (file: ProjectFile) => {
    setSelectedFileId(file.id);
    setEditorContent(file.content);
    setEditorLang(file.language);
    setViewMode('editor');
    const bugInFile = bugs.find((b) => b.file_path === file.path && b.status === 'open') || bugs.find((b) => b.file_path === file.path);
    if (bugInFile) {
      setSelectedBugId(bugInFile.id);
      const fx = bugInFile.fixes.find((f) => f.status === 'pending') || bugInFile.fixes[0];
      setProposedDraft(fx?.proposed_code || '');
    }
  };

  const selectBug = (bug: DetectedBug) => {
    setSelectedBugId(bug.id);
    setLastRegressionSummary(null);
    const matchFile = files.find((f) => f.path === bug.file_path);
    if (matchFile) {
      setSelectedFileId(matchFile.id);
      setEditorContent(matchFile.content);
      setEditorLang(matchFile.language);
    }
    const fx = bug.fixes.find((f) => f.status === 'pending') || bug.fixes[0];
    setProposedDraft(fx?.proposed_code || '');
    if (fx) setViewMode('diff');
  };

  const handleSaveFile = async () => {
    if (!activeProjectId || !selectedFile) return;
    setSavingFile(true);
    try {
      await apiFetch(`/api/projects/${activeProjectId}/files/${selectedFile.id}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editorContent, language: editorLang }),
      });
      pushToast({ tone: 'success', title: 'File saved', message: `Saved changes to ${selectedFile.path}.` });
      await loadWorkspace();
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Save failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setSavingFile(false);
    }
  };

  const handleGenerateFix = async () => {
    if (!selectedBug) return;
    setGeneratingFix(true);
    try {
      const res = await apiFetch<{ fix: SuggestedFix }>(`/api/bugs/${selectedBug.id}/suggest-fix`, {
        method: 'POST',
      });
      setProposedDraft(res.fix.proposed_code);
      setViewMode('diff');
      await loadWorkspace();
      pushToast({
        tone: 'success',
        title: 'AI Patch Suggested',
        message: `Confidence ${res.fix.confidence_score}% · ${res.fix.risk_category} Risk.`,
      });
    } catch (err: unknown) {
      pushToast({
        tone: 'error',
        title: 'AI Patch Generation Error',
        message: err instanceof Error ? err.message : 'Could not reach Gemini AI service.',
      });
    } finally {
      setGeneratingFix(false);
    }
  };

  const handleRunRegression = async () => {
    if (!activeFix) return;
    setRunningRegression(true);
    try {
      const res = await apiFetch<{
        report: {
          summary: string;
          regressionDetected: boolean;
          baseline: { passedTests: number; totalTests: number };
          patched: { passedTests: number; totalTests: number };
        };
      }>(`/api/fixes/${activeFix.id}/regression-test`, {
        method: 'POST',
        body: JSON.stringify({ proposedCode: proposedDraft || activeFix.proposed_code }),
      });
      setLastRegressionSummary({
        summary: res.report.summary,
        regressionDetected: res.report.regressionDetected,
        baselinePassed: res.report.baseline.passedTests,
        baselineTotal: res.report.baseline.totalTests,
        patchedPassed: res.report.patched.passedTests,
        patchedTotal: res.report.patched.totalTests,
      });
      await loadWorkspace();
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Regression check failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setRunningRegression(false);
    }
  };

  const handleApplyPatch = async () => {
    if (!activeFix) return;
    setApplyingPatch(true);
    try {
      await apiFetch(`/api/fixes/${activeFix.id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ acceptedCode: proposedDraft || activeFix.proposed_code }),
      });
      setViewMode('editor');
      await Promise.all([loadWorkspace(), fetchProjects()]);
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Apply patch failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setApplyingPatch(false);
    }
  };

  const handleRejectPatch = async () => {
    if (!activeFix) return;
    try {
      await apiFetch(`/api/fixes/${activeFix.id}/reject`, { method: 'POST' });
      setViewMode('editor');
      await loadWorkspace();
      pushToast({ tone: 'info', title: 'Patch rejected', message: 'Original code preserved unchanged.' });
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Reject failed', message: err instanceof Error ? err.message : 'Error' });
    }
  };

  const handleRollback = async () => {
    if (!rollbackTarget) return;
    setRollingBack(true);
    try {
      await apiFetch(`/api/snapshots/${rollbackTarget.id}/rollback`, { method: 'POST' });
      setRollbackTarget(null);
      await Promise.all([loadWorkspace(), fetchProjects()]);
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Rollback failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setRollingBack(false);
    }
  };

  if (!activeProjectId) {
    return (
      <EmptyState
        icon={<Code2 className="h-5 w-5" />}
        title="No active project selected"
        description="Select or upload a project to inspect code in the Monaco Workbench."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1520px] space-y-5">
      {/* Header Toolbar */}
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 max-w-2xl">
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Code Workbench</h1>
          <p className="text-xs text-[#94A3B8]">
            Inspect diagnostics, review AI-proposed diffs with Fix Confidence & Change Risk scores, verify in Regression Guardian, and apply or roll back safely.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex rounded-md border border-[#00F5FF]/20 bg-[#0B1220] p-1">
            <button
              type="button"
              onClick={() => setViewMode('editor')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold',
                viewMode === 'editor' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              )}
            >
              <Code2 className="h-3.5 w-3.5" />
              Editor
            </button>
            <button
              type="button"
              onClick={() => setViewMode('diff')}
              disabled={!activeFix}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold disabled:opacity-40',
                viewMode === 'diff' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              )}
            >
              <GitCompare className="h-3.5 w-3.5" />
              Before / After Diff
            </button>
          </div>

          <select
            aria-label="Editor language"
            value={editorLang}
            onChange={(e) => setEditorLang(e.target.value)}
            className="rounded-md border border-[#00F5FF]/20 bg-[#101A2B] px-2.5 py-2 font-mono text-xs text-[#F1F5F9]"
          >
            {['typescript', 'javascript', 'python', 'java', 'c', 'cpp', 'go', 'rust', 'sql', 'html', 'css', 'json', 'php', 'csharp'].map(
              (l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              )
            )}
          </select>

          <button
            type="button"
            disabled={savingFile || !selectedFile}
            onClick={handleSaveFile}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#00F5FF]/30 bg-[#142238] px-3.5 py-2 text-xs font-semibold text-[#F1F5F9] hover:border-[#00F5FF] hover:text-[#00F5FF] disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {savingFile ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Main 3-Pane Workbench Grid */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left Pane: File Explorer + Bug List */}
        <div className="space-y-4 xl:col-span-3">
          <div className="cyber-panel rounded-lg p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#F1F5F9]">File Explorer</h2>
              <span className="font-mono text-[11px] text-[#94A3B8] tabular-nums">{files.length} files</span>
            </div>
            <div className="relative mt-2.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94A3B8]" />
              <input
                type="search"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Filter files or code..."
                aria-label="Filter project files"
                className="w-full rounded border border-[#00F5FF]/15 bg-[#070B14] py-1.5 pl-8 pr-2.5 text-xs text-[#F1F5F9] placeholder-[#94A3B8] focus:border-[#00F5FF] focus:outline-none"
              />
            </div>
            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
              {filteredFiles.map((f) => {
                const fileOpenBugs = bugs.filter((b) => b.file_path === f.path && b.status === 'open').length;
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => selectFile(f)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-xs transition-colors',
                        selectedFileId === f.id
                          ? 'bg-[#142238] text-[#00F5FF]'
                          : 'text-[#F1F5F9] hover:bg-[#0B1220]'
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
                        <span className="truncate font-mono">{f.path}</span>
                      </span>
                      {fileOpenBugs > 0 && (
                        <span className="shrink-0 font-mono text-[11px] font-semibold text-[#FF3864] tabular-nums">
                          {fileOpenBugs}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="cyber-panel rounded-lg p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#F1F5F9]">Detected Bugs</h2>
              <span className="font-mono text-[11px] text-[#94A3B8] tabular-nums">
                {bugs.filter((b) => b.status === 'open').length} open
              </span>
            </div>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
              {loading ? (
                <div className="py-6 text-center text-xs text-[#94A3B8]">Loading diagnostics...</div>
              ) : bugs.length === 0 ? (
                <div className="py-6 text-center text-xs text-[#94A3B8]">No bugs recorded for this project.</div>
              ) : (
                bugs.map((bug) => (
                  <button
                    key={bug.id}
                    type="button"
                    onClick={() => selectBug(bug)}
                    className={cn(
                      'block w-full rounded-md border p-3 text-left transition-colors',
                      selectedBugId === bug.id
                        ? 'border-[#00F5FF]/50 bg-[#142238]'
                        : 'border-[#00F5FF]/10 bg-[#0B1220] hover:border-[#00F5FF]/30'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <SeverityIndicator severity={bug.severity} />
                      <span className="font-mono text-[11px] text-[#94A3B8]">
                        {bug.status === 'resolved' ? 'Resolved' : `L${bug.line_number}`}
                      </span>
                    </div>
                    <div className="mt-1.5 text-xs font-semibold text-[#F1F5F9] line-clamp-2">{bug.title}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-[#94A3B8]">{bug.file_path}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center Pane: Monaco Editor / Before-After Diff */}
        <div className="space-y-4 xl:col-span-5">
          <div className="cyber-panel rounded-lg p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold text-[#00F5FF]">
                  {selectedFile?.path || 'No file selected'}
                </span>
                <span aria-hidden="true" className="text-[#94A3B8]">·</span>
                <span className="font-mono text-[#94A3B8]">
                  {viewMode === 'diff'
                    ? 'Original Code (left) vs AI-Proposed / Editable Approval Code (right)'
                    : `${selectedFile?.line_count ?? 0} lines`}
                </span>
              </div>
              {fileMarkers.length > 0 && (
                <span className="font-mono text-xs text-[#FFB020] tabular-nums">
                  {fileMarkers.length} inline diagnostic(s)
                </span>
              )}
            </div>

            {viewMode === 'diff' && activeFix ? (
              <MonacoDiffViewer
                original={selectedFile?.content ?? activeFix.original_code}
                modified={proposedDraft || activeFix.proposed_code}
                language={editorLang}
                height="500px"
                editableModified={activeFix.status === 'pending'}
                onModifiedChange={(val) => setProposedDraft(val)}
              />
            ) : (
              <MonacoCodeEditor
                value={editorContent}
                language={editorLang}
                onChange={setEditorContent}
                height="500px"
                markers={fileMarkers}
              />
            )}

            {/* Clear Provenance Banner */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#94A3B8]">
              <span>
                Code state:{' '}
                <strong className="text-[#F1F5F9]">
                  {viewMode === 'diff'
                    ? 'AI-Proposed Patch (unapplied — explicit approval required)'
                    : 'Live Repository Working Copy'}
                </strong>
              </span>
              <span className="font-mono">Ctrl/Cmd+Z undo supported</span>
            </div>
          </div>

          {/* One-Click Rollback Snapshots */}
          <div className="cyber-panel rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4 text-[#A855F7]" />
                <h2 className="text-sm font-semibold text-[#F1F5F9]">One-Click Rollback Snapshots</h2>
              </div>
              <span className="font-mono text-xs text-[#94A3B8] tabular-nums">
                {snapshots.filter((s) => s.status === 'active').length} active
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {snapshots.length === 0 ? (
                <p className="text-xs text-[#94A3B8]">
                  Snapshots are automatically captured before every approved patch so you can safely restore previous versions.
                </p>
              ) : (
                snapshots.slice(0, 5).map((snap) => (
                  <div
                    key={snap.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#00F5FF]/12 bg-[#0B1220] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-[#F1F5F9]">{snap.label}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-[#94A3B8]">
                        {new Date(snap.created_at).toLocaleString()} · {snap.files.map((f) => f.path).join(', ')}
                      </div>
                    </div>
                    {snap.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => setRollbackTarget(snap)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#FFB020]/40 bg-[#FFB020]/10 px-3 py-1.5 text-xs font-semibold text-[#FFB020] hover:bg-[#FFB020]/20 whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Rollback
                      </button>
                    ) : (
                      <span className="font-mono text-xs text-[#94A3B8]">Rolled back</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Pane: AI Explanation, Smart Fix Confidence & Risk Score, Approval Actions */}
        <div className="space-y-4 xl:col-span-4">
          {selectedBug ? (
            <div className="cyber-panel space-y-4 rounded-lg p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                    <SeverityIndicator severity={selectedBug.severity} />
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{selectedBug.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">Line {selectedBug.line_number}</span>
                  </div>
                  <h2 className="mt-1.5 text-base font-semibold text-[#F1F5F9]">{selectedBug.title}</h2>
                </div>
              </div>

              <div className="space-y-2 text-xs leading-relaxed text-[#94A3B8]">
                <p className="text-[#F1F5F9]">{selectedBug.description}</p>
                {selectedBug.root_cause && (
                  <p>
                    <strong className="text-[#F1F5F9]">Root cause:</strong> {selectedBug.root_cause}
                  </p>
                )}
                <p className="font-mono text-[11px]">Detected by: {selectedBug.analyzer_source}</p>
              </div>

              <div className="border-t border-[#00F5FF]/15 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#F1F5F9]">AI Patch & Smart Risk Analysis</h3>
                  <button
                    type="button"
                    disabled={generatingFix}
                    onClick={handleGenerateFix}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#A855F7]/40 bg-[#A855F7]/15 px-3 py-1.5 text-xs font-semibold text-[#F1F5F9] hover:bg-[#A855F7]/25 disabled:opacity-50"
                  >
                    {generatingFix ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5 text-[#A855F7]" />}
                    {activeFix ? 'Regenerate AI Fix' : 'Generate AI Fix'}
                  </button>
                </div>

                {activeFix ? (
                  <div className="mt-4 space-y-4">
                    {/* FEATURE 1: Separate Fix Confidence & Change Risk Gauges */}
                    <div className="grid grid-cols-2 gap-3 rounded-md border border-[#00F5FF]/15 bg-[#0B1220] p-4">
                      <CircularGauge
                        value={activeFix.confidence_score}
                        label="Fix Confidence"
                        sublabel="Resolution likelihood"
                        color="#00F5FF"
                        size={84}
                      />
                      <CircularGauge
                        value={activeFix.risk_score}
                        label="Change Risk"
                        sublabel={`${activeFix.risk_category} Risk`}
                        color={
                          activeFix.risk_category === 'Critical'
                            ? '#FF3864'
                            : activeFix.risk_category === 'High'
                              ? '#FFB020'
                              : activeFix.risk_category === 'Medium'
                                ? '#3B82F6'
                                : '#39FF88'
                        }
                        size={84}
                      />
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#F1F5F9]">Why this fix works</span>
                        <RiskText level={activeFix.risk_category} />
                      </div>
                      <p className="leading-relaxed text-[#94A3B8]">{activeFix.explanation}</p>
                      <p className="rounded-md bg-[#0B1220] p-2.5 text-[11px] leading-relaxed text-[#94A3B8]">
                        {activeFix.score_explanation}
                      </p>
                    </div>

                    {activeFix.scoreFactors.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-[#94A3B8]">Contributing Score Factors</div>
                        {activeFix.scoreFactors.map((factor, i) => (
                          <div
                            key={i}
                            className="flex items-start justify-between gap-2 rounded bg-[#0B1220] px-2.5 py-2 text-[11px]"
                          >
                            <div>
                              <div className="font-medium text-[#F1F5F9]">{factor.name}</div>
                              <div className="text-[#94A3B8]">{factor.detail}</div>
                            </div>
                            <span
                              className={cn(
                                'shrink-0 font-mono font-semibold',
                                factor.impact === 'positive'
                                  ? 'text-[#39FF88]'
                                  : factor.impact === 'negative'
                                    ? 'text-[#FFB020]'
                                    : 'text-[#94A3B8]'
                              )}
                            >
                              {factor.weight}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Inline Regression Guardian Verification */}
                    {lastRegressionSummary && (
                      <div
                        className={cn(
                          'rounded-md border p-3 text-xs',
                          lastRegressionSummary.regressionDetected
                            ? 'border-[#FF3864]/40 bg-[#FF3864]/10 text-[#FF3864]'
                            : 'border-[#39FF88]/35 bg-[#39FF88]/10 text-[#39FF88]'
                        )}
                      >
                        <div className="font-semibold">{lastRegressionSummary.summary}</div>
                        <div className="mt-1 font-mono text-[11px] text-[#F1F5F9] tabular-nums">
                          Baseline: {lastRegressionSummary.baselinePassed}/{lastRegressionSummary.baselineTotal} · Patched:{' '}
                          {lastRegressionSummary.patchedPassed}/{lastRegressionSummary.patchedTotal}
                        </div>
                      </div>
                    )}

                    {/* Explicit Approval Action Bar */}
                    {activeFix.status === 'pending' ? (
                      <div className="space-y-2 border-t border-[#00F5FF]/15 pt-4">
                        <button
                          type="button"
                          disabled={runningRegression}
                          onClick={handleRunRegression}
                          className="flex w-full items-center justify-center gap-2 rounded-md border border-[#39FF88]/40 bg-[#39FF88]/10 px-4 py-2 text-xs font-semibold text-[#39FF88] transition-colors hover:bg-[#39FF88]/20 disabled:opacity-50"
                        >
                          {runningRegression ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          )}
                          Run Regression Guardian (Isolated Sandbox)
                        </button>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            disabled={applyingPatch}
                            onClick={handleApplyPatch}
                            className="cyber-glow-cyan inline-flex items-center justify-center gap-1.5 rounded-md bg-[#00F5FF] px-3 py-2 text-xs font-semibold text-[#070B14] hover:bg-[#33f7ff] disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {applyingPatch ? 'Applying...' : 'Apply Patch'}
                          </button>
                          <button
                            type="button"
                            onClick={handleRejectPatch}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#FF3864]/40 bg-[#FF3864]/10 px-3 py-2 text-xs font-semibold text-[#FF3864] hover:bg-[#FF3864]/20"
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject Patch
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md bg-[#0B1220] p-3 font-mono text-xs text-[#94A3B8]">
                        Patch status: <strong className="text-[#39FF88]">{activeFix.status}</strong>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[#94A3B8]">
                    No AI patch has been generated for this issue yet. Click "Generate AI Fix" to synthesize an explainable patch via Gemini.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Select a diagnostic"
              description="Choose any detected bug on the left to inspect its root cause, Fix Confidence & Change Risk scores, and diff."
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(rollbackTarget)}
        title="Confirm One-Click Rollback"
        description="Restore these files to their exact pre-patch snapshot state? Your audit history will be fully preserved and a rollback entry will be recorded."
        details={rollbackTarget?.files.map((f) => f.path)}
        confirmLabel="Restore Snapshot"
        danger
        busy={rollingBack}
        onConfirm={handleRollback}
        onCancel={() => setRollbackTarget(null)}
      />
    </div>
  );
}
