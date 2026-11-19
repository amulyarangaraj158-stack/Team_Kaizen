import React, { useEffect, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  Upload,
  ScanSearch,
  BookOpenText,
  Wrench,
  FileBarChart2,
  ArrowUpRight,
  RefreshCw,
  Bot,
  Languages,
  Globe,
  FileImage,
  Bell,
  History,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatTimestamp, healthLabel } from '../../lib/format';
import type { AdvancedDashboardData, DashboardData, WorkspaceModule } from '../../types';
import { EmptyState, LoadingPanel } from '../ui/ToastAndConfirm';

interface DashboardModuleProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onNavigate: (mod: WorkspaceModule) => void;
  onOpenNotifications: () => void;
  refreshTrigger: number;
}

export function DashboardModule({
  selectedProjectId,
  onSelectProject,
  onNavigate,
  onOpenNotifications,
  refreshTrigger,
}: DashboardModuleProps) {
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  const [data, setData] = useState<DashboardData | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlice, setActiveSlice] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, advRes] = await Promise.all([
        apiRequest<DashboardData>(`/api/dashboard?range=${range}`),
        apiRequest<AdvancedDashboardData>('/api/dashboard/advanced').catch(() => null),
      ]);
      setData(res);
      if (advRes) setAdvanced(advRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, refreshTrigger]);

  if (loading && !data) return <LoadingPanel message="Loading real-time workspace metrics..." />;
  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-sm text-red-300 flex items-center justify-between">
        <span>{error}</span>
        <button
          type="button"
          onClick={loadDashboard}
          className="px-3 py-1.5 text-xs bg-red-500/20 hover:bg-red-500/30 rounded-lg text-red-100"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;

  const { stats, projects, trends, activity } = data;

  const severityData = [
    { name: 'Critical', value: stats.criticalBugs, color: '#EF4444' },
    { name: 'High', value: stats.highBugs, color: '#F59E0B' },
    { name: 'Medium', value: stats.mediumBugs, color: '#3B82F6' },
    { name: 'Low', value: stats.lowBugs, color: '#10B981' },
  ];

  const kpiCards = [
    { label: 'Projects Analyzed', value: stats.projectsAnalyzed, sub: `of ${stats.totalProjects} uploaded`, tone: 'text-white' },
    { label: 'Total Bugs Detected', value: stats.totalBugs, sub: `${stats.pendingFixes} open / pending`, tone: 'text-white' },
    { label: 'Critical Bugs', value: stats.criticalBugs, sub: 'Immediate attention', tone: 'text-red-400' },
    { label: 'High Severity', value: stats.highBugs, sub: 'Priority remediation', tone: 'text-amber-400' },
    { label: 'Medium Severity', value: stats.mediumBugs, sub: 'Moderate risk', tone: 'text-blue-400' },
    { label: 'Low Severity', value: stats.lowBugs, sub: 'Maintainability / style', tone: 'text-emerald-400' },
    { label: 'Bugs Repaired', value: stats.bugsRepaired, sub: `${stats.acceptedFixes} accepted patches`, tone: 'text-violet-400' },
    { label: 'Verified Fixes', value: stats.verifiedFixes, sub: `${stats.fixSuccessRate}% verified rate`, tone: 'text-emerald-400' },
    { label: 'Pending Fixes', value: stats.pendingFixes, sub: `${stats.pendingPatches} drafts awaiting review`, tone: 'text-amber-300' },
    { label: 'Failed Tests', value: stats.failedTests, sub: `${stats.passedTests} test assertions passed`, tone: stats.failedTests > 0 ? 'text-red-400' : 'text-slate-300' },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Quick Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Engineering Overview</h1>
          <p className="text-xs text-slate-400 mt-1">
            Live defect, remediation, and verification telemetry across your repositories.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('projects')}
            className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload New Project
          </button>
          <button
            type="button"
            onClick={() => onNavigate('scanner')}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1A2745] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <ScanSearch className="w-3.5 h-3.5 text-blue-400" />
            Run AI Scan
          </button>
          <button
            type="button"
            onClick={() => onNavigate('explain')}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1A2745] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <BookOpenText className="w-3.5 h-3.5 text-violet-400" />
            Explain Code
          </button>
          <button
            type="button"
            onClick={() => onNavigate('repair')}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1A2745] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <Wrench className="w-3.5 h-3.5 text-emerald-400" />
            Generate Fix
          </button>
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1A2745] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileBarChart2 className="w-3.5 h-3.5 text-slate-300" />
            View Reports
          </button>
          <button
            type="button"
            onClick={loadDashboard}
            className="p-2 text-slate-400 hover:text-white bg-[#121B31] border border-[#1E2B4A] rounded-lg transition-colors"
            title="Refresh metrics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 10 Top-Level Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {kpiCards.map((k) => (
          <div key={k.label} className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
            <p className="text-xs text-slate-400 truncate">{k.label}</p>
            <p className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${k.tone}`}>{k.value}</p>
            <p className="text-[11px] text-slate-500 mt-1 truncate">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts Row: Bug Severity Donut + Bug Detection Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* B. Bug Severity Distribution */}
        <div className="lg:col-span-4 bg-[#0C1324] border border-[#19243E] rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-white font-display">Bug Severity Distribution</h2>
              <p className="text-xs text-slate-500">Hover or select segments to inspect counts</p>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums">{stats.totalBugs} total</span>
          </div>

          {stats.totalBugs === 0 ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-500 py-12">
              Run an AI scan to populate severity distribution.
            </div>
          ) : (
            <>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={severityData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={3}
                      onMouseEnter={(_, idx) => setActiveSlice(severityData[idx]?.name || null)}
                      onMouseLeave={() => setActiveSlice(null)}
                    >
                      {severityData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={entry.color}
                          opacity={activeSlice && activeSlice !== entry.name ? 0.35 : 1}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0B1222',
                        borderColor: '#1E2B4A',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#E2E8F0',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-[#162038] text-xs">
                {severityData.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    onClick={() => onNavigate('scanner')}
                    onMouseEnter={() => setActiveSlice(item.name)}
                    onMouseLeave={() => setActiveSlice(null)}
                    className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#131D35] transition-colors text-left"
                  >
                    <span className="text-slate-300 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-xs shrink-0" style={{ backgroundColor: item.color }} />
                      {item.name}
                    </span>
                    <span className="font-mono font-semibold text-white tabular-nums">{item.value}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* C. Bug Detection Trends */}
        <div className="lg:col-span-8 bg-[#0C1324] border border-[#19243E] rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white font-display">Bug Detection & Resolution Trends</h2>
              <p className="text-xs text-slate-500">Defects discovered vs. patches repaired over time</p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-[#080D19] border border-[#18233C] rounded-lg">
              <button
                type="button"
                onClick={() => setRange('weekly')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  range === 'weekly' ? 'bg-[#192645] text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Weekly
              </button>
              <button
                type="button"
                onClick={() => setRange('monthly')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  range === 'monthly' ? 'bg-[#192645] text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Monthly
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradDetected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#162038" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={false} tickLine={false} />
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
                <Area
                  type="monotone"
                  dataKey="detected"
                  name="Bugs Detected"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  fill="url(#gradDetected)"
                />
                <Area
                  type="monotone"
                  dataKey="resolved"
                  name="Bugs Repaired"
                  stroke="#10B981"
                  strokeWidth={2}
                  fill="url(#gradResolved)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Grid: A. Project Overview + D. Repair Performance & E. Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* A. Project Overview */}
        <div className="lg:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#162038] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white font-display">Project Overview</h2>
              <p className="text-xs text-slate-500">Click any project to activate it across all modules</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('projects')}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 whitespace-nowrap"
            >
              Manage All
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No projects uploaded yet"
                description="Upload source files, a ZIP archive, or load a sample JS/Python project to begin."
                actionLabel="Go to Projects & Upload"
                onAction={() => onNavigate('projects')}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#090F1E] text-slate-400 border-b border-[#162038]">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">Project</th>
                    <th className="py-2.5 px-4 font-medium">Languages</th>
                    <th className="py-2.5 px-4 font-medium">Health</th>
                    <th className="py-2.5 px-4 font-medium text-right">Bugs</th>
                    <th className="py-2.5 px-4 font-medium text-right">Last Scan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141E34]">
                  {projects.map((p) => {
                    const h = healthLabel(p.health_status);
                    const isSelected = p.id === selectedProjectId;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => onSelectProject(p.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-600/10' : 'hover:bg-[#111B33]'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-100 flex items-center gap-2">
                            {p.name}
                            {isSelected && <span className="text-[10px] font-mono text-blue-400">Active</span>}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                            {p.total_files} files · {p.total_lines} lines
                          </p>
                        </td>
                        <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                          {(p.languages || [p.primary_language]).slice(0, 2).join(' · ')}
                        </td>
                        <td className={`py-3 px-4 font-medium ${h.className}`}>{h.text}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                          {p.total_bugs ?? 0}
                          <span className="text-slate-500"> ({p.verified_bugs ?? 0} verified)</span>
                        </td>
                        <td className="py-3 px-4 text-right text-slate-400 font-mono text-[11px] tabular-nums">
                          {formatTimestamp(p.last_scan_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* D. Repair Performance & E. Recent Activity */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Repair Performance */}
          <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white font-display">Repair Performance</h2>
              <span className="text-sm font-mono font-bold text-emerald-400 tabular-nums">
                {stats.fixSuccessRate}% verified
              </span>
            </div>
            <div className="w-full h-2 bg-[#141E34] rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, stats.fixSuccessRate)}%` }}
              />
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-slate-500">Verified Repairs</p>
                <p className="text-base font-mono font-semibold text-emerald-400 tabular-nums mt-0.5">
                  {stats.verifiedFixes}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Pending Repairs</p>
                <p className="text-base font-mono font-semibold text-amber-400 tabular-nums mt-0.5">
                  {stats.pendingFixes}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Failed Validations</p>
                <p className="text-base font-mono font-semibold text-red-400 tabular-nums mt-0.5">
                  {stats.failedRepairs}
                </p>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-5 flex-1">
            <h2 className="text-sm font-semibold text-white font-display mb-3">Recent Activity</h2>
            {activity.length === 0 ? (
              <p className="text-xs text-slate-500 py-6">No scans, patches, or test validations logged yet.</p>
            ) : (
              <ul className="divide-y divide-[#141E34] text-xs">
                {activity.slice(0, 6).map((item) => (
                  <li key={item.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-200 truncate capitalize">{item.title}</p>
                      <p className="text-slate-400 mt-0.5 truncate">{item.detail}</p>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
                      {formatTimestamp(item.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* AUTOPATCH ADVANCED INTELLIGENCE — 6 Integrated Capability Cards */}
      <section className="space-y-3.5 pt-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-cyan-400">
              AUTOPATCH ADVANCED INTELLIGENCE
            </p>
            <h2 className="text-base font-semibold text-white font-display mt-0.5">
              Conversational, Multi-Language, Website, Multimedia & Governance Suite
            </h2>
          </div>
          <span className="text-[11px] text-slate-500">
            Live workspace metrics · Every card opens its integrated tool
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {/* 1. Ask AutoPatch */}
          <div className="bg-[#0C1324] border border-[#19243E] hover:border-cyan-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <Bot className="w-4 h-4 text-cyan-400" />
                  Ask AutoPatch
                </span>
                <span className="text-[11px] font-mono text-cyan-300 tabular-nums">
                  {advanced ? `${advanced.chat.conversations} thread${advanced.chat.conversations === 1 ? '' : 's'}` : 'Ready'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Project-grounded AI debugging chat with line citations, code snippets, beginner/advanced modes, and bug
                report links.
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#162038] flex items-center justify-between text-xs">
              <span className="text-slate-500 tabular-nums">
                {advanced ? `${advanced.chat.messages} saved message${advanced.chat.messages === 1 ? '' : 's'}` : '0 messages'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('chat')}
                className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1"
              >
                Open Chat <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2. Multi-Language Intelligence */}
          <div className="bg-[#0C1324] border border-[#19243E] hover:border-violet-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <Languages className="w-4 h-4 text-violet-400" />
                  Multi-Language Intelligence
                </span>
                <span className="text-[11px] font-mono text-violet-300 tabular-nums">
                  {advanced ? `${advanced.languages.supportedTotal} languages` : '14 languages'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Real compiler/parser syntax checks (esbuild, python3, gcc/g++), static defect rules, and honest
                capability reporting.
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#162038] flex items-center justify-between text-xs">
              <span className="text-slate-500 tabular-nums">
                {advanced ? `${advanced.languages.activeInWorkspace} detected in projects` : 'Workspace matrix'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('languages')}
                className="text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1"
              >
                Inspect Languages <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 3. Website Debugger */}
          <div className="bg-[#0C1324] border border-[#19243E] hover:border-cyan-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  Website Debugger
                </span>
                <span className="text-[11px] font-mono text-cyan-300 tabular-nums">
                  {advanced ? `${advanced.website.totalScans} scan${advanced.website.totalScans === 1 ? '' : 's'}` : '0 scans'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                SSRF-guarded live URL scanner for broken links, responsive viewport defects, accessibility, performance,
                and SEO audits.
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#162038] flex items-center justify-between text-xs">
              <span className="text-slate-500 tabular-nums">
                {advanced ? `${advanced.website.totalIssues} web issue${advanced.website.totalIssues === 1 ? '' : 's'} logged` : 'Live HTTP/DOM'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('website')}
                className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1"
              >
                Scan Website <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 4. Multimedia Debugger */}
          <div className="bg-[#0C1324] border border-[#19243E] hover:border-violet-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <FileImage className="w-4 h-4 text-violet-400" />
                  Multimedia Debugger
                </span>
                <span className="text-[11px] font-mono text-violet-300 tabular-nums">
                  {advanced ? `${advanced.multimedia.totalScans} asset${advanced.multimedia.totalScans === 1 ? '' : 's'}` : '0 assets'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Image, video, and audio inspection using Sharp, ffprobe, ffmpeg clipping detection, plus optional Gemini
                AI quality checks.
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#162038] flex items-center justify-between text-xs">
              <span className="text-slate-500 tabular-nums">
                {advanced
                  ? `${advanced.multimedia.imageCount} img · ${advanced.multimedia.videoCount} vid · ${advanced.multimedia.audioCount} aud`
                  : 'Image / Video / Audio'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('multimedia')}
                className="text-violet-400 hover:text-violet-300 font-medium flex items-center gap-1"
              >
                Inspect Media <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 5. Notification Center */}
          <div className="bg-[#0C1324] border border-[#19243E] hover:border-emerald-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-emerald-400" />
                  Notification Center
                </span>
                <span className="text-[11px] font-mono text-emerald-400 tabular-nums">
                  {advanced ? `${advanced.notifications.unread} unread` : '0 unread'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Real-time backend-confirmed alerts across uploads, AI scans, patch approvals, test results, rollbacks,
                and exports.
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#162038] flex items-center justify-between text-xs">
              <span className="text-slate-500 tabular-nums">
                {advanced ? `${advanced.notifications.successes} success / ${advanced.notifications.total} total` : '0 alerts'}
              </span>
              <button
                type="button"
                onClick={onOpenNotifications}
                className="text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
              >
                Open Alerts <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 6. Patch Audit Trail */}
          <div className="bg-[#0C1324] border border-[#19243E] hover:border-cyan-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition-colors">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-400" />
                  Patch Audit Trail
                </span>
                <span className="text-[11px] font-mono text-cyan-300 tabular-nums">
                  {advanced ? `${advanced.audit.totalEvents} event${advanced.audit.totalEvents === 1 ? '' : 's'}` : '0 events'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                Append-only provenance timeline with diff comparisons, multi-field filters, and downloadable PDF & CSV
                audit reports.
              </p>
            </div>
            <div className="pt-2.5 border-t border-[#162038] flex items-center justify-between text-xs">
              <span className="text-slate-500 tabular-nums">
                {advanced ? `${advanced.audit.verifiedEvents} verified · ${advanced.audit.rollbackEvents} rollbacks` : 'Append-only ledger'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('audit')}
                className="text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1"
              >
                View Audit Trail <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
