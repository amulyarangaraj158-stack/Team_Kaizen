import React, { useEffect, useState } from 'react';
import { Globe, Loader2, Shield, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { CircularGauge, cn, SeverityIndicator } from '../components/ui/Primitives';

interface WebsiteScanItem {
  id: string;
  target_url: string;
  scan_mode: string;
  status: string;
  http_status: number | null;
  response_time_ms: number;
  payload_bytes: number;
  health_score: number;
  created_at: string;
  metrics: {
    linksFound: number;
    imagesFound: number;
    imagesMissingAlt: number;
    scriptsFound: number;
    hasViewportMeta: boolean;
    hasTitle: boolean;
    hasLangAttr: boolean;
    securityHeadersPresent: string[];
    securityHeadersMissing: string[];
  };
  issues: Array<{
    category: string;
    severity: string;
    title: string;
    detail: string;
    suggestedFix: string;
  }>;
}

export function WebsiteDebuggerPage() {
  const { activeProjectId, projects } = useAppStore();
  const [mode, setMode] = useState<'remote_url' | 'local_project'>('local_project');
  const [url, setUrl] = useState('https://example.com');
  const [scanning, setScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [ssrfBlocked, setSsrfBlocked] = useState(false);
  const [history, setHistory] = useState<WebsiteScanItem[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      const res = await apiFetch<{ scans: WebsiteScanItem[] }>('/api/tools/website-scans');
      setHistory(res.scans);
      if (res.scans.length > 0 && !selectedScanId) {
        setSelectedScanId(res.scans[0].id);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSsrfBlocked(false);
    setScanning(true);
    try {
      const res = await apiFetch<{ id: string }>('/api/tools/website-scan', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          url: mode === 'remote_url' ? url : undefined,
          projectId: activeProjectId,
        }),
      });
      await loadHistory();
      setSelectedScanId(res.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Website audit failed.';
      setErrorMsg(msg);
      setSsrfBlocked(msg.toLowerCase().includes('ssrf') || msg.toLowerCase().includes('blocked'));
    } finally {
      setScanning(false);
    }
  };

  const activeReport = history.find((s) => s.id === selectedScanId) || history[0] || null;
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Website Debugger</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Audit public websites or local project HTML/JSX assets for accessibility, responsive layout, broken links, missing resources, performance, and HTTP security headers.
        </p>
      </div>

      {/* Scanner Controls */}
      <form onSubmit={handleScan} className="cyber-panel space-y-4 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-md border border-[#00F5FF]/20 bg-[#0B1220] p-1">
            <button
              type="button"
              onClick={() => setMode('local_project')}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-semibold',
                mode === 'local_project' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              )}
            >
              Local Project Audit
            </button>
            <button
              type="button"
              onClick={() => setMode('remote_url')}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-semibold',
                mode === 'remote_url' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              )}
            >
              Remote HTTPS URL
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#39FF88]">
            <Shield className="h-4 w-4 shrink-0" />
            <span>SSRF Protection Active: blocks localhost, private LAN IPs, metadata endpoints & unsafe redirects</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {mode === 'remote_url' ? (
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              aria-label="Target website URL"
              className="flex-1 rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3.5 py-2.5 font-mono text-sm text-[#F1F5F9] focus:border-[#00F5FF] focus:outline-none"
            />
          ) : (
            <div className="flex flex-1 items-center rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3.5 py-2.5 text-sm text-[#F1F5F9]">
              Target repository:{' '}
              <strong className="ml-2 font-mono text-[#00F5FF]">{activeProject?.name || 'None selected'}</strong>
            </div>
          )}

          <button
            type="submit"
            disabled={scanning || (mode === 'local_project' && !activeProjectId)}
            className="cyber-glow-cyan inline-flex items-center justify-center gap-2 rounded-md bg-[#00F5FF] px-5 py-2.5 text-sm font-semibold text-[#070B14] hover:bg-[#33f7ff] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            {scanning ? 'Auditing...' : 'Run Website Audit'}
          </button>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-md border border-[#FF3864]/40 bg-[#FF3864]/10 p-3.5 text-xs text-[#FF3864]">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-semibold">{ssrfBlocked ? 'Blocked by SSRF Firewall' : 'Scan Error'}</div>
              <p className="mt-0.5 text-[#F1F5F9]">{errorMsg}</p>
            </div>
          </div>
        )}
      </form>

      {/* Active Report + History */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          {activeReport ? (
            <div className="cyber-panel space-y-5 rounded-lg p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#00F5FF]/15 pb-4">
                <div>
                  <div className="font-mono text-xs text-[#00F5FF]">{activeReport.scan_mode.replace('_', ' ')}</div>
                  <h2 className="mt-1 break-all font-mono text-base font-bold text-[#F1F5F9]">
                    {activeReport.target_url}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-[#94A3B8] tabular-nums">
                    <span>HTTP {activeReport.http_status ?? 'local'}</span>
                    <span>·</span>
                    <span>{activeReport.response_time_ms}ms</span>
                    <span>·</span>
                    <span>{(activeReport.payload_bytes / 1024).toFixed(1)} KB</span>
                  </div>
                </div>
                <CircularGauge
                  value={activeReport.health_score}
                  label="Web Health"
                  size={80}
                  color={
                    activeReport.health_score >= 80
                      ? '#39FF88'
                      : activeReport.health_score >= 55
                        ? '#FFB020'
                        : '#FF3864'
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-md bg-[#0B1220] p-3">
                  <div className="text-[11px] text-[#94A3B8]">Links</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#F1F5F9]">
                    {activeReport.metrics.linksFound}
                  </div>
                </div>
                <div className="rounded-md bg-[#0B1220] p-3">
                  <div className="text-[11px] text-[#94A3B8]">Images (No Alt)</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#F1F5F9]">
                    {activeReport.metrics.imagesFound} ({activeReport.metrics.imagesMissingAlt})
                  </div>
                </div>
                <div className="rounded-md bg-[#0B1220] p-3">
                  <div className="text-[11px] text-[#94A3B8]">Viewport Meta</div>
                  <div className="mt-1 font-mono text-sm font-semibold text-[#39FF88]">
                    {activeReport.metrics.hasViewportMeta ? 'Present' : 'Missing'}
                  </div>
                </div>
                <div className="rounded-md bg-[#0B1220] p-3">
                  <div className="text-[11px] text-[#94A3B8]">Issues Found</div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-[#FFB020]">
                    {activeReport.issues.length}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-[#F1F5F9]">Diagnostic Findings</h3>
                {activeReport.issues.length === 0 ? (
                  <p className="rounded-md bg-[#39FF88]/10 p-3 text-xs text-[#39FF88]">
                    Zero website diagnostics flagged in this audit.
                  </p>
                ) : (
                  activeReport.issues.map((issue, idx) => (
                    <div key={idx} className="rounded-md border border-[#00F5FF]/12 bg-[#0B1220] p-4 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#F1F5F9]">{issue.title}</span>
                        <SeverityIndicator severity={issue.severity} />
                      </div>
                      <p className="text-xs text-[#94A3B8]">{issue.detail}</p>
                      <p className="text-xs text-[#00F5FF]">Suggested fix: {issue.suggestedFix}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="cyber-panel rounded-lg p-10 text-center text-sm text-[#94A3B8]">
              Run a Local Project Audit or Remote HTTPS URL scan to generate a website health report.
            </div>
          )}
        </div>

        <div className="cyber-panel rounded-lg p-5 xl:col-span-4">
          <h2 className="text-sm font-semibold text-[#F1F5F9]">Recent Website Audits</h2>
          <div className="mt-3 space-y-2">
            {history.length === 0 ? (
              <p className="text-xs text-[#94A3B8]">No website scans recorded yet.</p>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedScanId(item.id)}
                  className={cn(
                    'block w-full rounded-md border p-3 text-left text-xs transition-colors',
                    activeReport?.id === item.id
                      ? 'border-[#00F5FF]/50 bg-[#142238]'
                      : 'border-[#00F5FF]/10 bg-[#0B1220] hover:border-[#00F5FF]/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[#F1F5F9]">{item.target_url}</span>
                    <span className="font-mono font-semibold text-[#00F5FF] tabular-nums">{item.health_score}/100</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[#94A3B8]">
                    {item.issues.length} issue(s) · {new Date(item.created_at).toLocaleDateString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
