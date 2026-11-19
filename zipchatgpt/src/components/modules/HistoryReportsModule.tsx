import React, { useEffect, useState, useCallback } from 'react';
import { FileDown, FileBarChart2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { exportProjectPdfReport, formatTimestamp, severityTextClass, statusLabel, type FullReportPayload } from '../../lib/format';
import type { ChangeHistoryRecord, ProjectSummary, WorkspaceModule } from '../../types';
import { EmptyState, LoadingPanel } from '../ui/ToastAndConfirm';

interface HistoryReportsModuleProps {
  project: ProjectSummary | null;
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
  onRefreshNotifications?: () => Promise<void>;
  refreshTrigger: number;
}

interface ReportApiResponse extends FullReportPayload {
  changes: ChangeHistoryRecord[];
}

export function HistoryReportsModule({
  project,
  onNavigate,
  onNotify,
  onRefreshNotifications,
  refreshTrigger,
}: HistoryReportsModuleProps) {
  const [report, setReport] = useState<ReportApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'scans' | 'repairs' | 'tests'>('scans');

  const loadReport = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const res = await apiRequest<ReportApiResponse>(`/api/projects/${project.id}/report`);
      setReport(res);
    } catch (err: unknown) {
      onNotify('error', 'Failed to load report data', err instanceof Error ? err.message : 'Server error');
    } finally {
      setLoading(false);
    }
  }, [project, onNotify]);

  useEffect(() => {
    void loadReport();
  }, [loadReport, refreshTrigger]);

  const handleDownloadPdf = async () => {
    if (!report) return;
    try {
      exportProjectPdfReport(report);
      await apiRequest('/api/notifications/report-generated', {
        method: 'POST',
        body: JSON.stringify({
          projectId: report.project.id,
          reportType: 'Project PDF Engineering Report',
          projectName: report.project.name,
        }),
      }).catch(() => {});
      if (onRefreshNotifications) await onRefreshNotifications();
      onNotify('success', 'PDF Audit Report Downloaded', `Generated comprehensive report for ${report.project.name}.`);
    } catch (err: unknown) {
      onNotify('error', 'PDF generation failed', err instanceof Error ? err.message : 'Unable to export PDF.');
    }
  };

  if (!project) {
    return (
      <EmptyState
        title="Select a project to view History & Reports"
        description="Inspect complete scan logs, repair audits, before-and-after test runs, and export downloadable PDF reports."
        actionLabel="Go to Projects & Upload"
        onAction={() => onNavigate('projects')}
        icon={<FileBarChart2 className="w-5 h-5" />}
      />
    );
  }

  if (loading && !report) return <LoadingPanel message="Compiling engineering audit report..." />;
  if (!report) return null;

  const critCount = report.bugs.filter((b) => b.severity === 'critical').length;
  const verifiedCount = report.bugs.filter((b) => b.status === 'verified').length;
  const acceptedCount = report.fixes.filter((f) => f.status === 'accepted').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">History & Reports</h1>
          <p className="text-xs text-slate-400 mt-1">
            Audit trail and downloadable PDF engineering report for{' '}
            <span className="text-slate-200 font-medium">{report.project.name}</span>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadReport}
            className="p-2 text-slate-400 hover:text-white bg-[#121B31] border border-[#1E2B4A] rounded-lg transition-colors"
            title="Refresh report data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <FileDown className="w-4 h-4" />
            Download PDF Report
          </button>
        </div>
      </div>

      {/* Report Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Scans Run</p>
          <p className="text-xl font-mono font-bold text-white tabular-nums mt-1">{report.scans.length}</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Total Bugs</p>
          <p className="text-xl font-mono font-bold text-white tabular-nums mt-1">{report.bugs.length}</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Critical Defects</p>
          <p className="text-xl font-mono font-bold text-red-400 tabular-nums mt-1">{critCount}</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Accepted Patches</p>
          <p className="text-xl font-mono font-bold text-violet-400 tabular-nums mt-1">{acceptedCount}</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Verified Fixes</p>
          <p className="text-xl font-mono font-bold text-emerald-400 tabular-nums mt-1">{verifiedCount}</p>
        </div>
      </div>

      {/* History Tabs */}
      <div className="flex items-center gap-1 p-1 bg-[#0C1324] border border-[#19243E] rounded-lg w-fit">
        {[
          { id: 'scans', label: `Scan History (${report.scans.length})` },
          { id: 'repairs', label: `Repair History (${report.fixes.length})` },
          { id: 'tests', label: `Test Executions (${report.tests.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as 'scans' | 'repairs' | 'tests')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              activeTab === tab.id ? 'bg-[#192645] text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
        {activeTab === 'scans' && (
          <div className="overflow-x-auto">
            {report.scans.length === 0 ? (
              <p className="p-8 text-xs text-slate-500 text-center">No scans executed yet for this project.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090F1E] text-slate-400 border-b border-[#162038]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Timestamp</th>
                    <th className="py-2.5 px-4 font-medium">Status</th>
                    <th className="py-2.5 px-4 font-medium">Model</th>
                    <th className="py-2.5 px-4 font-medium text-right">Files</th>
                    <th className="py-2.5 px-4 font-medium text-right">Bugs Found</th>
                    <th className="py-2.5 px-4 font-medium text-right">Crit / High / Med / Low</th>
                    <th className="py-2.5 px-4 font-medium text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141E34] font-mono tabular-nums">
                  {report.scans.map((s) => (
                    <tr key={s.id} className="hover:bg-[#101930]">
                      <td className="py-3 px-4 text-slate-300">{formatTimestamp(s.created_at)}</td>
                      <td className={`py-3 px-4 capitalize ${s.status === 'completed' ? 'text-emerald-400' : s.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>
                        {s.status}
                      </td>
                      <td className="py-3 px-4 text-slate-400">{s.model_used}</td>
                      <td className="py-3 px-4 text-right text-slate-300">{s.files_scanned}</td>
                      <td className="py-3 px-4 text-right text-white font-semibold">{s.bugs_found}</td>
                      <td className="py-3 px-4 text-right text-slate-400">
                        <span className="text-red-400">{s.critical_count}</span> /{' '}
                        <span className="text-amber-400">{s.high_count}</span> /{' '}
                        <span className="text-blue-400">{s.medium_count}</span> /{' '}
                        <span className="text-emerald-400">{s.low_count}</span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400">{(s.duration_ms / 1000).toFixed(2)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'repairs' && (
          <div className="overflow-x-auto">
            {report.fixes.length === 0 ? (
              <p className="p-8 text-xs text-slate-500 text-center">No AI patches generated yet for this project.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090F1E] text-slate-400 border-b border-[#162038]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Timestamp</th>
                    <th className="py-2.5 px-4 font-medium">Target Defect & File</th>
                    <th className="py-2.5 px-4 font-medium">Patch Status</th>
                    <th className="py-2.5 px-4 font-medium text-right">Confidence</th>
                    <th className="py-2.5 px-4 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141E34]">
                  {report.fixes.map((fix) => (
                    <tr key={fix.id} className="hover:bg-[#101930] align-top">
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap tabular-nums">
                        {formatTimestamp(fix.created_at)}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-100">{fix.bug_title || fix.bug_id}</p>
                        <p className="font-mono text-[11px] text-blue-400 mt-0.5">{fix.file_path}</p>
                      </td>
                      <td className="py-3 px-4 font-mono capitalize text-slate-200 whitespace-nowrap">{fix.status}</td>
                      <td className="py-3 px-4 font-mono text-right text-blue-300 tabular-nums">{fix.confidence}%</td>
                      <td className="py-3 px-4 text-slate-400 max-w-md">{fix.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'tests' && (
          <div className="overflow-x-auto">
            {report.tests.length === 0 ? (
              <p className="p-8 text-xs text-slate-500 text-center">No test validation runs recorded yet for this project.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090F1E] text-slate-400 border-b border-[#162038]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Timestamp</th>
                    <th className="py-2.5 px-4 font-medium">Defect</th>
                    <th className="py-2.5 px-4 font-medium">Phase & Engine</th>
                    <th className="py-2.5 px-4 font-medium text-right">Pass / Total</th>
                    <th className="py-2.5 px-4 font-medium">Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141E34]">
                  {report.tests.map((tr) => (
                    <tr key={tr.id} className="hover:bg-[#101930]">
                      <td className="py-3 px-4 font-mono text-slate-400 whitespace-nowrap tabular-nums">
                        {formatTimestamp(tr.created_at)}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-100">{tr.bug_title || tr.bug_id}</p>
                        <p className="font-mono text-[11px] text-slate-500">{tr.file_path}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        {tr.phase}-fix · {tr.execution_mode === 'isolated_vm' ? 'Isolated Sandbox' : 'Static Validation'}
                      </td>
                      <td className="py-3 px-4 font-mono text-right tabular-nums text-white">
                        {tr.passed_tests}/{tr.total_tests}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`font-mono flex items-center gap-1 ${tr.failed_tests === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {tr.failed_tests === 0 ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                          {tr.validation_status}
                          {tr.regression_detected ? ' (Regression)' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Project Defects Quick Summary Table */}
      {report.bugs.length > 0 && (
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#162038]">
            <h2 className="text-sm font-semibold text-white font-display">Included in PDF Report: Current Defect Ledger</h2>
          </div>
          <div className="divide-y divide-[#141E34] text-xs">
            {report.bugs.map((b) => (
              <div key={b.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-100">{b.title}</p>
                  <p className="font-mono text-[11px] text-slate-500 mt-0.5">
                    {b.file_path} · Lines {b.line_start}–{b.line_end} · {b.category}
                  </p>
                </div>
                <div className="flex items-center gap-4 font-mono text-[11px] shrink-0">
                  <span className={`uppercase font-semibold ${severityTextClass(b.severity)}`}>{b.severity}</span>
                  <span className={statusLabel(b.status).className}>{statusLabel(b.status).text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
