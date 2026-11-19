import React, { useEffect, useState, useCallback } from 'react';
import { SafeDiffEditor } from '../ui/SafeMonaco';
import { RotateCcw, History, Loader2 } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatTimestamp, toMonacoLanguage } from '../../lib/format';
import type { ChangeHistoryRecord, ProjectSummary, UploadedFile, WorkspaceModule } from '../../types';
import { EmptyState, LoadingPanel } from '../ui/ToastAndConfirm';

interface PatchRollbackModuleProps {
  project: ProjectSummary | null;
  files: UploadedFile[];
  onRefreshProjectData: () => Promise<void>;
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
  onConfirm: (opts: { title: string; message: string; confirmLabel: string; destructive?: boolean; onConfirm: () => Promise<void> }) => void;
  refreshTrigger: number;
}

export function PatchRollbackModule({
  project,
  files,
  onRefreshProjectData,
  onNavigate,
  onNotify,
  onConfirm,
  refreshTrigger,
}: PatchRollbackModuleProps) {
  const [changes, setChanges] = useState<ChangeHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<'entry_diff' | 'vs_current'>('vs_current');
  const [rollingBack, setRollingBack] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const res = await apiRequest<{ changes: ChangeHistoryRecord[] }>(`/api/projects/${project.id}/history`);
      setChanges(res.changes);
      if (res.changes.length > 0) {
        setSelectedId((prev) =>
          prev && res.changes.some((c) => c.id === prev) ? prev : res.changes[0].id
        );
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, refreshTrigger]);

  if (!project) {
    return (
      <EmptyState
        title="Select a project to view Patch Rollback"
        description="Every accepted patch, rejected patch, and rollback is recorded in an auditable timeline."
        actionLabel="Go to Projects & Upload"
        onAction={() => onNavigate('projects')}
        icon={<History className="w-5 h-5" />}
      />
    );
  }

  if (loading && changes.length === 0) return <LoadingPanel message="Loading patch audit trail..." />;

  const selectedChange = changes.find((c) => c.id === selectedId) || changes[0] || null;
  const matchedFile = selectedChange ? files.find((f) => f.id === selectedChange.file_id) : null;

  const triggerRollback = (change: ChangeHistoryRecord, target: 'before' | 'after') => {
    onConfirm({
      title: `Confirm Rollback on ${change.file_path}?`,
      message:
        target === 'before'
          ? `This restores ${change.file_path} to its pre-patch state from ${formatTimestamp(change.created_at)} and logs a new auditable rollback entry.`
          : `This restores ${change.file_path} to the archived post-patch snapshot from ${formatTimestamp(change.created_at)} and logs a new audit entry.`,
      confirmLabel: 'Confirm Rollback',
      destructive: true,
      onConfirm: async () => {
        setRollingBack(true);
        try {
          await apiRequest(`/api/history/${change.id}/rollback`, {
            method: 'POST',
            body: JSON.stringify({ target }),
          });
          await loadHistory();
          await onRefreshProjectData();
          onNotify('warning', 'Rollback Completed', `${change.file_path} has been restored and audited.`);
        } catch (err: unknown) {
          onNotify('error', 'Rollback failed', err instanceof Error ? err.message : 'Unable to restore snapshot.');
        } finally {
          setRollingBack(false);
        }
      },
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Patch Rollback & Audit Trail</h1>
          <p className="text-xs text-slate-400 mt-1">
            Inspect every accepted patch, rejection, and rollback for{' '}
            <span className="text-slate-200 font-medium">{project.name}</span>. Confirmation is mandatory before restoring.
          </p>
        </div>

        {selectedChange && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={rollingBack}
              onClick={() => triggerRollback(selectedChange, 'before')}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              {rollingBack ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Restore Pre-Patch Version
            </button>
            {selectedChange.action_type === 'patch_accepted' && (
              <button
                type="button"
                disabled={rollingBack}
                onClick={() => triggerRollback(selectedChange, 'after')}
                className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors whitespace-nowrap"
              >
                Restore Accepted Snapshot
              </button>
            )}
          </div>
        )}
      </div>

      {changes.length === 0 ? (
        <EmptyState
          title="No patch history recorded yet"
          description="Accept or reject an AI patch in Repair & Diff to start building your auditable rollback log."
          actionLabel="Open Repair & Diff"
          onAction={() => onNavigate('repair')}
          icon={<History className="w-5 h-5" />}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Audit Timeline */}
          <div className="xl:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-[#090F1E] border-b border-[#162038] text-xs font-medium text-slate-200">
              Auditable Patch & Rollback Log ({changes.length})
            </div>
            <div className="divide-y divide-[#141E34] max-h-[580px] overflow-y-auto">
              {changes.map((ch) => {
                const isActive = selectedChange?.id === ch.id;
                const actionColor =
                  ch.action_type === 'patch_accepted'
                    ? 'text-emerald-400'
                    : ch.action_type === 'rollback'
                      ? 'text-amber-400'
                      : 'text-slate-400';
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setSelectedId(ch.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      isActive ? 'bg-blue-600/15' : 'hover:bg-[#111B33]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono mb-1">
                      <span className={`uppercase font-semibold ${actionColor}`}>
                        {ch.action_type.replace('_', ' ')}
                      </span>
                      <span className="text-slate-500 tabular-nums">{formatTimestamp(ch.created_at)}</span>
                    </div>
                    <p className="text-xs font-mono text-blue-300 truncate">{ch.file_path}</p>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">{ch.notes}</p>
                    <p className="text-[11px] text-slate-500 mt-1.5">Developer: {ch.user_name}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Diff Comparison */}
          <div className="xl:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 bg-[#090F1E] border-b border-[#162038] flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-mono text-slate-200">{selectedChange?.file_path}</span>
              <div className="flex items-center gap-1 p-0.5 bg-[#080D19] border border-[#18233C] rounded-lg">
                <button
                  type="button"
                  onClick={() => setCompareMode('vs_current')}
                  className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                    compareMode === 'vs_current' ? 'bg-[#192645] text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Restorable vs Current File
                </button>
                <button
                  type="button"
                  onClick={() => setCompareMode('entry_diff')}
                  className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                    compareMode === 'entry_diff' ? 'bg-[#192645] text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Original Entry Before/After
                </button>
              </div>
            </div>

            {selectedChange && (
              <div className="h-[540px]">
                <SafeDiffEditor
                  height="100%"
                  theme="vs-dark"
                  language={toMonacoLanguage(matchedFile?.language || 'javascript')}
                  original={selectedChange.before_content}
                  modified={
                    compareMode === 'vs_current'
                      ? selectedChange.latest_file_content || matchedFile?.current_content || selectedChange.after_content
                      : selectedChange.after_content
                  }
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    fontSize: 12.5,
                    fontFamily: 'JetBrains Mono, monospace',
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
