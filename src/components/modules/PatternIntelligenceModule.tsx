import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
} from 'recharts';
import { BrainCircuit, RefreshCw, ShieldAlert } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { severityTextClass } from '../../lib/format';
import type { ProjectSummary, WorkspaceModule } from '../../types';
import { EmptyState, LoadingPanel } from '../ui/ToastAndConfirm';

interface PatternData {
  byCategory: Array<{ category: string; count: number; critical_count: number; verified_count: number }>;
  byFile: Array<{ file_path: string; project_name: string; bug_count: number; max_sev_rank: number }>;
  recurringRootCauses: Array<{
    category: string;
    title: string;
    root_cause: string;
    suggested_solution: string;
    severity: string;
    file_path: string;
    project_name: string;
  }>;
  trends: Array<{ day: string; detected: number; fixed: number }>;
}

interface PatternIntelligenceModuleProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  onNavigate: (mod: WorkspaceModule) => void;
  refreshTrigger: number;
}

export function PatternIntelligenceModule({
  projects,
  selectedProjectId,
  onNavigate,
  refreshTrigger,
}: PatternIntelligenceModuleProps) {
  const [scopeProjectId, setScopeProjectId] = useState<string>('all');
  const [data, setData] = useState<PatternData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPatterns = useCallback(async () => {
    setLoading(true);
    try {
      const qs = scopeProjectId !== 'all' ? `?projectId=${encodeURIComponent(scopeProjectId)}` : '';
      const res = await apiRequest<PatternData>(`/api/patterns${qs}`);
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [scopeProjectId]);

  useEffect(() => {
    void loadPatterns();
  }, [loadPatterns, refreshTrigger]);

  if (loading && !data) return <LoadingPanel message="Aggregating cross-project defect patterns..." />;
  if (!data) return null;

  const hasBugs = data.byCategory.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Pattern Intelligence Center</h1>
          <p className="text-xs text-slate-400 mt-1">
            Cross-project defect categorization, hotspot files, recurring root causes, and prevention guidelines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={scopeProjectId}
            onChange={(e) => setScopeProjectId(e.target.value)}
            className="px-3 py-2 text-xs bg-[#0C1324] border border-[#1E2B4A] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Projects ({projects.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.id === selectedProjectId ? '(Active)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadPatterns}
            className="p-2 text-slate-400 hover:text-white bg-[#121B31] border border-[#1E2B4A] rounded-lg transition-colors"
            title="Refresh patterns"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {!hasBugs ? (
        <EmptyState
          title="No defect patterns collected yet"
          description="Run AI scans on one or more projects to analyze recurring categories, hotspot files, and defect trends."
          actionLabel="Open Scanner & RCA"
          onAction={() => onNavigate('scanner')}
          icon={<BrainCircuit className="w-5 h-5" />}
        />
      ) : (
        <>
          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white font-display mb-1">Most Frequent Bug Categories</h2>
              <p className="text-xs text-slate-500 mb-4">Total detected vs. verified fixes by defect class</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byCategory} margin={{ top: 8, right: 12, left: -16, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#162038" vertical={false} />
                    <XAxis
                      dataKey="category"
                      tick={{ fill: '#94A3B8', fontSize: 10.5 }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      angle={-12}
                      textAnchor="end"
                    />
                    <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B1222',
                        borderColor: '#1E2B4A',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#E2E8F0',
                      }}
                    />
                    <Bar dataKey="count" name="Total Detected" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="verified_count" name="Verified Fixes" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white font-display mb-1">Defect Discovery Trend</h2>
              <p className="text-xs text-slate-500 mb-4">Daily defects found vs. remediated</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trends} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#162038" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: '#64748B', fontSize: 10.5 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B1222',
                        borderColor: '#1E2B4A',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#E2E8F0',
                      }}
                    />
                    <Line type="monotone" dataKey="detected" name="Detected" stroke="#60A5FA" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="fixed" name="Repaired" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Frequently Affected Files + Recurring Root Causes */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#162038]">
                <h2 className="text-sm font-semibold text-white font-display">Frequently Affected Hotspot Files</h2>
              </div>
              <div className="divide-y divide-[#141E34] text-xs">
                {data.byFile.map((f, idx) => (
                  <div key={`${f.file_path}-${idx}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-slate-200 truncate">{f.file_path}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">{f.project_name}</p>
                    </div>
                    <span className="font-mono font-semibold text-amber-400 tabular-nums shrink-0">
                      {f.bug_count} bug{f.bug_count === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#162038]">
                <h2 className="text-sm font-semibold text-white font-display">
                  Recurring Root Causes & Prevention Guidance
                </h2>
              </div>
              <div className="divide-y divide-[#141E34] max-h-[380px] overflow-y-auto">
                {data.recurringRootCauses.map((rc, idx) => (
                  <div key={idx} className="px-5 py-3.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                      <span className={`uppercase font-semibold flex items-center gap-1 ${severityTextClass(rc.severity)}`}>
                        <ShieldAlert className="w-3 h-3" />
                        {rc.severity} · {rc.category}
                      </span>
                      <span className="text-slate-500 truncate">{rc.file_path}</span>
                    </div>
                    <p className="font-semibold text-slate-100">{rc.title}</p>
                    <p className="text-slate-400 leading-relaxed">
                      <span className="text-slate-300 font-medium">Root Cause:</span> {rc.root_cause}
                    </p>
                    <p className="text-emerald-300/90 leading-relaxed">
                      <span className="font-medium">Prevention:</span> {rc.suggested_solution}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
