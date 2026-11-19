import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  Bug,
  CheckCircle2,
  Code2,
  Cpu,
  Database,
  FileAudio2,
  FlaskConical,
  Globe,
  History,
  Radar,
  RefreshCw,
  ScanSearch,
  Server,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { CircularGauge, cn } from '../components/ui/Primitives';

interface DashboardData {
  metrics: {
    totalBugsDetected: number;
    bugsResolved: number;
    criticalIssues: number;
    openBugs: number;
    projectHealthScore: number;
  };
  counts: {
    projects: number;
    scans: number;
    pendingFixes: number;
    regressionRuns: number;
    dependencyEdges: number;
    conversations: number;
    websiteScans: number;
    multimediaScans: number;
    auditEvents: number;
    snapshots: number;
  };
  activityTimeline: Array<{
    id: string;
    eventType: string;
    projectName: string;
    detail: string;
    createdAt: string;
    projectId: string;
  }>;
}

function useAnimatedCounter(target: number, durationMs = 450): number {
  const [val, setVal] = useState(target);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = val;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return val;
}

export function OverviewPage() {
  const navigate = useNavigate();
  const { projects, activeProjectId, health, fetchHealth } = useAppStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const url = activeProjectId
        ? `/api/dashboard?projectId=${encodeURIComponent(activeProjectId)}`
        : '/api/dashboard';
      const res = await apiFetch<DashboardData>(url);
      setData(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    fetchHealth();
  }, [activeProjectId]);

  const totalBugsAnim = useAnimatedCounter(data?.metrics.totalBugsDetected ?? 0);
  const resolvedAnim = useAnimatedCounter(data?.metrics.bugsResolved ?? 0);
  const criticalAnim = useAnimatedCounter(data?.metrics.criticalIssues ?? 0);
  const healthAnim = useAnimatedCounter(data?.metrics.projectHealthScore ?? 100);

  const todayFormatted = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const healthItems = [
    {
      label: 'AI Service',
      icon: Cpu,
      status: health?.services.aiService.status || 'checking',
      detail: health?.services.aiService.detail || 'Checking Gemini configuration...',
    },
    {
      label: 'Backend API',
      icon: Server,
      status: health?.services.backendApi.status || 'checking',
      detail: health?.services.backendApi.detail || 'Probing Express & Socket.IO...',
    },
    {
      label: 'Database',
      icon: Database,
      status: health?.services.database.status || 'checking',
      detail: health?.services.database.detail || 'Probing SQLite WAL...',
    },
    {
      label: 'Code Analysis Engine',
      icon: Code2,
      status: health?.services.codeAnalysisEngine.status || 'checking',
      detail: health?.services.codeAnalysisEngine.detail || 'Checking language parsers...',
    },
    {
      label: 'Testing Engine',
      icon: FlaskConical,
      status: health?.services.testingEngine.status || 'checking',
      detail: health?.services.testingEngine.detail || 'Checking isolated sandbox...',
    },
  ];

  const capabilityCards = [
    {
      name: 'Code Workbench & Smart Scoring',
      description: 'Inspect Monaco diagnostics, Fix Confidence vs Change Risk gauges, and approve diffs safely.',
      metric: `${data?.counts.pendingFixes ?? 0} pending patch(es)`,
      icon: Code2,
      accent: 'text-[#00F5FF]',
      to: '/workbench',
    },
    {
      name: 'Regression Guardian',
      description: 'Execute baseline and patched test suites in isolated sandboxes before modifying live code.',
      metric: `${data?.counts.regressionRuns ?? 0} test run(s) logged`,
      icon: ShieldCheck,
      accent: 'text-[#39FF88]',
      to: '/regression',
    },
    {
      name: 'Code Impact Radar',
      description: 'Visualize real parsed import graphs, direct dependents, and blast-radius hotspots.',
      metric: `${data?.counts.dependencyEdges ?? 0} dependency edge(s)`,
      icon: Radar,
      accent: 'text-[#A855F7]',
      to: '/impact',
    },
    {
      name: 'Ask AutoPatch AI',
      description: 'Context-aware debugging chat that explains bugs, tracebacks, and patches without mutating files.',
      metric: `${data?.counts.conversations ?? 0} session(s) stored`,
      icon: Bot,
      accent: 'text-[#00F5FF]',
      to: '/chat',
    },
    {
      name: 'Bug Pattern Intelligence',
      description: 'Track recurring bug classes, hot files, root causes, and resolved bug learning entries.',
      metric: `${data?.metrics.bugsResolved ?? 0} lesson(s) available`,
      icon: BrainCircuit,
      accent: 'text-[#3B82F6]',
      to: '/intelligence',
    },
    {
      name: 'Website Debugger',
      description: 'Audit public HTTPS websites with strict SSRF defense or inspect local project web assets.',
      metric: `${data?.counts.websiteScans ?? 0} web audit(s)`,
      icon: Globe,
      accent: 'text-[#FFB020]',
      to: '/website-debugger',
    },
    {
      name: 'Multimedia Debugger',
      description: 'Inspect image, audio, and video integrity via FFprobe & magic-byte checks plus project media refs.',
      metric: `${data?.counts.multimediaScans ?? 0} asset check(s)`,
      icon: FileAudio2,
      accent: 'text-[#A855F7]',
      to: '/multimedia-debugger',
    },
    {
      name: 'Patch Audit & One-Click Rollback',
      description: 'Full before/after Monaco diff trail with CSV/PDF export and versioned snapshot restoration.',
      metric: `${data?.counts.auditEvents ?? 0} audit record(s) · ${data?.counts.snapshots ?? 0} active snapshot(s)`,
      icon: History,
      accent: 'text-[#39FF88]',
      to: '/audit',
    },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Welcome Banner */}
      <section className="cyber-panel rounded-lg p-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
              <span className="font-mono tabular-nums">{todayFormatted}</span>
              <span aria-hidden="true">·</span>
              <span>
                Active project:{' '}
                <strong className="font-medium text-[#00F5FF]">
                  {activeProject ? activeProject.name : 'All Projects'}
                </strong>
              </span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#F1F5F9] sm:text-3xl">
              Welcome to AutoPatch AI
            </h1>
            <p className="max-w-2xl text-sm text-[#94A3B8]">
              Your autonomous intelligence system for detecting, analysing and repairing software bugs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/scan?mode=upload')}
              className="inline-flex items-center gap-2 rounded-md border border-[#00F5FF]/30 bg-[#142238] px-4 py-2.5 text-sm font-medium text-[#F1F5F9] transition-colors hover:border-[#00F5FF]/60 hover:text-[#00F5FF] whitespace-nowrap shrink-0"
            >
              <Upload className="h-4 w-4" />
              Upload Project
            </button>
            <button
              type="button"
              onClick={() => navigate('/scan')}
              className="cyber-glow-cyan inline-flex items-center gap-2 rounded-md bg-[#00F5FF] px-4 py-2.5 text-sm font-semibold text-[#070B14] transition-colors hover:bg-[#33f7ff] whitespace-nowrap shrink-0"
            >
              <ScanSearch className="h-4 w-4" />
              Start New Scan
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-[#FF3864]/40 bg-[#FF3864]/10 p-4 text-sm text-[#FF3864]">
          {error}
        </div>
      )}

      {/* 4 Database-Backed Analytics Cards */}
      <section aria-label="Project analytics" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="cyber-panel flex items-center justify-between rounded-lg p-5">
          <div>
            <div className="text-xs font-medium text-[#94A3B8]">Total Bugs Detected</div>
            <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-[#F1F5F9]">
              {loading ? '—' : totalBugsAnim}
            </div>
            <div className="mt-1 font-mono text-xs text-[#94A3B8] tabular-nums">
              {data?.metrics.openBugs ?? 0} currently open
            </div>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#3B82F6]/15 text-[#3B82F6]">
            <Bug className="h-5 w-5" />
          </div>
        </div>

        <div className="cyber-panel flex items-center justify-between rounded-lg p-5">
          <div>
            <div className="text-xs font-medium text-[#94A3B8]">Bugs Successfully Resolved</div>
            <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-[#39FF88]">
              {loading ? '—' : resolvedAnim}
            </div>
            <div className="mt-1 font-mono text-xs text-[#94A3B8] tabular-nums">
              Verified & audited patches
            </div>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#39FF88]/15 text-[#39FF88]">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        <div className="cyber-panel flex items-center justify-between rounded-lg p-5">
          <div>
            <div className="text-xs font-medium text-[#94A3B8]">Critical Issues</div>
            <div
              className={cn(
                'mt-2 font-mono text-3xl font-bold tabular-nums',
                (data?.metrics.criticalIssues ?? 0) > 0 ? 'text-[#FF3864]' : 'text-[#39FF88]'
              )}
            >
              {loading ? '—' : criticalAnim}
            </div>
            <div className="mt-1 font-mono text-xs text-[#94A3B8]">
              {(data?.metrics.criticalIssues ?? 0) > 0 ? 'Immediate review advised' : 'Zero open criticals'}
            </div>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#FF3864]/15 text-[#FF3864]">
            <ShieldAlert className="h-5 w-5" />
          </div>
        </div>

        <div className="cyber-panel flex items-center justify-between rounded-lg p-5">
          <div>
            <div className="text-xs font-medium text-[#94A3B8]">Project Health Score</div>
            <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-[#00F5FF]">
              {loading ? '—' : `${healthAnim}/100`}
            </div>
            <div className="mt-1 font-mono text-xs text-[#94A3B8]">
              Computed from live open severity
            </div>
          </div>
          <CircularGauge
            value={healthAnim}
            label=""
            size={64}
            color={healthAnim >= 80 ? '#39FF88' : healthAnim >= 55 ? '#FFB020' : '#FF3864'}
          />
        </div>
      </section>

      {/* Live System Health Panel */}
      <section className="cyber-panel rounded-lg p-5">
        <div className="flex items-center justify-between gap-2 pb-4 border-b border-[#00F5FF]/15">
          <div>
            <h2 className="text-base font-semibold text-[#F1F5F9]">Live System Health</h2>
            <p className="text-xs text-[#94A3B8]">
              Real-time backend probes across API, SQLite database, AI model provider, static analyzers, and sandbox runner.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchHealth()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#00F5FF]/20 bg-[#142238] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] hover:border-[#00F5FF]/50 hover:text-[#00F5FF]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Recheck
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {healthItems.map((svc) => {
            const Icon = svc.icon;
            const isOk = svc.status === 'operational';
            const isWarn = svc.status === 'unconfigured' || svc.status === 'checking';
            const statusLabel = isOk ? 'Operational' : svc.status === 'unconfigured' ? 'Not Configured' : 'Unavailable';
            const statusTextClass = isOk
              ? 'text-[#39FF88]'
              : isWarn
                ? 'text-[#FFB020]'
                : 'text-[#FF3864]';

            return (
              <div
                key={svc.label}
                className="rounded-md border border-[#00F5FF]/12 bg-[#0B1220] p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <Icon className="h-4 w-4 text-[#94A3B8]" />
                  <span className={cn('font-mono text-[11px] font-semibold', statusTextClass)}>
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-2 text-sm font-semibold text-[#F1F5F9]">{svc.label}</div>
                <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">{svc.detail}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Intelligence Overview + Activity Timeline Split */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Feature Capability Grid */}
        <section className="space-y-4 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#F1F5F9]">Intelligence Overview</h2>
            <span className="font-mono text-xs text-[#94A3B8]">8 Autonomous Modules</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {capabilityCards.map((cap) => {
              const Icon = cap.icon;
              return (
                <div
                  key={cap.name}
                  className="cyber-panel flex flex-col justify-between rounded-lg p-4 transition-colors hover:border-[#00F5FF]/35"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <Icon className={cn('h-4 w-4 shrink-0', cap.accent)} />
                        <h3 className="text-sm font-semibold text-[#F1F5F9]">{cap.name}</h3>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-[#94A3B8]">{cap.description}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-[#00F5FF]/10 pt-3">
                    <span className="font-mono text-xs text-[#94A3B8] tabular-nums">{cap.metric}</span>
                    <button
                      type="button"
                      onClick={() => navigate(cap.to)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#00F5FF] hover:underline"
                    >
                      Open
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Real Activity Timeline */}
        <section className="cyber-panel flex flex-col rounded-lg p-5">
          <div className="flex items-center justify-between border-b border-[#00F5FF]/15 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#00F5FF]" />
              <h2 className="text-base font-semibold text-[#F1F5F9]">Activity Timeline</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/audit')}
              className="text-xs font-medium text-[#00F5FF] hover:underline"
            >
              Full Audit
            </button>
          </div>

          <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded bg-[#142238]/60" />
                ))}
              </div>
            ) : !data?.activityTimeline.length ? (
              <p className="py-8 text-center text-xs text-[#94A3B8]">
                No activity events yet. Upload a project or start a scan to populate the timeline.
              </p>
            ) : (
              data.activityTimeline.map((evt) => (
                <div
                  key={`${evt.eventType}-${evt.id}`}
                  className="rounded-md border border-[#00F5FF]/10 bg-[#0B1220] p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#F1F5F9]">{evt.projectName}</span>
                    <span className="font-mono text-[11px] text-[#94A3B8] tabular-nums">
                      {new Date(evt.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-[#94A3B8]">
                    <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-[#00F5FF]">
                      {evt.eventType.replace(/_/g, ' ')}
                    </span>
                    <span aria-hidden="true" className="shrink-0">·</span>
                    <span className="truncate">{evt.detail}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
