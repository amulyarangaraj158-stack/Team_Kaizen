import React, { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Download, FileText, History, RotateCcw } from 'lucide-react';
import { apiFetch, PatchSnapshot } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { cn, ConfirmDialog, RiskText } from '../components/ui/Primitives';
import { MonacoDiffViewer } from '../components/MonacoCodeViewer';

interface AuditEvent {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  project_id: string;
  project_name: string;
  bug_id: string | null;
  bug_title: string | null;
  file_path: string | null;
  action: string;
  bug_category: string;
  risk_level: string;
  confidence_score: number | null;
  risk_score: number | null;
  original_code: string;
  proposed_code: string;
  accepted_code: string;
  test_summary: string;
  created_at: string;
}

export function AuditTrailPage() {
  const { projects, activeProjectId, fetchProjects, pushToast } = useAppStore();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [snapshots, setSnapshots] = useState<PatchSnapshot[]>([]);
  const [rollbackTarget, setRollbackTarget] = useState<PatchSnapshot | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  const [filterProject, setFilterProject] = useState<string>('all');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterRisk, setFilterRisk] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const loadAudit = async () => {
    const params = new URLSearchParams();
    if (filterProject !== 'all') params.set('projectId', filterProject);
    if (filterAction !== 'all') params.set('action', filterAction);
    if (filterRisk !== 'all') params.set('riskLevel', filterRisk);
    if (filterCategory !== 'all') params.set('category', filterCategory);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);

    try {
      const res = await apiFetch<{ events: AuditEvent[] }>(`/api/audit?${params.toString()}`);
      setEvents(res.events);
      if (res.events.length > 0) {
        setSelectedEvent((prev) => res.events.find((e) => e.id === prev?.id) || res.events[0]);
      } else {
        setSelectedEvent(null);
      }
    } catch {
      setEvents([]);
    }
  };

  const loadSnapshots = async () => {
    const pid = filterProject !== 'all' ? filterProject : activeProjectId;
    if (!pid) {
      setSnapshots([]);
      return;
    }
    try {
      const res = await apiFetch<{ snapshots: PatchSnapshot[] }>(`/api/projects/${pid}/snapshots`);
      setSnapshots(res.snapshots);
    } catch {
      setSnapshots([]);
    }
  };

  useEffect(() => {
    loadAudit();
  }, [filterProject, filterAction, filterRisk, filterCategory, dateFrom, dateTo]);

  useEffect(() => {
    loadSnapshots();
  }, [filterProject, activeProjectId]);

  const handleExportCsv = async () => {
    try {
      const csv = await apiFetch<string>('/api/audit/export/csv', { raw: true });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'autopatch-audit-trail.csv';
      a.click();
      URL.revokeObjectURL(url);
      pushToast({ tone: 'success', title: 'CSV exported', message: 'Downloaded autopatch-audit-trail.csv.' });
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'CSV export failed', message: err instanceof Error ? err.message : 'Error' });
    }
  };

  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(16);
    doc.text('AutoPatch AI — Patch Audit Trail Report', 14, 18);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toISOString()} · Records: ${events.length}`, 14, 25);

    let y = 35;
    doc.setFontSize(8);
    for (const evt of events.slice(0, 35)) {
      const line = `${new Date(evt.created_at).toLocaleString()} | ${evt.project_name} | ${evt.action} | ${evt.bug_category || '-'} | Risk: ${evt.risk_level} | Conf: ${evt.confidence_score ?? '-'}% | ${evt.test_summary}`;
      doc.text(line.slice(0, 145), 14, y);
      y += 6;
      if (y > 195) {
        doc.addPage();
        y = 18;
      }
    }
    doc.save('autopatch-audit-trail.pdf');
    pushToast({ tone: 'success', title: 'PDF exported', message: 'Downloaded autopatch-audit-trail.pdf.' });
  };

  const handleRollback = async () => {
    if (!rollbackTarget) return;
    setRollingBack(true);
    try {
      await apiFetch(`/api/snapshots/${rollbackTarget.id}/rollback`, { method: 'POST' });
      setRollbackTarget(null);
      await Promise.all([loadAudit(), loadSnapshots(), fetchProjects()]);
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Rollback failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1520px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Patch Audit Trail</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Immutable historical ledger of every suggested patch, regression run, user approval, rejection, and rollback with Monaco before/after diffs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#00F5FF]/25 bg-[#142238] px-3.5 py-2 text-xs font-semibold text-[#F1F5F9] hover:border-[#00F5FF] hover:text-[#00F5FF]"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#00F5FF] px-3.5 py-2 text-xs font-semibold text-[#070B14] hover:bg-[#33f7ff]"
          >
            <FileText className="h-3.5 w-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="cyber-panel grid grid-cols-1 gap-3 rounded-lg p-4 sm:grid-cols-2 lg:grid-cols-6">
        <select
          aria-label="Filter by project"
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
          className="rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 text-xs text-[#F1F5F9]"
        >
          <option value="all">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by action"
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 text-xs text-[#F1F5F9]"
        >
          <option value="all">All Actions</option>
          <option value="patch_suggested">Patch Suggested</option>
          <option value="regression_tested">Regression Tested</option>
          <option value="patch_applied">Patch Applied</option>
          <option value="patch_rejected">Patch Rejected</option>
          <option value="rollback">Rollback</option>
        </select>

        <select
          aria-label="Filter by risk level"
          value={filterRisk}
          onChange={(e) => setFilterRisk(e.target.value)}
          className="rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 text-xs text-[#F1F5F9]"
        >
          <option value="all">All Risk Levels</option>
          <option value="Low">Low Risk</option>
          <option value="Medium">Medium Risk</option>
          <option value="High">High Risk</option>
          <option value="Critical">Critical Risk</option>
        </select>

        <select
          aria-label="Filter by bug category"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 text-xs text-[#F1F5F9]"
        >
          <option value="all">All Categories</option>
          <option value="sql_injection">SQL Injection</option>
          <option value="security">Security</option>
          <option value="logic_bug">Logic Bug</option>
          <option value="error_handling">Error Handling</option>
          <option value="rollback">Rollback</option>
        </select>

        <input
          type="date"
          aria-label="Filter from date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 font-mono text-xs text-[#F1F5F9]"
        />

        <input
          type="date"
          aria-label="Filter to date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 font-mono text-xs text-[#F1F5F9]"
        />
      </div>

      {/* Audit Events Table + Monaco Diff Viewer */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="cyber-panel rounded-lg p-4 xl:col-span-5">
          <div className="flex items-center justify-between border-b border-[#00F5FF]/15 pb-2.5">
            <span className="text-xs font-semibold text-[#F1F5F9]">Audit Ledger</span>
            <span className="font-mono text-xs text-[#94A3B8] tabular-nums">{events.length} event(s)</span>
          </div>
          <div className="mt-3 max-h-[540px] space-y-2 overflow-y-auto">
            {events.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#94A3B8]">
                No audit events match your current filters.
              </div>
            ) : (
              events.map((evt) => (
                <button
                  key={evt.id}
                  type="button"
                  onClick={() => setSelectedEvent(evt)}
                  className={cn(
                    'block w-full rounded-md border p-3 text-left text-xs transition-colors',
                    selectedEvent?.id === evt.id
                      ? 'border-[#00F5FF]/50 bg-[#142238]'
                      : 'border-[#00F5FF]/10 bg-[#0B1220] hover:border-[#00F5FF]/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-[#00F5FF]">{evt.action.replace(/_/g, ' ')}</span>
                    <RiskText level={evt.risk_level} />
                  </div>
                  <div className="mt-1 font-medium text-[#F1F5F9]">
                    {evt.bug_title || evt.project_name}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-[#94A3B8]">
                    <span>{evt.project_name}</span>
                    <span>·</span>
                    <span>{evt.user_name}</span>
                    <span>·</span>
                    <span className="tabular-nums">{new Date(evt.created_at).toLocaleString()}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-7">
          {selectedEvent ? (
            <div className="cyber-panel space-y-4 rounded-lg p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#00F5FF]/15 pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[#94A3B8]">
                    <span className="text-[#00F5FF]">{selectedEvent.action.replace(/_/g, ' ')}</span>
                    <span>·</span>
                    <span>{selectedEvent.project_name}</span>
                    {selectedEvent.file_path && (
                      <>
                        <span>·</span>
                        <span>{selectedEvent.file_path}</span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-1 text-base font-semibold text-[#F1F5F9]">
                    {selectedEvent.bug_title || 'Audit Record'}
                  </h2>
                  <p className="mt-1 text-xs text-[#94A3B8]">{selectedEvent.test_summary}</p>
                </div>

                <div className="text-right font-mono text-xs tabular-nums">
                  {selectedEvent.confidence_score !== null && (
                    <div className="text-[#00F5FF]">Confidence: {selectedEvent.confidence_score}%</div>
                  )}
                  {selectedEvent.risk_score !== null && (
                    <div className="text-[#FFB020]">Risk Score: {selectedEvent.risk_score}%</div>
                  )}
                </div>
              </div>

              <div className="text-xs text-[#94A3B8]">
                Monaco Diff: <strong className="text-[#F1F5F9]">Original Code (left)</strong> vs{' '}
                <strong className="text-[#39FF88]">
                  {selectedEvent.accepted_code ? 'User-Approved Code (right)' : 'AI-Proposed Code (right)'}
                </strong>
              </div>

              <MonacoDiffViewer
                original={selectedEvent.original_code || '// No original code snapshot stored'}
                modified={selectedEvent.accepted_code || selectedEvent.proposed_code || '// No modified code'}
                language="javascript"
                height="400px"
              />
            </div>
          ) : (
            <div className="cyber-panel flex h-80 flex-col items-center justify-center rounded-lg text-center">
              <History className="h-7 w-7 text-[#94A3B8]" />
              <p className="mt-2 text-xs text-[#94A3B8]">Select an audit event to inspect its Monaco before/after diff.</p>
            </div>
          )}

          {/* Active Rollback Snapshots */}
          {snapshots.length > 0 && (
            <div className="cyber-panel rounded-lg p-4">
              <h3 className="text-xs font-semibold text-[#F1F5F9]">Versioned Rollback Snapshots</h3>
              <div className="mt-2.5 space-y-2">
                {snapshots.slice(0, 4).map((snap) => (
                  <div
                    key={snap.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded bg-[#0B1220] px-3 py-2 text-xs"
                  >
                    <div>
                      <div className="font-medium text-[#F1F5F9]">{snap.label}</div>
                      <div className="font-mono text-[11px] text-[#94A3B8]">
                        {new Date(snap.created_at).toLocaleString()} · {snap.files.map((f) => f.path).join(', ')}
                      </div>
                    </div>
                    {snap.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => setRollbackTarget(snap)}
                        className="inline-flex items-center gap-1 rounded border border-[#FFB020]/40 bg-[#FFB020]/10 px-2.5 py-1 font-semibold text-[#FFB020] hover:bg-[#FFB020]/20"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Rollback
                      </button>
                    ) : (
                      <span className="font-mono text-[#94A3B8]">Rolled back</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(rollbackTarget)}
        title="Confirm Snapshot Rollback"
        description="Restore these files to their saved pre-patch snapshot? Audit history remains intact."
        details={rollbackTarget?.files.map((f) => f.path)}
        confirmLabel="Confirm Rollback"
        danger
        busy={rollingBack}
        onConfirm={handleRollback}
        onCancel={() => setRollbackTarget(null)}
      />
    </div>
  );
}
