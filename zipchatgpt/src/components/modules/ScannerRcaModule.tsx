import React, { useState, useMemo } from 'react';
import {
  ScanSearch,
  Loader2,
  ExternalLink,
  Wrench,
  Filter,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { severityTextClass, statusLabel } from '../../lib/format';
import type { DetectedBug, ProjectSummary, UploadedFile, WorkspaceModule } from '../../types';
import { EmptyState } from '../ui/ToastAndConfirm';

interface ScannerRcaModuleProps {
  project: ProjectSummary | null;
  files: UploadedFile[];
  bugs: DetectedBug[];
  onRefreshProjectData: () => Promise<void>;
  onJumpToCode: (fileId: string, line: number) => void;
  onSelectBugForRepair: (bugId: string) => void;
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
}

export function ScannerRcaModule({
  project,
  files,
  bugs,
  onRefreshProjectData,
  onJumpToCode,
  onSelectBugForRepair,
  onNavigate,
  onNotify,
}: ScannerRcaModuleProps) {
  const [scanning, setScanning] = useState(false);
  const [selectedBugId, setSelectedBugId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [fileFilter, setFileFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const categories = useMemo(
    () => Array.from(new Set(bugs.map((b) => b.category))).sort(),
    [bugs]
  );

  const filteredBugs = useMemo(() => {
    return bugs.filter((b) => {
      if (severityFilter !== 'all' && b.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && b.category !== categoryFilter) return false;
      if (fileFilter !== 'all' && b.file_path !== fileFilter) return false;
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${b.title} ${b.file_path} ${b.category} ${b.root_cause}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bugs, severityFilter, categoryFilter, fileFilter, statusFilter, searchQuery]);

  const activeBug =
    filteredBugs.find((b) => b.id === selectedBugId) || filteredBugs[0] || null;

  const handleRunScan = async () => {
    if (!project) return;
    setScanning(true);
    try {
      const data = await apiRequest<{ bugs: DetectedBug[]; scan: { bugs_found: number; duration_ms: number } }>(
        `/api/projects/${project.id}/scan`,
        { method: 'POST' }
      );
      await onRefreshProjectData();
      if (data.bugs?.[0]) setSelectedBugId(data.bugs[0].id);
      onNotify(
        data.scan.bugs_found > 0 ? 'warning' : 'success',
        `AI Scan completed in ${(data.scan.duration_ms / 1000).toFixed(1)}s`,
        `Detected ${data.scan.bugs_found} defect(s) across ${project.name}.`
      );
    } catch (err: unknown) {
      onNotify('error', 'AI Scan failed', err instanceof Error ? err.message : 'Unable to complete Gemini scan.');
    } finally {
      setScanning(false);
    }
  };

  if (!project) {
    return (
      <EmptyState
        title="No project selected"
        description="Upload or select a project to run Gemini AI bug detection and Root Cause Analysis."
        actionLabel="Go to Projects & Upload"
        onAction={() => onNavigate('projects')}
        icon={<ScanSearch className="w-5 h-5" />}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">
            Scanner & Root Cause Analysis
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Smart-prioritized defect detection by severity, impact score, and AI confidence for{' '}
            <span className="text-slate-200 font-medium">{project.name}</span>.
          </p>
        </div>

        <button
          type="button"
          disabled={scanning}
          onClick={handleRunScan}
          className="px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap self-start sm:self-auto"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
          {scanning ? 'Scanning Codebase with Gemini AI...' : 'Run AI Scan'}
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-3.5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Filter className="w-3.5 h-3.5" />
          <span>Filters</span>
        </div>

        {/* Severity Segmented Filter */}
        <div className="flex items-center gap-1 p-0.5 bg-[#080D19] border border-[#18233C] rounded-lg">
          {['all', 'critical', 'high', 'medium', 'low'].map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setSeverityFilter(sev)}
              className={`px-2.5 py-1 text-xs rounded-md capitalize transition-colors ${
                severityFilter === sev ? 'bg-[#192645] text-white font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-[#080D19] border border-[#1E2B4A] rounded-lg text-slate-200"
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          value={fileFilter}
          onChange={(e) => setFileFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs font-mono bg-[#080D19] border border-[#1E2B4A] rounded-lg text-slate-200"
        >
          <option value="all">All Files</option>
          {files.map((f) => (
            <option key={f.id} value={f.file_path}>
              {f.file_path}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1.5 text-xs bg-[#080D19] border border-[#1E2B4A] rounded-lg text-slate-200"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open Defect</option>
          <option value="patch_generated">Patch Ready</option>
          <option value="patched">Patched (Awaiting Test)</option>
          <option value="verified">Verified Fix</option>
        </select>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search bug title or root cause..."
          className="flex-1 min-w-[180px] px-3 py-1.5 text-xs bg-[#080D19] border border-[#1E2B4A] rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Main Split: Prioritized Bug List + Full 12-Field RCA Inspector */}
      {bugs.length === 0 ? (
        <EmptyState
          title="No defects detected yet"
          description="Click Run AI Scan above to analyze this project's source files with Gemini AI."
          actionLabel={scanning ? 'Scanning...' : 'Run AI Scan Now'}
          onAction={handleRunScan}
          icon={<CheckCircle2 className="w-5 h-5" />}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Bug Queue */}
          <div className="xl:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-[#090F1E] border-b border-[#162038] flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">
                Prioritized Defect Queue ({filteredBugs.length})
              </span>
              <span className="text-slate-500 font-mono">Sorted by Priority</span>
            </div>

            {filteredBugs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No bugs match the active filter combination.
              </div>
            ) : (
              <div className="divide-y divide-[#141E34] overflow-y-auto max-h-[600px]">
                {filteredBugs.map((bug) => {
                  const isActive = activeBug?.id === bug.id;
                  const st = statusLabel(bug.status);
                  return (
                    <button
                      key={bug.id}
                      type="button"
                      onClick={() => setSelectedBugId(bug.id)}
                      className={`w-full text-left px-4 py-3.5 transition-colors ${
                        isActive ? 'bg-blue-600/15' : 'hover:bg-[#111B33]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono mb-1">
                        <span className={`font-semibold uppercase ${severityTextClass(bug.severity)}`}>
                          {bug.severity} · P{bug.priority_score}
                        </span>
                        <span className={st.className}>{st.text}</span>
                      </div>
                      <p className="text-sm font-medium text-slate-100 leading-snug">{bug.title}</p>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono mt-1.5">
                        <span className="truncate">{bug.file_path}</span>
                        <span>·</span>
                        <span className="shrink-0 tabular-nums">
                          L{bug.line_start}
                          {bug.line_end > bug.line_start ? `–${bug.line_end}` : ''}
                        </span>
                        <span>·</span>
                        <span className="shrink-0">{bug.category}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 12-Point Root Cause Analysis Detail Panel */}
          <div className="xl:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl p-6 overflow-y-auto max-h-[644px]">
            {!activeBug ? (
              <div className="py-20 text-center text-xs text-slate-500">
                Select a bug from the prioritized queue to inspect its Root Cause Analysis.
              </div>
            ) : (
              <div className="space-y-5">
                {/* 1. Title + Actions */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-[#162038]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono mb-1.5">
                      <span className={`font-semibold uppercase ${severityTextClass(activeBug.severity)}`}>
                        {activeBug.severity} Severity
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-300">{activeBug.category}</span>
                      <span className="text-slate-600">·</span>
                      <span className={statusLabel(activeBug.status).className}>
                        {statusLabel(activeBug.status).text}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold text-white font-display leading-snug">{activeBug.title}</h2>
                    <p className="text-xs font-mono text-blue-400 mt-1">
                      {activeBug.file_path} · Lines {activeBug.line_start}–{activeBug.line_end}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onJumpToCode(activeBug.file_id, activeBug.line_start)}
                      className="px-3 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1A2745] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Line in Monaco
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectBugForRepair(activeBug.id)}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      Repair in Diff Editor
                    </button>
                  </div>
                </div>

                {/* Metrics Row: Impact Score, AI Confidence, Priority Score */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#080D19] border border-[#17223B] rounded-lg p-3.5">
                    <p className="text-[11px] text-slate-500">Impact Score</p>
                    <p className="text-xl font-mono font-bold text-white tabular-nums mt-0.5">
                      {activeBug.impact_score}
                      <span className="text-xs text-slate-500 font-normal">/100</span>
                    </p>
                  </div>
                  <div className="bg-[#080D19] border border-[#17223B] rounded-lg p-3.5">
                    <p className="text-[11px] text-slate-500">AI Confidence</p>
                    <p className="text-xl font-mono font-bold text-blue-400 tabular-nums mt-0.5">
                      {activeBug.confidence}%
                    </p>
                  </div>
                  <div className="bg-[#080D19] border border-[#17223B] rounded-lg p-3.5">
                    <p className="text-[11px] text-slate-500">Smart Priority</p>
                    <p className="text-xl font-mono font-bold text-violet-400 tabular-nums mt-0.5">
                      P{activeBug.priority_score}
                    </p>
                  </div>
                </div>

                {/* Full RCA Narrative Fields (8-12) */}
                <div className="space-y-4 text-sm">
                  <div>
                    <h3 className="text-xs font-mono text-slate-400 mb-1">Detailed Description</h3>
                    <p className="text-slate-200 leading-relaxed">{activeBug.description}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-[#162038]">
                    <div>
                      <h3 className="text-xs font-mono text-amber-400 mb-1">Why the Bug Occurred</h3>
                      <p className="text-xs text-slate-300 leading-relaxed">{activeBug.why_occurred}</p>
                    </div>
                    <div>
                      <h3 className="text-xs font-mono text-red-400 mb-1 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Root Cause
                      </h3>
                      <p className="text-xs text-slate-300 leading-relaxed">{activeBug.root_cause}</p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#162038]">
                    <h3 className="text-xs font-mono text-slate-400 mb-1">Potential Production Impact</h3>
                    <p className="text-xs text-slate-300 leading-relaxed">{activeBug.potential_impact}</p>
                  </div>

                  <div className="pt-3 border-t border-[#162038] bg-[#080F1E] border border-[#192847] rounded-lg p-4">
                    <h3 className="text-xs font-mono text-emerald-400 mb-1">Recommended Engineering Solution</h3>
                    <p className="text-xs text-slate-200 leading-relaxed">{activeBug.suggested_solution}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
