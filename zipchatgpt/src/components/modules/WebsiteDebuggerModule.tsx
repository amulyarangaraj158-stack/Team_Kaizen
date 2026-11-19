import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Info,
  Lock,
  Monitor,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  Tablet,
  Trash2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatBytes, formatTimestamp, severityTextClass } from '../../lib/format';
import type { WebsiteIssue, WebsiteScanRecord } from '../../types';
import { LoadingPanel } from '../ui/ToastAndConfirm';

interface WebsiteDebuggerModuleProps {
  onNotify: (type: 'success' | 'error' | 'info' | 'warning', title: string, desc?: string) => void;
  onRefreshWorkspace: () => Promise<void>;
}

type CategoryFilter = 'all' | 'functional' | 'performance' | 'responsive' | 'accessibility' | 'seo';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All Issues',
  functional: 'Functional',
  performance: 'Performance',
  responsive: 'Responsive',
  accessibility: 'Accessibility',
  seo: 'SEO',
};

export const WebsiteDebuggerModule: React.FC<WebsiteDebuggerModuleProps> = ({
  onNotify,
  onRefreshWorkspace,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [scans, setScans] = useState<WebsiteScanRecord[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [viewport, setViewport] = useState<ViewportMode>('desktop');
  const [activeTab, setActiveTab] = useState<'issues' | 'assets' | 'preview'>('issues');

  const loadScans = useCallback(async (preferId?: string) => {
    try {
      const res = await apiRequest<{ scans: WebsiteScanRecord[] }>('/api/website-scans');
      setScans(res.scans);
      setSelectedScanId((curr) => {
        if (preferId && res.scans.some((s) => s.id === preferId)) return preferId;
        if (curr && res.scans.some((s) => s.id === curr)) return curr;
        return res.scans[0]?.id || null;
      });
    } catch {
      setScans([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void loadScans();
  }, [loadScans]);

  const handleScanWebsite = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const target = urlInput.trim();
    if (!target) {
      onNotify('warning', 'URL required', 'Enter your website URL to start debugging.');
      return;
    }

    setScanning(true);
    try {
      const res = await apiRequest<{ scan: WebsiteScanRecord }>('/api/website-scans', {
        method: 'POST',
        body: JSON.stringify({ url: target }),
      });
      await loadScans(res.scan.id);
      await onRefreshWorkspace();
      setCategoryFilter('all');
      setActiveTab('issues');
      onNotify(
        res.scan.auth_required ? 'warning' : res.scan.total_issues > 0 ? 'warning' : 'success',
        'Website Scan Completed',
        res.scan.auth_required
          ? `HTTP ${res.scan.http_status} authentication required. Public headers inspected without bypassing auth.`
          : `Inspected ${res.scan.final_url} in ${res.scan.response_time_ms}ms — ${res.scan.total_issues} issue(s) found.`
      );
    } catch (err: unknown) {
      await onRefreshWorkspace();
      onNotify('error', 'Website Scan Failed', err instanceof Error ? err.message : 'Unable to analyze URL.');
    } finally {
      setScanning(false);
    }
  };

  const handleDeleteScan = async (scanId: string) => {
    try {
      await apiRequest(`/api/website-scans/${scanId}`, { method: 'DELETE' });
      const next = scans.filter((s) => s.id !== scanId);
      setScans(next);
      if (selectedScanId === scanId) {
        setSelectedScanId(next[0]?.id || null);
      }
      onNotify('info', 'Website scan deleted');
    } catch (err: unknown) {
      onNotify('error', 'Delete failed', err instanceof Error ? err.message : undefined);
    }
  };

  const activeScan = scans.find((s) => s.id === selectedScanId) || null;
  const filteredIssues: WebsiteIssue[] = activeScan
    ? categoryFilter === 'all'
      ? activeScan.issues
      : activeScan.issues.filter((i) => i.category === categoryFilter)
    : [];

  if (loadingHistory) {
    return <LoadingPanel message="Loading Website Debugger..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header & URL Scanner Form */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2.5">
              <Globe className="w-5 h-5 text-cyan-400" />
              Website Debugger
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Live SSRF-protected HTTP, HTML/DOM, responsive metadata, WCAG accessibility, SEO, and active asset
              probing for any public website.
            </p>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
            Private/internal IP ranges & localhost blocked by SSRF guard
          </div>
        </div>

        <form onSubmit={(e) => void handleScanWebsite(e)} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Enter your website URL to start debugging."
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-[#070B14] border border-[#1E2B48] focus:border-cyan-500/50 focus:outline-none rounded-md text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <button
            type="submit"
            disabled={scanning}
            className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-colors shrink-0"
          >
            {scanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            {scanning ? 'Scanning Live Site...' : 'Scan Website'}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span>Quick test targets:</span>
          {['https://example.com', 'https://httpbin.org/html'].map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setUrlInput(sample)}
              className="px-2 py-0.5 bg-[#090F1E] hover:bg-[#15223D] border border-[#1E2B48] rounded font-mono text-cyan-300 transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split: History + Active Report */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Scan History Column */}
        <aside className="lg:col-span-4 bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden flex flex-col max-h-[700px]">
          <div className="px-4 py-3 border-b border-[#19243E] bg-[#090F1E] flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Website Scan History ({scans.length})
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#162038]">
            {scans.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 text-center">
                No websites scanned yet. Enter any public URL above to run your first live inspection.
              </div>
            ) : (
              scans.map((scan) => {
                const selected = scan.id === selectedScanId;
                return (
                  <div
                    key={scan.id}
                    onClick={() => setSelectedScanId(scan.id)}
                    className={`group p-3.5 cursor-pointer transition-colors ${
                      selected ? 'bg-[#121D36]' : 'hover:bg-[#0F182E]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate" title={scan.final_url}>
                          {scan.page_title || scan.final_url}
                        </p>
                        <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">{scan.final_url}</p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteScan(scan.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5"
                        title="Delete scan"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[11px] tabular-nums">
                      <span
                        className={
                          scan.auth_required
                            ? 'text-amber-400'
                            : scan.total_issues > 0
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }
                      >
                        HTTP {scan.http_status ?? 'ERR'} · {scan.total_issues} issue
                        {scan.total_issues === 1 ? '' : 's'}
                      </span>
                      <span className="text-slate-500">{formatTimestamp(scan.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Active Website Report */}
        <div className="lg:col-span-8 space-y-4">
          {!activeScan ? (
            <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-10 text-center">
              <Globe className="w-8 h-8 text-cyan-400/70 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-white">Ready to Inspect Public Websites</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Enter any public HTTP/HTTPS URL above to detect broken links, missing viewport tags, render-blocking
                scripts, accessibility defects, and SEO issues with real evidence.
              </p>
            </div>
          ) : (
            <>
              {/* Summary Strip */}
              <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white truncate">
                      {activeScan.page_title || activeScan.final_url}
                    </h2>
                    <p className="text-xs font-mono text-cyan-300 truncate mt-0.5">{activeScan.final_url}</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Engine: {activeScan.analysis_mode}
                    </p>
                  </div>
                  <div className="text-right text-xs tabular-nums">
                    <div className="text-white font-semibold">HTTP {activeScan.http_status}</div>
                    <div className="text-slate-400">{activeScan.response_time_ms} ms TTFB</div>
                  </div>
                </div>

                {activeScan.auth_required && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-xs text-amber-200 flex items-start gap-2">
                    <Lock className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong>Authentication Required (HTTP {activeScan.http_status}):</strong> This URL returned an
                      access wall. AutoPatch AI never bypasses login or security protections; only the public response
                      headers and returned markup were inspected.
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                  <div className="bg-[#090F1E] border border-[#19243E] rounded-md p-2.5">
                    <div className="text-[10px] text-slate-500 uppercase">HTML Size</div>
                    <div className="text-sm font-semibold text-white tabular-nums mt-0.5">
                      {formatBytes(activeScan.metrics.htmlSizeBytes || 0)}
                    </div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded-md p-2.5">
                    <div className="text-[10px] text-slate-500 uppercase">Assets Probed</div>
                    <div className="text-sm font-semibold text-white tabular-nums mt-0.5">
                      {activeScan.metrics.probedAssetsCount || 0}
                    </div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded-md p-2.5">
                    <div className="text-[10px] text-slate-500 uppercase">Broken Assets</div>
                    <div
                      className={`text-sm font-semibold tabular-nums mt-0.5 ${
                        (activeScan.metrics.brokenAssetsCount || 0) > 0 ? 'text-red-400' : 'text-emerald-400'
                      }`}
                    >
                      {activeScan.metrics.brokenAssetsCount || 0}
                    </div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded-md p-2.5">
                    <div className="text-[10px] text-slate-500 uppercase">Images / No Alt</div>
                    <div className="text-sm font-semibold text-white tabular-nums mt-0.5">
                      {activeScan.metrics.totalImages || 0} /{' '}
                      <span
                        className={
                          (activeScan.metrics.imagesMissingAlt || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'
                        }
                      >
                        {activeScan.metrics.imagesMissingAlt || 0}
                      </span>
                    </div>
                  </div>
                  <div className="bg-[#090F1E] border border-[#19243E] rounded-md p-2.5">
                    <div className="text-[10px] text-slate-500 uppercase">Total Issues</div>
                    <div
                      className={`text-sm font-semibold tabular-nums mt-0.5 ${
                        activeScan.total_issues > 0 ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {activeScan.total_issues}
                    </div>
                  </div>
                </div>
              </div>

              {/* Sub-navigation Tabs */}
              <div className="bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#19243E] bg-[#090F1E] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        ['issues', `Detected Issues (${activeScan.total_issues})`],
                        ['assets', `Probed Assets (${activeScan.assets.length})`],
                        ['preview', 'Responsive Preview'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setActiveTab(id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          activeTab === id
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                            : 'text-slate-400 hover:text-slate-200 border border-transparent'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tab 1: Issues */}
                {activeTab === 'issues' && (
                  <div className="p-4 space-y-4">
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((cat) => {
                        const count =
                          cat === 'all' ? activeScan.total_issues : activeScan.category_counts[cat] || 0;
                        return (
                          <button
                            key={cat}
                            onClick={() => setCategoryFilter(cat)}
                            className={`px-2.5 py-1 text-xs rounded-md border transition-colors tabular-nums ${
                              categoryFilter === cat
                                ? 'bg-[#15223D] border-cyan-500/40 text-white'
                                : 'bg-[#090F1E] border-[#19243E] text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {CATEGORY_LABELS[cat]} ({count})
                          </button>
                        );
                      })}
                    </div>

                    {filteredIssues.length === 0 ? (
                      <div className="py-8 text-center text-xs text-emerald-400 flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        No issues detected in this category.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredIssues.map((issue) => (
                          <div
                            key={issue.id}
                            className="p-4 bg-[#090F1E] border border-[#19243E] rounded-lg space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                {issue.severity === 'critical' || issue.severity === 'high' ? (
                                  <AlertCircle className={`w-4 h-4 ${severityTextClass(issue.severity)}`} />
                                ) : issue.severity === 'medium' ? (
                                  <AlertTriangle className="w-4 h-4 text-blue-400" />
                                ) : (
                                  <Info className="w-4 h-4 text-emerald-400" />
                                )}
                                <h4 className="text-xs font-semibold text-white">{issue.title}</h4>
                              </div>
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className={`font-semibold uppercase ${severityTextClass(issue.severity)}`}>
                                  {issue.severity}
                                </span>
                                <span className="text-slate-600">·</span>
                                <span className="text-slate-400 capitalize">{issue.category}</span>
                              </div>
                            </div>
                            <p className="text-xs text-slate-300 leading-relaxed">{issue.description}</p>
                            <div className="px-3 py-2 bg-[#070B14] border border-[#19243E] rounded font-mono text-[11px] text-cyan-200 break-all">
                              Evidence: {issue.evidence}
                            </div>
                            <p className="text-xs text-slate-400">
                              <span className="text-emerald-400 font-medium">Recommendation: </span>
                              {issue.recommendation}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 2: Probed Assets */}
                {activeTab === 'assets' && (
                  <div className="overflow-x-auto">
                    {activeScan.assets.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-500">
                        No external/internal sub-resources were discovered to probe on this page.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#19243E] bg-[#080D1A] text-[11px] uppercase tracking-wider text-slate-400">
                            <th className="py-2.5 px-4">Type</th>
                            <th className="py-2.5 px-4">Resource URL</th>
                            <th className="py-2.5 px-4">HTTP Status</th>
                            <th className="py-2.5 px-4">Latency</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#162038]">
                          {activeScan.assets.map((asset, idx) => (
                            <tr key={`${asset.url}-${idx}`} className="hover:bg-[#0F182E]">
                              <td className="py-2.5 px-4 capitalize text-slate-300">{asset.kind}</td>
                              <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300 max-w-sm truncate">
                                {asset.url}
                              </td>
                              <td className="py-2.5 px-4 tabular-nums">
                                <span className={asset.ok ? 'text-emerald-400' : 'text-red-400 font-medium'}>
                                  {asset.status ?? asset.error ?? 'Failed'}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 tabular-nums text-slate-400">{asset.latencyMs} ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* Tab 3: Responsive Preview */}
                {activeTab === 'preview' && (
                  <div className="p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 bg-[#070B14] border border-[#1E2B48] rounded-md p-1 text-xs">
                        {(
                          [
                            ['desktop', 'Desktop (100%)', Monitor],
                            ['tablet', 'Tablet (768px)', Tablet],
                            ['mobile', 'Mobile (390px)', Smartphone],
                          ] as const
                        ).map(([modeId, label, Icon]) => (
                          <button
                            key={modeId}
                            onClick={() => setViewport(modeId)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                              viewport === modeId
                                ? 'bg-cyan-500/20 text-cyan-300 font-medium'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {label}
                          </button>
                        ))}
                      </div>
                      <a
                        href={activeScan.final_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"
                      >
                        Open Live URL <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    {!activeScan.embed_allowed ? (
                      <div className="p-6 bg-[#090F1E] border border-amber-500/30 rounded-lg text-xs space-y-2">
                        <div className="flex items-center gap-2 text-amber-300 font-semibold">
                          <ShieldAlert className="w-4 h-4" />
                          Live Iframe Preview Blocked by Target Site Security Policy
                        </div>
                        <p className="text-slate-300 leading-relaxed">
                          {activeScan.embed_block_reason ||
                            'This website sets X-Frame-Options or CSP frame-ancestors headers that prevent third-party iframe embedding.'}
                        </p>
                        <p className="text-slate-400">
                          All HTML/DOM, responsive viewport, accessibility, SEO, and asset checks above were still
                          performed directly against the live HTTP response.
                        </p>
                      </div>
                    ) : (
                      <div className="flex justify-center bg-[#070B14] border border-[#19243E] rounded-lg p-4 overflow-x-auto">
                        <iframe
                          title={`Responsive preview of ${activeScan.final_url}`}
                          src={activeScan.final_url}
                          sandbox="allow-scripts allow-same-origin"
                          style={{
                            width:
                              viewport === 'mobile' ? '390px' : viewport === 'tablet' ? '768px' : '100%',
                            height: '520px',
                          }}
                          className="bg-white rounded border border-[#24355B] transition-all"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
