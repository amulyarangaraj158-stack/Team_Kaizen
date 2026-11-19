import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  Filter,
  GitCommitHorizontal,
  History,
  RotateCcw,
  ShieldCheck,
  TestTube2,
  XCircle,
  Bug,
  Wrench,
} from 'lucide-react';
import { apiRequest, downloadAuthorizedBlob } from '../../lib/api';
import { exportAuditTrailPdf, formatTimestamp, toMonacoLanguage } from '../../lib/format';
import type { PatchAuditEvent, ProjectSummary } from '../../types';
import { LoadingPanel } from '../ui/ToastAndConfirm';
import { SafeDiffEditor } from '../ui/SafeMonaco';

interface PatchAuditTrailModuleProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  onNotify: (type: 'success' | 'error' | 'info' | 'warning', title: string, desc?: string) => void;
  onRefreshWorkspace: () => Promise<void>;
  refreshTrigger: number;
}

const EVENT_STYLE: Record<
  PatchAuditEvent['event_type'],
  { label: string; colorClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  bug_detected: { label: 'Bug Detected', colorClass: 'text-amber-400', icon: Bug },
  patch_generated: { label: 'Patch Generated', colorClass: 'text-cyan-400', icon: Wrench },
  patch_reviewed: { label: 'Patch Reviewed', colorClass: 'text-violet-400', icon: Eye },
  patch_accepted: { label: 'Patch Accepted', colorClass: 'text-emerald-400', icon: CheckCircle2 },
  patch_rejected: { label: 'Patch Rejected', colorClass: 'text-slate-400', icon: XCircle },
  tests_executed: { label: 'Tests Executed', colorClass: 'text-blue-400', icon: TestTube2 },
  patch_verified: { label: 'Patch Verified', colorClass: 'text-emerald-300', icon: ShieldCheck },
  rollback_executed: { label: 'Rollback Executed', colorClass: 'text-red-400', icon: RotateCcw },
};

function guessLangFromFile(filePath: string): string {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    sql: 'sql',
    html: 'html',
    css: 'css',
    json: 'json',
    php: 'php',
  };
  return toMonacoLanguage(map[ext] || 'plaintext');
}

export const PatchAuditTrailModule: React.FC<PatchAuditTrailModuleProps> = ({
  projects,
  selectedProjectId,
  onNotify,
  onRefreshWorkspace,
  refreshTrigger,
}) => {
  const [events, setEvents] = useState<PatchAuditEvent[]>([]);
  const [counts, setCounts] = useState({ total: 0, accepted: 0, rejected: 0, verified: 0, rollbacks: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Filters
  const [filterProject, setFilterProject] = useState<string>(selectedProjectId || 'all');
  const [filterFile, setFilterFile] = useState('');
  const [filterBugId, setFilterBugId] = useState('');
  const [filterDeveloper, setFilterDeveloper] = useState('');
  const [filterDecision, setFilterDecision] = useState('all');
  const [filterTestStatus, setFilterTestStatus] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (filterProject && filterProject !== 'all') params.set('projectId', filterProject);
    if (filterFile.trim()) params.set('file', filterFile.trim());
    if (filterBugId.trim()) params.set('bugId', filterBugId.trim());
    if (filterDeveloper.trim()) params.set('developer', filterDeveloper.trim());
    if (filterDecision !== 'all') params.set('decision', filterDecision);
    if (filterTestStatus !== 'all') params.set('testStatus', filterTestStatus);
    if (filterDateFrom) params.set('dateFrom', filterDateFrom);
    if (filterDateTo) params.set('dateTo', filterDateTo);
    return params.toString();
  }, [
    filterProject,
    filterFile,
    filterBugId,
    filterDeveloper,
    filterDecision,
    filterTestStatus,
    filterDateFrom,
    filterDateTo,
  ]);

  const loadAuditTrail = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQueryString();
      const res = await apiRequest<{
        events: PatchAuditEvent[];
        counts: { total: number; accepted: number; rejected: number; verified: number; rollbacks: number };
      }>(`/api/audit-trail${qs ? `?${qs}` : ''}`);
      setEvents(res.events);
      setCounts(res.counts);
      setSelectedEventId((curr) => {
        if (curr && res.events.some((e) => e.id === curr)) return curr;
        return res.events[0]?.id || null;
      });
    } catch (err: unknown) {
      onNotify('error', 'Failed to load Patch Audit Trail', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [buildQueryString, onNotify]);

  useEffect(() => {
    void loadAuditTrail();
  }, [loadAuditTrail, refreshTrigger]);

  const handleExportCsv = async () => {
    try {
      const qs = buildQueryString();
      await downloadAuthorizedBlob(
        `/api/audit-trail/export-csv${qs ? `?${qs}` : ''}`,
        `autopatch-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`
      );
      await onRefreshWorkspace();
      onNotify('success', 'Audit Trail Exported (CSV)', `${events.length} append-only audit event(s) downloaded.`);
    } catch (err: unknown) {
      onNotify('error', 'CSV export failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleExportPdf = async () => {
    try {
      const projLabel =
        filterProject === 'all'
          ? 'All Projects'
          : projects.find((p) => p.id === filterProject)?.name || filterProject;
      exportAuditTrailPdf(events, `Scope: ${projLabel}`);
      await apiRequest('/api/notifications/report-generated', {
        method: 'POST',
        body: JSON.stringify({
          projectId: filterProject !== 'all' ? filterProject : null,
          reportType: 'Patch Audit Trail PDF',
          projectName: projLabel,
        }),
      });
      await onRefreshWorkspace();
      onNotify('success', 'Audit Trail Exported (PDF)', `${events.length} append-only audit event(s) exported.`);
    } catch (err: unknown) {
      onNotify('error', 'PDF export failed', err instanceof Error ? err.message : undefined);
    }
  };

  const activeEvent = events.find((e) => e.id === selectedEventId) || null;
  const hasDiff = Boolean(
    activeEvent && (activeEvent.original_code || activeEvent.proposed_code || activeEvent.modified_code)
  );

  return (
    <div className="space-y-6">
      {/* Header & Exports */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2.5">
            <History className="w-5 h-5 text-cyan-400" />
            Patch Audit Trail
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Append-only governance ledger recording every bug detection, AI patch generation, developer diff review,
            approval/rejection decision, test verification, and rollback event.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleExportCsv()}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#10192D] hover:bg-[#162340] border border-[#1E2B48] text-slate-200 rounded-md transition-colors"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
            Export CSV
          </button>
          <button
            onClick={() => void handleExportPdf()}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total Audit Events', value: counts.total, color: 'text-white' },
          { label: 'Patches Accepted', value: counts.accepted, color: 'text-emerald-400' },
          { label: 'Patches Verified', value: counts.verified, color: 'text-cyan-400' },
          { label: 'Patches Rejected', value: counts.rejected, color: 'text-slate-300' },
          { label: 'Rollbacks Logged', value: counts.rollbacks, color: 'text-amber-400' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-[#0C1324] border border-[#19243E] rounded-lg p-3.5">
            <div className="text-[11px] text-slate-400">{kpi.label}</div>
            <div className={`text-xl font-semibold tabular-nums mt-1 ${kpi.color}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Multi-Criteria Filter Bar */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-cyan-400" />
            Filter Append-Only Audit Ledger
          </span>
          <button
            onClick={() => {
              setFilterProject('all');
              setFilterFile('');
              setFilterBugId('');
              setFilterDeveloper('');
              setFilterDecision('all');
              setFilterTestStatus('all');
              setFilterDateFrom('');
              setFilterDateTo('');
            }}
            className="text-[11px] text-slate-400 hover:text-cyan-300"
          >
            Reset Filters
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <select
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200"
          >
            <option value="all">All Projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={filterFile}
            onChange={(e) => setFilterFile(e.target.value)}
            placeholder="Filter by file path..."
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200 placeholder:text-slate-500"
          />

          <input
            type="text"
            value={filterBugId}
            onChange={(e) => setFilterBugId(e.target.value)}
            placeholder="Filter by Bug ID or title..."
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200 placeholder:text-slate-500"
          />

          <input
            type="text"
            value={filterDeveloper}
            onChange={(e) => setFilterDeveloper(e.target.value)}
            placeholder="Filter by developer / actor..."
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200 placeholder:text-slate-500"
          />

          <select
            value={filterDecision}
            onChange={(e) => setFilterDecision(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200"
          >
            <option value="all">All Decisions</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="rolled_back">Rolled Back</option>
            <option value="pending">Pending Review</option>
          </select>

          <select
            value={filterTestStatus}
            onChange={(e) => setFilterTestStatus(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200"
          >
            <option value="all">All Test Statuses</option>
            <option value="passed">Passed</option>
            <option value="static_verified">Static Verified</option>
            <option value="failed">Failed</option>
            <option value="regression">Regression Detected</option>
          </select>

          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200"
            title="Start date"
          />

          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200"
            title="End date"
          />
        </div>
      </div>

      {/* Main Split: Chronological Timeline + Inspector / Monaco Diff */}
      {loading ? (
        <LoadingPanel message="Loading Patch Audit Trail..." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Chronological Timeline */}
          <div className="lg:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden flex flex-col max-h-[680px]">
            <div className="px-4 py-3 border-b border-[#19243E] bg-[#090F1E]">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Chronological Patch Lifecycle ({events.length})
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {events.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No audit events match the active filters.
                </div>
              ) : (
                events.map((ev) => {
                  const cfg = EVENT_STYLE[ev.event_type] || {
                    label: ev.event_type,
                    colorClass: 'text-slate-300',
                    icon: GitCommitHorizontal,
                  };
                  const Icon = cfg.icon;
                  const active = ev.id === selectedEventId;
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setSelectedEventId(ev.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        active
                          ? 'bg-[#121D36] border-cyan-500/45'
                          : 'bg-[#090F1E] border-[#19243E] hover:border-[#24355B]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-semibold flex items-center gap-1.5 ${cfg.colorClass}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {cfg.label}
                        </span>
                        <span className="text-[10px] text-slate-500 tabular-nums">
                          {formatTimestamp(ev.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-200 mt-1.5 leading-snug">{ev.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        <span className="font-mono text-cyan-300/90 truncate max-w-[180px]">
                          {ev.file_path || 'Project'}
                        </span>
                        <span>Actor: {ev.actor_name}</span>
                        {ev.project_name && <span className="text-slate-500">{ev.project_name}</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Selected Audit Event Inspector & Diff Viewer */}
          <div className="lg:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden flex flex-col">
            {!activeEvent ? (
              <div className="p-10 text-center text-xs text-slate-500">
                Select an event from the timeline to inspect full provenance metadata and code comparison.
              </div>
            ) : (
              <>
                <div className="px-5 py-4 border-b border-[#19243E] bg-[#090F1E] space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white">
                      {EVENT_STYLE[activeEvent.event_type]?.label || activeEvent.event_type}
                    </h3>
                    <span className="text-[11px] font-mono text-slate-400">
                      Event ID: {activeEvent.id.slice(0, 12)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{activeEvent.summary}</p>
                </div>

                <div className="p-4 border-b border-[#19243E] grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="bg-[#090F1E] border border-[#19243E] rounded p-2.5">
                    <div className="text-[10px] uppercase text-slate-500">Project</div>
                    <div className="text-slate-100 mt-0.5 truncate">{activeEvent.project_name || activeEvent.project_id}</div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded p-2.5">
                    <div className="text-[10px] uppercase text-slate-500">File</div>
                    <div className="font-mono text-cyan-300 mt-0.5 truncate">{activeEvent.file_path || 'n/a'}</div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded p-2.5">
                    <div className="text-[10px] uppercase text-slate-500">Actor / Developer</div>
                    <div className="text-slate-100 mt-0.5 truncate">{activeEvent.actor_name}</div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded p-2.5">
                    <div className="text-[10px] uppercase text-slate-500">Decision Status</div>
                    <div className="text-slate-100 mt-0.5 capitalize">{activeEvent.decision_status || 'n/a'}</div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded p-2.5">
                    <div className="text-[10px] uppercase text-slate-500">Test Status</div>
                    <div className="text-slate-100 mt-0.5 capitalize">{activeEvent.test_status || 'n/a'}</div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded p-2.5">
                    <div className="text-[10px] uppercase text-slate-500">Bug / Patch Ref</div>
                    <div className="font-mono text-slate-300 mt-0.5 truncate">
                      {activeEvent.bug_id ? `Bug ${activeEvent.bug_id.slice(0, 8)}` : '—'}
                      {activeEvent.patch_id ? ` · Patch ${activeEvent.patch_id.slice(0, 8)}` : ''}
                    </div>
                  </div>
                </div>

                {/* Diff Comparison */}
                <div className="p-4 flex-1 flex flex-col min-h-[380px]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
                      {activeEvent.event_type === 'rollback_executed'
                        ? 'Code Diff: Pre-Rollback vs Restored State'
                        : 'Code Diff: Original Code vs Proposed / Applied Patch'}
                    </span>
                  </div>

                  {hasDiff ? (
                    <div className="flex-1 min-h-[340px] border border-[#19243E] rounded-md overflow-hidden">
                      <SafeDiffEditor
                        height="360px"
                        language={guessLangFromFile(activeEvent.file_path)}
                        original={activeEvent.original_code || ''}
                        modified={activeEvent.modified_code || activeEvent.proposed_code || ''}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 bg-[#090F1E] border border-[#19243E] rounded-md p-6 flex flex-col items-center justify-center text-center text-xs text-slate-400">
                      <p>No code snapshot diff is attached to this lifecycle event ({activeEvent.event_type}).</p>
                      {activeEvent.metadata && Object.keys(activeEvent.metadata).length > 0 && (
                        <pre className="mt-3 p-3 bg-[#070B14] border border-[#19243E] rounded text-[11px] font-mono text-slate-300 max-w-full overflow-x-auto text-left">
                          {JSON.stringify(activeEvent.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
