import React, { useEffect, useState } from 'react';
import { FileAudio2, FolderSearch, Loader2, Upload } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { cn, SeverityIndicator } from '../components/ui/Primitives';

interface MediaScanItem {
  id: string;
  filename: string;
  media_type: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  ai_interpretation: string | null;
  created_at: string;
  technicalChecks: {
    magicHeaderValid?: boolean;
    ffprobeAvailable?: boolean;
    filesScanned?: number;
    metadata?: {
      formatName?: string;
      durationSeconds?: number;
      bitRate?: number;
      width?: number;
      height?: number;
      videoCodec?: string;
      audioCodec?: string;
      hasVideoStream?: boolean;
      hasAudioStream?: boolean;
    };
  };
  issues: Array<{
    severity: string;
    checkType: string;
    title: string;
    detail: string;
    recommendation: string;
  }>;
}

export function MultimediaDebuggerPage() {
  const { activeProjectId, projects, pushToast } = useAppStore();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [includeAi, setIncludeAi] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanningProject, setScanningProject] = useState(false);
  const [history, setHistory] = useState<MediaScanItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      const res = await apiFetch<{ scans: MediaScanItem[] }>('/api/tools/multimedia-scans');
      setHistory(res.scans);
      if (res.scans.length > 0 && !selectedId) setSelectedId(res.scans[0].id);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleUploadScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', selectedFile);
      if (activeProjectId) fd.append('projectId', activeProjectId);
      fd.append('includeAiSemantics', includeAi ? 'true' : 'false');
      const res = await apiFetch<{ id: string }>('/api/tools/multimedia-scan', {
        method: 'POST',
        body: fd,
      });
      await loadHistory();
      setSelectedId(res.id);
      setSelectedFile(null);
      pushToast({ tone: 'success', title: 'Media inspection complete', message: selectedFile.name });
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Media inspection failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setUploading(false);
    }
  };

  const handleScanProjectRefs = async () => {
    if (!activeProjectId) return;
    setScanningProject(true);
    try {
      const res = await apiFetch<{ id: string; filesScanned: number; issues: unknown[] }>(
        '/api/tools/multimedia-scan-project',
        {
          method: 'POST',
          body: JSON.stringify({ projectId: activeProjectId }),
        }
      );
      await loadHistory();
      setSelectedId(res.id);
      pushToast({
        tone: 'info',
        title: 'Project media references audited',
        message: `Scanned ${res.filesScanned} file(s), found ${res.issues.length} reference issue(s).`,
      });
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Reference scan failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setScanningProject(false);
    }
  };

  const active = history.find((h) => h.id === selectedId) || history[0] || null;
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Multimedia Debugger</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Technical binary magic-byte and FFprobe stream validation for images, audio, and video (15 MB limit), clearly separated from optional Gemini semantic visual review.
          </p>
        </div>

        <button
          type="button"
          disabled={scanningProject || !activeProjectId}
          onClick={handleScanProjectRefs}
          className="inline-flex items-center gap-2 rounded-md border border-[#00F5FF]/30 bg-[#142238] px-4 py-2 text-xs font-semibold text-[#F1F5F9] hover:border-[#00F5FF] hover:text-[#00F5FF] disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          {scanningProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSearch className="h-4 w-4" />}
          Audit {activeProject?.name || 'Project'} Media Refs
        </button>
      </div>

      <form onSubmit={handleUploadScan} className="cyber-panel space-y-4 rounded-lg p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <label className="flex flex-1 cursor-pointer items-center justify-between rounded-md border border-dashed border-[#00F5FF]/30 bg-[#070B14] px-4 py-3 text-xs text-[#94A3B8] hover:border-[#00F5FF]">
            <span className="flex items-center gap-2 truncate">
              <Upload className="h-4 w-4 shrink-0 text-[#00F5FF]" />
              {selectedFile
                ? `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
                : 'Choose image (PNG/JPEG/WebP/SVG), audio (MP3/WAV/OGG), or video (MP4/WebM) — max 15MB'}
            </span>
            <input
              type="file"
              accept="image/*,audio/*,video/*"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[#94A3B8] whitespace-nowrap">
            <input
              type="checkbox"
              checked={includeAi}
              onChange={(e) => setIncludeAi(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#A855F7]"
            />
            Add AI Semantic Inspection (Images)
          </label>

          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="cyber-glow-cyan inline-flex items-center justify-center gap-2 rounded-md bg-[#00F5FF] px-5 py-2.5 text-xs font-semibold text-[#070B14] hover:bg-[#33f7ff] disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileAudio2 className="h-4 w-4" />}
            Inspect Asset
          </button>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          {active ? (
            <div className="cyber-panel space-y-5 rounded-lg p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#00F5FF]/15 pb-4">
                <div>
                  <div className="font-mono text-xs text-[#00F5FF]">
                    {active.media_type} · {active.mime_type}
                  </div>
                  <h2 className="mt-1 text-base font-bold text-[#F1F5F9]">{active.filename}</h2>
                </div>
                <span
                  className={cn(
                    'font-mono text-xs font-semibold',
                    active.status === 'healthy'
                      ? 'text-[#39FF88]'
                      : active.status === 'warning'
                        ? 'text-[#FFB020]'
                        : 'text-[#FF3864]'
                  )}
                >
                  Status: {active.status}
                </span>
              </div>

              {/* Technical Validation Section */}
              <div>
                <h3 className="text-xs font-semibold text-[#F1F5F9]">Technical Validation (Binary Header & FFprobe)</h3>
                <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                  <div className="rounded bg-[#0B1220] p-3">
                    <div className="text-[#94A3B8]">Magic Signature</div>
                    <div className="mt-1 font-mono font-semibold text-[#F1F5F9]">
                      {active.technicalChecks.magicHeaderValid === undefined
                        ? 'Project Audit'
                        : active.technicalChecks.magicHeaderValid
                          ? 'Valid'
                          : 'Mismatch / Corrupt'}
                    </div>
                  </div>
                  <div className="rounded bg-[#0B1220] p-3">
                    <div className="text-[#94A3B8]">Dimensions</div>
                    <div className="mt-1 font-mono font-semibold text-[#F1F5F9]">
                      {active.technicalChecks.metadata?.width
                        ? `${active.technicalChecks.metadata.width}×${active.technicalChecks.metadata.height}`
                        : 'N/A'}
                    </div>
                  </div>
                  <div className="rounded bg-[#0B1220] p-3">
                    <div className="text-[#94A3B8]">Codecs</div>
                    <div className="mt-1 font-mono font-semibold text-[#F1F5F9]">
                      {[active.technicalChecks.metadata?.videoCodec, active.technicalChecks.metadata?.audioCodec]
                        .filter(Boolean)
                        .join(' / ') || active.technicalChecks.metadata?.formatName || 'N/A'}
                    </div>
                  </div>
                  <div className="rounded bg-[#0B1220] p-3">
                    <div className="text-[#94A3B8]">Duration</div>
                    <div className="mt-1 font-mono font-semibold tabular-nums text-[#F1F5F9]">
                      {active.technicalChecks.metadata?.durationSeconds
                        ? `${active.technicalChecks.metadata.durationSeconds.toFixed(2)}s`
                        : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Separate AI Semantic Interpretation */}
              {active.ai_interpretation && (
                <div className="rounded-md border border-[#A855F7]/30 bg-[#A855F7]/10 p-4">
                  <div className="text-xs font-semibold text-[#A855F7]">
                    AI Semantic Interpretation (Separate from Technical Codec Checks)
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[#F1F5F9]">{active.ai_interpretation}</p>
                </div>
              )}

              {/* Issues */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-[#F1F5F9]">Detected Issues</h3>
                {active.issues.length === 0 ? (
                  <p className="rounded-md bg-[#39FF88]/10 p-3 text-xs text-[#39FF88]">
                    All technical checks passed with zero detected anomalies.
                  </p>
                ) : (
                  active.issues.map((issue, idx) => (
                    <div key={idx} className="rounded-md border border-[#00F5FF]/12 bg-[#0B1220] p-3.5 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#F1F5F9]">{issue.title}</span>
                        <SeverityIndicator severity={issue.severity} />
                      </div>
                      <p className="text-xs text-[#94A3B8]">{issue.detail}</p>
                      <p className="text-xs text-[#00F5FF]">Recommendation: {issue.recommendation}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="cyber-panel rounded-lg p-10 text-center text-sm text-[#94A3B8]">
              Upload a multimedia asset or audit your active project's media references to view technical diagnostics.
            </div>
          )}
        </div>

        <div className="cyber-panel rounded-lg p-5 xl:col-span-4">
          <h2 className="text-sm font-semibold text-[#F1F5F9]">Inspection History</h2>
          <div className="mt-3 space-y-2">
            {history.length === 0 ? (
              <p className="text-xs text-[#94A3B8]">No multimedia checks run yet.</p>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'block w-full rounded-md border p-3 text-left text-xs transition-colors',
                    active?.id === item.id
                      ? 'border-[#00F5FF]/50 bg-[#142238]'
                      : 'border-[#00F5FF]/10 bg-[#0B1220] hover:border-[#00F5FF]/30'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-[#F1F5F9]">{item.filename}</span>
                    <span className="font-mono text-[#00F5FF]">{item.status}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[#94A3B8]">
                    {item.media_type} · {item.issues.length} issue(s)
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
