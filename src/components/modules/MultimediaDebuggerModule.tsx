import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileAudio,
  FileImage,
  FileVideo,
  FolderSearch,
  Info,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatBytes, formatTimestamp, severityTextClass } from '../../lib/format';
import type {
  MultimediaScanRecord,
  ProjectMediaAuditResult,
  ProjectSummary,
} from '../../types';
import { LoadingPanel } from '../ui/ToastAndConfirm';

interface MultimediaDebuggerModuleProps {
  project: ProjectSummary | null;
  onNotify: (type: 'success' | 'error' | 'info' | 'warning', title: string, desc?: string) => void;
  onRefreshWorkspace: () => Promise<void>;
}

type MediaTab = 'image' | 'video' | 'audio';

const ACCEPT_MAP: Record<MediaTab, string> = {
  image: '.png,.jpg,.jpeg,.webp,.gif,.svg,.avif,.bmp,image/*',
  video: '.mp4,.webm,.mov,.mkv,.avi,.m4v,video/*',
  audio: '.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,audio/*',
};

const TAB_CONFIG: Array<{ id: MediaTab; label: string; icon: React.ComponentType<{ className?: string }>; formats: string }> = [
  { id: 'image', label: 'Image Debugger', icon: FileImage, formats: 'PNG, JPG, WebP, GIF, SVG, AVIF' },
  { id: 'video', label: 'Video Debugger', icon: FileVideo, formats: 'MP4, WebM, MOV, MKV, AVI' },
  { id: 'audio', label: 'Audio Debugger', icon: FileAudio, formats: 'MP3, WAV, OGG, AAC, M4A, FLAC' },
];

export const MultimediaDebuggerModule: React.FC<MultimediaDebuggerModuleProps> = ({
  project,
  onNotify,
  onRefreshWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<MediaTab>('image');
  const [includeAiAssessment, setIncludeAiAssessment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [scans, setScans] = useState<MultimediaScanRecord[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [localPreview, setLocalPreview] = useState<{
    scanId: string;
    url: string;
    type: MediaTab;
    playbackStatus: string;
  } | null>(null);

  const [projectAudit, setProjectAudit] = useState<ProjectMediaAuditResult | null>(null);
  const [auditingProject, setAuditingProject] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadScans = useCallback(async (preferId?: string) => {
    try {
      const res = await apiRequest<{ scans: MultimediaScanRecord[] }>('/api/multimedia-scans');
      setScans(res.scans);
      setSelectedScanId((curr) => {
        if (preferId && res.scans.some((s) => s.id === preferId)) return preferId;
        if (curr && res.scans.some((s) => s.id === curr)) return curr;
        return res.scans[0]?.id || null;
      });
    } catch {
      setScans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScans();
  }, [loadScans]);

  useEffect(() => {
    return () => {
      if (localPreview?.url) URL.revokeObjectURL(localPreview.url);
    };
  }, [localPreview?.url]);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', activeTab);
      formData.append('includeAiAssessment', String(includeAiAssessment));
      if (project) formData.append('projectId', project.id);

      const res = await apiRequest<{ scan: MultimediaScanRecord }>('/api/multimedia-scans/upload', {
        method: 'POST',
        body: formData,
      });

      if (localPreview?.url) URL.revokeObjectURL(localPreview.url);
      setLocalPreview({
        scanId: res.scan.id,
        url: previewUrl,
        type: res.scan.media_type,
        playbackStatus: 'Loaded in browser preview',
      });

      await loadScans(res.scan.id);
      await onRefreshWorkspace();
      onNotify(
        res.scan.status === 'failed' ? 'error' : res.scan.issues.length > 0 ? 'warning' : 'success',
        `Multimedia Scan Completed: ${res.scan.file_name}`,
        `Inspected via ${res.scan.technical_engine} — ${res.scan.issues.length} technical finding(s).`
      );
    } catch (err: unknown) {
      URL.revokeObjectURL(previewUrl);
      onNotify('error', 'Multimedia inspection failed', err instanceof Error ? err.message : undefined);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAuditProjectMedia = async () => {
    if (!project) return;
    setAuditingProject(true);
    try {
      const res = await apiRequest<ProjectMediaAuditResult>(`/api/projects/${project.id}/media-audit`);
      setProjectAudit(res);
      onNotify(
        res.issues.length > 0 ? 'warning' : 'success',
        'Project Media Reference Audit Complete',
        `Scanned ${res.filesScanned} file(s), found ${res.totalReferences} media reference(s) and ${res.issues.length} issue(s).`
      );
    } catch (err: unknown) {
      onNotify('error', 'Project media audit failed', err instanceof Error ? err.message : undefined);
    } finally {
      setAuditingProject(false);
    }
  };

  const handleDeleteScan = async (scanId: string) => {
    try {
      await apiRequest(`/api/multimedia-scans/${scanId}`, { method: 'DELETE' });
      const remaining = scans.filter((s) => s.id !== scanId);
      setScans(remaining);
      if (selectedScanId === scanId) setSelectedScanId(remaining[0]?.id || null);
      onNotify('info', 'Multimedia scan deleted');
    } catch (err: unknown) {
      onNotify('error', 'Delete failed', err instanceof Error ? err.message : undefined);
    }
  };

  const tabScans = scans.filter((s) => s.media_type === activeTab);
  const activeScan =
    tabScans.find((s) => s.id === selectedScanId) ||
    scans.find((s) => s.id === selectedScanId) ||
    tabScans[0] ||
    null;

  if (loading) {
    return <LoadingPanel message="Loading Multimedia Debugger..." />;
  }

  return (
    <div className="space-y-6">
      {/* Header + 3-Tab Switcher */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2.5">
              <FileImage className="w-5 h-5 text-cyan-400" />
              Multimedia Debugger
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Deterministic binary inspection (Sharp, ffprobe, ffmpeg volume/clipping analysis) with optional Gemini
              multimodal visual/audio quality assessment.
            </p>
          </div>
          {project && (
            <button
              onClick={() => void handleAuditProjectMedia()}
              disabled={auditingProject}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-[#10192D] hover:bg-[#162340] border border-[#1E2B48] text-slate-200 rounded-md transition-colors"
            >
              {auditingProject ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
              ) : (
                <FolderSearch className="w-3.5 h-3.5 text-cyan-400" />
              )}
              Audit Project Media References ({project.name})
            </button>
          )}
        </div>

        {/* 3 Media Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {TAB_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            const count = scans.filter((s) => s.media_type === tab.id).length;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  const first = scans.find((s) => s.media_type === tab.id);
                  if (first) setSelectedScanId(first.id);
                }}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  active
                    ? 'bg-[#121D36] border-cyan-500/45 text-white'
                    : 'bg-[#090F1E] border-[#19243E] text-slate-400 hover:text-slate-200 hover:border-[#24355B]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${active ? 'text-cyan-400' : 'text-slate-500'}`} />
                    {tab.label}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400">{count}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">{tab.formats}</p>
              </button>
            );
          })}
        </div>

        {/* Drag & Drop Upload Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) void handleFileUpload(dropped);
          }}
          className={`border border-dashed rounded-lg p-5 transition-colors flex flex-col sm:flex-row items-center justify-between gap-4 ${
            dragging
              ? 'border-cyan-400 bg-cyan-500/10'
              : 'border-[#24355B] bg-[#090F1E] hover:border-cyan-500/40'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#10192D] border border-[#1E2B48] flex items-center justify-center shrink-0">
              <Upload className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">
                Drop a {activeTab} file here or click to inspect (max 25 MB)
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {activeTab === 'image' &&
                  'Checks magic-byte header match, binary decode (Sharp), resolution, aspect ratio, alpha channel, and SVG XSS.'}
                {activeTab === 'video' &&
                  'Runs ffprobe container/codec inspection, resolution, FPS, duration, audio track presence, and browser compatibility.'}
                {activeTab === 'audio' &&
                  'Runs ffprobe stream validation plus ffmpeg volumedetect peak clipping (0 dBFS) and silent-track diagnostics.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {activeTab !== 'video' && (
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeAiAssessment}
                  onChange={(e) => setIncludeAiAssessment(e.target.checked)}
                  className="rounded border-[#24355B] bg-[#070B14] text-violet-500"
                />
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                  Optional Gemini AI Assessment
                </span>
              </label>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_MAP[activeTab]}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileUpload(f);
              }}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-medium rounded-md flex items-center gap-2 transition-colors"
            >
              {uploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploading ? 'Inspecting...' : `Upload ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`}
            </button>
          </div>
        </div>
      </div>

      {/* Project Media Reference Audit Result (when executed) */}
      {projectAudit && (
        <div className="bg-[#0C1324] border border-violet-500/30 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-[#19243E] bg-[#090F1E] flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Project Source Media Reference Audit — {project?.name}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Scanned {projectAudit.filesScanned} source file(s), found {projectAudit.totalReferences} media
                reference(s) and {projectAudit.issues.length} issue(s).
              </p>
            </div>
            <button
              onClick={() => setProjectAudit(null)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Dismiss
            </button>
          </div>
          {projectAudit.issues.length === 0 ? (
            <div className="p-4 text-xs text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              All referenced media assets in project source code passed static integrity & alt-text checks.
            </div>
          ) : (
            <div className="divide-y divide-[#162038]">
              {projectAudit.issues.map((iss, idx) => (
                <div key={idx} className="px-5 py-3 text-xs space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-cyan-300">
                      {iss.filePath}:{iss.line} ({iss.mediaType})
                    </span>
                    <span className={`uppercase font-semibold ${severityTextClass(iss.severity)}`}>
                      {iss.severity}
                    </span>
                  </div>
                  <p className="text-white">{iss.issue}</p>
                  <p className="font-mono text-[11px] text-slate-400">Reference: {iss.reference}</p>
                  <p className="text-slate-400">Recommendation: {iss.recommendation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Split: History + Active Technical & AI Inspection */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* History */}
        <aside className="lg:col-span-4 bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden flex flex-col max-h-[680px]">
          <div className="px-4 py-3 border-b border-[#19243E] bg-[#090F1E]">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              {activeTab} Inspection History ({tabScans.length})
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[#162038]">
            {tabScans.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 text-center">
                No {activeTab} files inspected yet. Upload a file above to run real technical validation.
              </div>
            ) : (
              tabScans.map((scan) => {
                const active = activeScan?.id === scan.id;
                return (
                  <div
                    key={scan.id}
                    onClick={() => setSelectedScanId(scan.id)}
                    className={`group p-3.5 cursor-pointer transition-colors ${
                      active ? 'bg-[#121D36]' : 'hover:bg-[#0F182E]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{scan.file_name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                          {formatBytes(scan.size_bytes)} · {scan.technical_engine}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteScan(scan.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[11px] tabular-nums">
                      <span
                        className={
                          scan.status === 'failed'
                            ? 'text-red-400 font-medium'
                            : scan.issues.length > 0
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                        }
                      >
                        {scan.status.toUpperCase()} · {scan.issues.length} issue
                        {scan.issues.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-slate-500">{formatTimestamp(scan.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Active Inspection Report */}
        <div className="lg:col-span-8 space-y-4">
          {!activeScan ? (
            <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-10 text-center">
              <FileImage className="w-8 h-8 text-cyan-400/70 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-white">Upload Media to Inspect</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                Upload an image, video, or audio asset above to verify binary integrity, codec compatibility,
                audio clipping levels, and optional Gemini AI quality feedback.
              </p>
            </div>
          ) : (
            <>
              {/* Media Preview (if uploaded in current browser session) */}
              {localPreview && localPreview.scanId === activeScan.id && (
                <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">Live Browser Playback / Render Preview</span>
                    <span className="text-cyan-300 font-mono text-[11px]">{localPreview.playbackStatus}</span>
                  </div>
                  {localPreview.type === 'image' && (
                    <div className="bg-[#070B14] border border-[#19243E] rounded-md p-3 flex justify-center">
                      <img
                        src={localPreview.url}
                        alt={activeScan.file_name}
                        className="max-h-64 object-contain rounded"
                        onLoad={() =>
                          setLocalPreview((p) => (p ? { ...p, playbackStatus: 'Rendered cleanly in browser' } : p))
                        }
                        onError={() =>
                          setLocalPreview((p) =>
                            p ? { ...p, playbackStatus: 'Browser failed to decode image' } : p
                          )
                        }
                      />
                    </div>
                  )}
                  {localPreview.type === 'video' && (
                    <video
                      src={localPreview.url}
                      controls
                      className="w-full max-h-72 bg-black rounded-md border border-[#19243E]"
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        setLocalPreview((p) =>
                          p
                            ? {
                                ...p,
                                playbackStatus: `Browser decoded ${v.videoWidth}x${v.videoHeight}, ${v.duration.toFixed(1)}s`,
                              }
                            : p
                        );
                      }}
                      onError={() =>
                        setLocalPreview((p) =>
                          p ? { ...p, playbackStatus: 'Browser playback codec error' } : p
                        )
                      }
                    />
                  )}
                  {localPreview.type === 'audio' && (
                    <audio
                      src={localPreview.url}
                      controls
                      className="w-full"
                      onLoadedMetadata={(e) => {
                        const a = e.currentTarget;
                        setLocalPreview((p) =>
                          p ? { ...p, playbackStatus: `Browser decoded ${a.duration.toFixed(1)}s audio` } : p
                        );
                      }}
                      onError={() =>
                        setLocalPreview((p) =>
                          p ? { ...p, playbackStatus: 'Browser audio decode error' } : p
                        )
                      }
                    />
                  )}
                </div>
              )}

              {/* Section 1: Deterministic Technical Validation */}
              <div className="bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#19243E] bg-[#090F1E] flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-white">
                      1. Technical Validation — {activeScan.file_name}
                    </h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Deterministic Engine: <span className="font-mono text-cyan-300">{activeScan.technical_engine}</span>
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold uppercase ${
                      activeScan.status === 'failed'
                        ? 'text-red-400'
                        : activeScan.status === 'warnings'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                    }`}
                  >
                    {activeScan.status}
                  </span>
                </div>

                {/* Metadata Grid */}
                <div className="p-4 border-b border-[#19243E] grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {Object.entries(activeScan.metadata).map(([k, v]) => (
                    <div key={k} className="bg-[#090F1E] border border-[#19243E] rounded-md p-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
                      <div className="text-xs font-mono text-slate-100 mt-0.5 truncate" title={String(v ?? 'n/a')}>
                        {v === null || v === undefined ? 'n/a' : String(v)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Technical Issues */}
                <div className="p-4">
                  {activeScan.issues.length === 0 ? (
                    <div className="py-4 text-xs text-emerald-400 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      All deterministic binary, codec, format, and size checks passed cleanly.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {activeScan.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 bg-[#090F1E] border border-[#19243E] rounded-md space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {issue.severity === 'critical' || issue.severity === 'high' ? (
                                <AlertCircle className={`w-4 h-4 ${severityTextClass(issue.severity)}`} />
                              ) : issue.severity === 'medium' ? (
                                <AlertTriangle className="w-4 h-4 text-blue-400" />
                              ) : (
                                <Info className="w-4 h-4 text-emerald-400" />
                              )}
                              <span className="text-xs font-semibold text-white">{issue.title}</span>
                            </div>
                            <span className={`text-[11px] font-semibold uppercase ${severityTextClass(issue.severity)}`}>
                              {issue.severity} · {issue.category}
                            </span>
                          </div>
                          <p className="text-xs text-slate-300">{issue.detail}</p>
                          <p className="text-xs text-slate-400">
                            <span className="text-emerald-400 font-medium">Recommendation: </span>
                            {issue.recommendation}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: Optional Gemini AI Multimodal Quality Assessment */}
              <div className="bg-[#0C1324] border border-violet-500/25 rounded-lg p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                    2. Gemini AI Quality & Accessibility Assessment (Optional)
                  </h3>
                  {activeScan.ai_assessment?.qualityRating && (
                    <span className="text-xs font-semibold uppercase text-violet-300">
                      Rating: {activeScan.ai_assessment.qualityRating}
                    </span>
                  )}
                </div>

                {!activeScan.ai_assessment ? (
                  <p className="text-xs text-slate-400">
                    Not requested for this scan. Enable "Optional Gemini AI Assessment" before uploading an image
                    (PNG/JPEG/WebP ≤ 4 MB) or audio file (≤ 6 MB) to run AI perceptual quality review alongside
                    technical validation.
                  </p>
                ) : activeScan.ai_assessment.unavailable ? (
                  <p className="text-xs text-amber-300">{activeScan.ai_assessment.note}</p>
                ) : (
                  <div className="space-y-3 text-xs">
                    <p className="text-slate-200 leading-relaxed">{activeScan.ai_assessment.summary}</p>
                    {activeScan.ai_assessment.observations && activeScan.ai_assessment.observations.length > 0 && (
                      <div className="space-y-2">
                        {activeScan.ai_assessment.observations.map((obs, idx) => (
                          <div key={idx} className="p-3 bg-[#090F1E] border border-[#19243E] rounded-md">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-white">{obs.title}</span>
                              <span className="uppercase text-[10px] text-violet-300">{obs.severity}</span>
                            </div>
                            <p className="text-slate-300 mt-1">{obs.detail}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {activeScan.ai_assessment.accessibilityNotes &&
                      activeScan.ai_assessment.accessibilityNotes.length > 0 && (
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                            Accessibility Notes
                          </div>
                          <ul className="list-disc pl-4 space-y-1 text-slate-300">
                            {activeScan.ai_assessment.accessibilityNotes.map((n, i) => (
                              <li key={i}>{n}</li>
                            ))}
                          </ul>
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
