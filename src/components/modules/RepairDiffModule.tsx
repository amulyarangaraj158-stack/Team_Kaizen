import React, { useState, useEffect, useCallback } from 'react';
import { SafeDiffEditor } from '../ui/SafeMonaco';
import {
  Wrench,
  Loader2,
  Check,
  X,
  Download,
  FileArchive,
  ShieldCheck,
  AlertTriangle,
  FlaskConical,
} from 'lucide-react';
import { apiRequest, downloadAuthorizedBlob } from '../../lib/api';
import { downloadTextFile, severityTextClass, statusLabel, toMonacoLanguage } from '../../lib/format';
import type { DetectedBug, ProjectSummary, SuggestedFix, UploadedFile, WorkspaceModule } from '../../types';
import { EmptyState } from '../ui/ToastAndConfirm';

interface RepairDiffModuleProps {
  project: ProjectSummary | null;
  files: UploadedFile[];
  bugs: DetectedBug[];
  selectedBugId: string | null;
  onSelectBugId: (bugId: string | null) => void;
  onRefreshProjectData: () => Promise<void>;
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
  onConfirm: (opts: { title: string; message: string; confirmLabel: string; destructive?: boolean; onConfirm: () => Promise<void> }) => void;
}

export function RepairDiffModule({
  project,
  files,
  bugs,
  selectedBugId,
  onSelectBugId,
  onRefreshProjectData,
  onNavigate,
  onNotify,
  onConfirm,
}: RepairDiffModuleProps) {
  const [fixes, setFixes] = useState<SuggestedFix[]>([]);
  const [generating, setGenerating] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const loadFixes = useCallback(async () => {
    if (!project) return;
    try {
      const res = await apiRequest<{ fixes: SuggestedFix[] }>(`/api/projects/${project.id}/fixes`);
      setFixes(res.fixes);
    } catch {
      // ignore initial error
    }
  }, [project]);

  useEffect(() => {
    void loadFixes();
  }, [loadFixes]);

  useEffect(() => {
    if (bugs.length > 0 && (!selectedBugId || !bugs.some((b) => b.id === selectedBugId))) {
      onSelectBugId(bugs[0].id);
    }
  }, [bugs, selectedBugId, onSelectBugId]);

  const activeBug = bugs.find((b) => b.id === selectedBugId) || bugs[0] || null;
  const activeFile = activeBug ? files.find((f) => f.id === activeBug.file_id) || null : null;
  const bugFixes = activeBug ? fixes.filter((f) => f.bug_id === activeBug.id) : [];
  const latestFix = bugFixes[0] || null;

  useEffect(() => {
    if (!latestFix?.id) return;
    apiRequest(`/api/fixes/${latestFix.id}/review`, { method: 'POST' }).catch(() => {
      // ignore passive audit review error
    });
  }, [latestFix?.id]);

  const handleGeneratePatch = async () => {
    if (!activeBug) return;
    setGenerating(true);
    try {
      const data = await apiRequest<{ fix: SuggestedFix }>(`/api/bugs/${activeBug.id}/generate-fix`, {
        method: 'POST',
      });
      await loadFixes();
      await onRefreshProjectData();
      onNotify(
        'success',
        'AI Repair Patch Generated',
        `Safe Repair Mode: inspect the diff (${data.fix.confidence}% confidence) before approving.`
      );
    } catch (err: unknown) {
      onNotify('error', 'Patch generation failed', err instanceof Error ? err.message : 'Gemini AI error.');
    } finally {
      setGenerating(false);
    }
  };

  const handleAcceptPatch = (fix: SuggestedFix) => {
    onConfirm({
      title: 'Accept & Apply AI Patch?',
      message: `Safe Repair Mode will update the active working copy of ${activeBug?.file_path || 'the file'}. Your immutable original upload baseline will remain untouched and reversible in Patch Rollback.`,
      confirmLabel: 'Apply Patch Safely',
      onConfirm: async () => {
        setActionBusy(true);
        try {
          await apiRequest(`/api/fixes/${fix.id}/accept`, { method: 'POST' });
          await loadFixes();
          await onRefreshProjectData();
          onNotify(
            'success',
            'Patch Accepted & Applied',
            'Proceed to Test Guardian to validate the fix before marking it Verified.'
          );
        } finally {
          setActionBusy(false);
        }
      },
    });
  };

  const handleRejectPatch = async (fix: SuggestedFix) => {
    setActionBusy(true);
    try {
      await apiRequest(`/api/fixes/${fix.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Rejected after side-by-side diff inspection' }),
      });
      await loadFixes();
      await onRefreshProjectData();
      onNotify('info', 'Patch Rejected', 'Original working file remains untouched.');
    } catch (err: unknown) {
      onNotify('error', 'Reject failed', err instanceof Error ? err.message : 'Unable to reject patch.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!project) return;
    setDownloadingZip(true);
    try {
      const safeName = project.name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
      await downloadAuthorizedBlob(`/api/projects/${project.id}/download-zip`, `${safeName}-repaired.zip`);
      onNotify('success', 'Repaired ZIP Downloaded', 'Archive contains your latest approved working files.');
    } catch (err: unknown) {
      onNotify('error', 'Download failed', err instanceof Error ? err.message : 'Unable to export ZIP.');
    } finally {
      setDownloadingZip(false);
    }
  };

  if (!project) {
    return (
      <EmptyState
        title="Select a project to open Repair & Diff"
        description="Generate minimal Gemini AI patches and review side-by-side Monaco diffs in Safe Repair Mode."
        actionLabel="Go to Projects & Upload"
        onAction={() => onNavigate('projects')}
        icon={<Wrench className="w-5 h-5" />}
      />
    );
  }

  if (bugs.length === 0) {
    return (
      <EmptyState
        title="No detected bugs to repair"
        description="Run an AI Scan in Scanner & RCA first to detect defects eligible for automated patching."
        actionLabel="Open Scanner & RCA"
        onAction={() => onNavigate('scanner')}
        icon={<Wrench className="w-5 h-5" />}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Repair & Diff Editor</h1>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-emerald-400 flex items-center gap-1 font-medium">
              <ShieldCheck className="w-3.5 h-3.5" />
              Safe Repair Mode Active
            </span>
            <span>·</span>
            <span>Original uploaded files remain immutable baselines until you explicitly approve changes.</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeFile && (
            <button
              type="button"
              onClick={() => downloadTextFile(activeFile.file_name, latestFix?.patched_code || activeFile.current_content)}
              className="px-3 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Download Repaired File
            </button>
          )}
          <button
            type="button"
            disabled={downloadingZip}
            onClick={handleDownloadZip}
            className="px-3 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {downloadingZip ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileArchive className="w-3.5 h-3.5 text-violet-400" />}
            Download Repaired ZIP
          </button>
        </div>
      </div>

      {/* Bug Selector + Generate Patch Bar */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="block text-[11px] font-mono text-slate-500 mb-1">Target Defect</label>
          <select
            value={activeBug?.id || ''}
            onChange={(e) => onSelectBugId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-[#080D19] border border-[#1E2B4A] rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {bugs.map((b) => (
              <option key={b.id} value={b.id}>
                [{b.severity.toUpperCase()}] {b.title} — {b.file_path} (L{b.line_start}) [{statusLabel(b.status).text}]
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 md:pt-4">
          <button
            type="button"
            disabled={generating || !activeBug}
            onClick={handleGeneratePatch}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
            {generating ? 'Generating Minimal Patch...' : latestFix ? 'Regenerate AI Patch' : 'Generate AI Patch'}
          </button>

          {latestFix && latestFix.status === 'pending' && (
            <>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => handleAcceptPatch(latestFix)}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                Accept Patch
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => handleRejectPatch(latestFix)}
                className="px-3.5 py-2 text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                Reject
              </button>
            </>
          )}

          {latestFix && (latestFix.status === 'accepted' || latestFix.status === 'pending') && (
            <button
              type="button"
              onClick={() => onNavigate('testing')}
              className="px-3.5 py-2 text-xs font-medium text-violet-200 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Validate in Test Guardian
            </button>
          )}
        </div>
      </div>

      {/* Diff Editor & Patch Explanation */}
      {!latestFix ? (
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-10 text-center space-y-3">
          <Wrench className="w-8 h-8 text-blue-400 mx-auto" />
          <h2 className="text-base font-semibold text-white font-display">No AI Patch Generated for This Defect Yet</h2>
          <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
            Click <strong className="text-slate-200">Generate AI Patch</strong> to have Gemini synthesize a minimal surgical patch for{' '}
            <span className="font-mono text-blue-300">{activeBug?.file_path}</span>. You will review the side-by-side diff and risks before anything is applied.
          </p>
          {activeBug && (
            <div className="text-xs text-slate-400 pt-2">
              <span className={`font-mono uppercase font-semibold ${severityTextClass(activeBug.severity)}`}>
                {activeBug.severity}
              </span>
              <span className="mx-2">·</span>
              <span>{activeBug.root_cause}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* Patch Metadata & Risks */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 className="text-sm font-semibold text-white font-display">Patch Explanation</h2>
                <div className="flex items-center gap-3 text-xs font-mono">
                  <span className="text-blue-400 tabular-nums">Fix Confidence: {latestFix.confidence}%</span>
                  <span className="text-slate-600">·</span>
                  <span className="capitalize text-slate-300">Patch Status: {latestFix.status}</span>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{latestFix.explanation}</p>
            </div>

            <div className="lg:col-span-4 bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-amber-300 font-display flex items-center gap-1.5 mb-2">
                <AlertTriangle className="w-4 h-4" />
                Potential Repair Risks
              </h2>
              {latestFix.risks?.length ? (
                <ul className="space-y-1.5 text-xs text-slate-300 list-disc pl-4">
                  {latestFix.risks.map((risk, idx) => (
                    <li key={idx} className="leading-relaxed">{risk}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">Minimal localized change with low regression risk.</p>
              )}
            </div>
          </div>

          {/* Monaco Side-by-Side Diff Editor */}
          <div className="bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-[#090F1E] border-b border-[#162038] flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">
                Left: Original Baseline ({activeBug?.file_path})
              </span>
              <span className="text-emerald-400">
                Right: AI Repaired Patch ({latestFix.status})
              </span>
            </div>
            <div className="h-[520px]">
              <SafeDiffEditor
                height="100%"
                theme="vs-dark"
                language={toMonacoLanguage(activeFile?.language || 'javascript')}
                original={latestFix.original_code}
                modified={latestFix.patched_code}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
