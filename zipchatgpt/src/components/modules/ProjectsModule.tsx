import React, { useState, useRef, useMemo } from 'react';
import {
  UploadCloud,
  FolderOpen,
  FileCode2,
  Trash2,
  Loader2,
  ScanSearch,
  ChevronRight,
  ChevronDown,
  Sparkles,
  FileArchive,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatBytes, formatTimestamp, healthLabel } from '../../lib/format';
import type { ProjectSummary, UploadedFile, WorkspaceModule } from '../../types';
import { EmptyState } from '../ui/ToastAndConfirm';

interface ProjectsModuleProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  projectFiles: UploadedFile[];
  onSelectProject: (id: string) => void;
  onRefreshProjects: (selectId?: string) => Promise<void>;
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
  onConfirm: (opts: { title: string; message: string; confirmLabel: string; destructive?: boolean; onConfirm: () => Promise<void> }) => void;
}

const SUPPORTED_EXT_LIST = [
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.html', '.css', '.scss', '.json', '.sql', '.go', '.rs', '.rb', '.php', '.zip',
];

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  file?: UploadedFile;
  children: TreeNode[];
}

function buildFileTree(files: UploadedFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.file_path.split('/');
    let level = root;
    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;
      let existing = level.find((n) => n.name === part && n.isFolder === !isFile);
      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          isFolder: !isFile,
          file: isFile ? file : undefined,
          children: [],
        };
        level.push(existing);
      }
      level = existing.children;
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1))
      .map((n) => ({ ...n, children: sortNodes(n.children) }));

  return sortNodes(root);
}

export function ProjectsModule({
  projects,
  selectedProjectId,
  projectFiles,
  onSelectProject,
  onRefreshProjects,
  onNavigate,
  onNotify,
  onConfirm,
}: ProjectsModuleProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [creatingSample, setCreatingSample] = useState<'javascript' | 'python' | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;
  const fileTree = useMemo(() => buildFileTree(projectFiles), [projectFiles]);
  const activePreviewFile =
    projectFiles.find((f) => f.id === previewFileId) || projectFiles[0] || null;

  const validateAndAddFiles = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming);
    const valid: File[] = [];
    const rejected: string[] = [];

    for (const file of arr) {
      const lower = file.name.toLowerCase();
      const hasValidExt = SUPPORTED_EXT_LIST.some((ext) => lower.endsWith(ext));
      const maxBytes = lower.endsWith('.zip') ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
      if (!hasValidExt) {
        rejected.push(`${file.name} (unsupported extension)`);
      } else if (file.size > maxBytes) {
        rejected.push(`${file.name} (exceeds size limit)`);
      } else {
        valid.push(file);
      }
    }

    if (rejected.length > 0) {
      onNotify('warning', 'Some files skipped', rejected.slice(0, 3).join(', '));
    }
    if (valid.length > 0) {
      setQueuedFiles((prev) => [...prev, ...valid]);
      if (!name.trim()) {
        const firstBase = valid[0].name.replace(/\.[^.]+$/, '');
        setName(firstBase);
      }
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || queuedFiles.length === 0) {
      onNotify('warning', 'Missing fields', 'Enter a project name and add at least one source file or ZIP archive.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('description', description.trim());
      const relPaths = queuedFiles.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      formData.append('relativePaths', JSON.stringify(relPaths));
      for (const file of queuedFiles) {
        formData.append('files', file);
      }

      const data = await apiRequest<{ project: ProjectSummary; filesIndexed: number; skippedCount: number }>(
        '/api/projects/upload',
        { method: 'POST', body: formData }
      );

      onNotify(
        'success',
        `Project "${data.project.name}" uploaded`,
        `Indexed ${data.filesIndexed} supported file(s)${data.skippedCount ? ` (${data.skippedCount} skipped)` : ''}.`
      );
      setName('');
      setDescription('');
      setQueuedFiles([]);
      await onRefreshProjects(data.project.id);
    } catch (err: unknown) {
      onNotify('error', 'Upload failed', err instanceof Error ? err.message : 'Unable to process files.');
    } finally {
      setUploading(false);
    }
  };

  const handleLoadSample = async (sampleKey: 'javascript' | 'python') => {
    setCreatingSample(sampleKey);
    try {
      const data = await apiRequest<{ project: ProjectSummary }>('/api/projects/sample', {
        method: 'POST',
        body: JSON.stringify({ sampleKey }),
      });
      onNotify('success', 'Sample project created', `Loaded ${data.project.name}. Ready for AI scanning.`);
      await onRefreshProjects(data.project.id);
    } catch (err: unknown) {
      onNotify('error', 'Sample creation failed', err instanceof Error ? err.message : 'Error creating sample.');
    } finally {
      setCreatingSample(null);
    }
  };

  const handleDeleteProject = (proj: ProjectSummary) => {
    onConfirm({
      title: `Delete "${proj.name}"?`,
      message: 'This permanently deletes all uploaded files, scan reports, suggested patches, and test results for this project.',
      confirmLabel: 'Delete Project',
      destructive: true,
      onConfirm: async () => {
        await apiRequest(`/api/projects/${proj.id}`, { method: 'DELETE' });
        onNotify('info', 'Project deleted', `"${proj.name}" was removed.`);
        await onRefreshProjects();
      },
    });
  };

  const renderTree = (nodes: TreeNode[], depth = 0) =>
    nodes.map((node) => {
      if (node.isFolder) {
        const isCollapsed = collapsedFolders[node.path];
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => setCollapsedFolders((prev) => ({ ...prev, [node.path]: !prev[node.path] }))}
              style={{ paddingLeft: `${depth * 14 + 8}px` }}
              className="w-full py-1.5 pr-3 flex items-center gap-1.5 text-xs text-slate-300 hover:bg-[#131E36] rounded transition-colors text-left"
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
              <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="truncate font-mono">{node.name}</span>
            </button>
            {!isCollapsed && renderTree(node.children, depth + 1)}
          </div>
        );
      }

      const isActive = activePreviewFile?.id === node.file?.id;
      return (
        <button
          key={node.path}
          type="button"
          onClick={() => node.file && setPreviewFileId(node.file.id)}
          style={{ paddingLeft: `${depth * 14 + 22}px` }}
          className={`w-full py-1.5 pr-3 flex items-center justify-between gap-2 text-xs rounded transition-colors text-left ${
            isActive ? 'bg-blue-600/20 text-blue-200' : 'text-slate-400 hover:bg-[#131E36] hover:text-slate-200'
          }`}
        >
          <span className="flex items-center gap-1.5 truncate font-mono">
            <FileCode2 className="w-3.5 h-3.5 shrink-0 text-slate-500" />
            {node.name}
          </span>
          <span className="text-[10px] font-mono text-slate-500 tabular-nums shrink-0">
            {node.file?.line_count}L
          </span>
        </button>
      );
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Projects & Upload</h1>
          <p className="text-xs text-slate-400 mt-1">
            Upload individual files, multi-file sets, or complete ZIP archives. Original baselines remain immutable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={creatingSample !== null}
            onClick={() => handleLoadSample('javascript')}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {creatingSample === 'javascript' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
            Load JS Sample
          </button>
          <button
            type="button"
            disabled={creatingSample !== null}
            onClick={() => handleLoadSample('python')}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {creatingSample === 'python' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-blue-400" />}
            Load Python Sample
          </button>
        </div>
      </div>

      {/* Upload Form + Project List */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Upload Form */}
        <form
          onSubmit={handleUploadSubmit}
          className="lg:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-xl p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white font-display">Upload New Project</h2>

          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Project Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. PaymentGateway API"
              className="w-full px-3 py-2 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-300 mb-1.5">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief summary of repository purpose"
              className="w-full px-3 py-2 text-sm bg-[#080D19] border border-[#1E2B4A] rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Drag-and-Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (e.dataTransfer.files?.length) validateAndAddFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer border border-dashed rounded-xl p-6 text-center transition-colors ${
              dragActive
                ? 'border-blue-400 bg-blue-500/10'
                : 'border-[#25355B] bg-[#080D19] hover:border-blue-500/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={SUPPORTED_EXT_LIST.join(',')}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) validateAndAddFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <UploadCloud className="w-7 h-7 text-blue-400 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-200">
              Drag & drop source files or a .zip archive here, or click to browse
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              JS, TS, Python, Java, C/C++, HTML, CSS, SQL, Go, Rust, PHP · Max 2MB/file, 10MB/ZIP
            </p>
          </div>

          {queuedFiles.length > 0 && (
            <div className="bg-[#080D19] border border-[#18233C] rounded-lg p-3 max-h-36 overflow-y-auto space-y-1.5">
              {queuedFiles.map((f, idx) => (
                <div key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-slate-300 truncate font-mono">
                    {f.name.endsWith('.zip') ? (
                      <FileArchive className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    ) : (
                      <FileCode2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    )}
                    {f.name}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">{formatBytes(f.size)}</span>
                    <button
                      type="button"
                      onClick={() => setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-slate-500 hover:text-red-400"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={uploading || queuedFiles.length === 0}
            className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            {uploading ? 'Indexing & Validating...' : `Create Project (${queuedFiles.length} item${queuedFiles.length === 1 ? '' : 's'})`}
          </button>
        </form>

        {/* Managed Projects List */}
        <div className="lg:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#162038] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white font-display">
              Your Projects ({projects.length})
            </h2>
            {selectedProject && (
              <button
                type="button"
                onClick={() => onNavigate('scanner')}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
              >
                <ScanSearch className="w-3.5 h-3.5" />
                Scan Active Project
              </button>
            )}
          </div>

          {projects.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No repositories yet"
                description="Upload files on the left or click Load JS Sample / Load Python Sample above."
              />
            </div>
          ) : (
            <div className="divide-y divide-[#141E34] overflow-y-auto max-h-[420px]">
              {projects.map((p) => {
                const isSelected = p.id === selectedProjectId;
                const h = healthLabel(p.health_status);
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      onSelectProject(p.id);
                      setPreviewFileId(null);
                    }}
                    className={`px-5 py-4 cursor-pointer transition-colors flex items-start justify-between gap-4 ${
                      isSelected ? 'bg-blue-600/10' : 'hover:bg-[#111B33]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <p className="text-sm font-semibold text-slate-100">{p.name}</p>
                        {isSelected && <span className="text-[11px] font-mono text-blue-400">Selected</span>}
                      </div>
                      {p.description && (
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{p.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-2 font-mono">
                        <span>{(p.languages || [p.primary_language]).join(', ')}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{p.total_files} files</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{p.total_lines} lines</span>
                        <span aria-hidden="true">·</span>
                        <span className={h.className}>{h.text}</span>
                        <span aria-hidden="true">·</span>
                        <span>Last scan: {formatTimestamp(p.last_scan_at)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProject(p);
                      }}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
                      title="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* File Explorer & Source Preview */}
      {selectedProject && (
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#162038] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white font-display">
                Project Structure · {selectedProject.name}
              </h2>
              <p className="text-xs text-slate-500">
                Browse indexed folders and preview active source files before scanning
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('explain')}
                className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors"
              >
                Open in Code & Explain
              </button>
              <button
                type="button"
                onClick={() => onNavigate('radar')}
                className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors"
              >
                Inspect Impact Radar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[340px]">
            <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#162038] p-3 bg-[#090F1E] overflow-y-auto max-h-[420px]">
              {renderTree(fileTree)}
            </div>
            <div className="lg:col-span-8 flex flex-col bg-[#080D19]">
              {activePreviewFile ? (
                <>
                  <div className="px-4 py-2.5 border-b border-[#162038] flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-200">{activePreviewFile.file_path}</span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {activePreviewFile.language} · {activePreviewFile.line_count} lines · {formatBytes(activePreviewFile.size_bytes)}
                    </span>
                  </div>
                  <pre className="p-4 text-xs font-mono text-slate-300 overflow-auto max-h-[370px] leading-6">
                    {activePreviewFile.current_content.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="w-9 text-slate-600 select-none tabular-nums shrink-0">{i + 1}</span>
                        <span className="whitespace-pre">{line}</span>
                      </div>
                    ))}
                  </pre>
                </>
              ) : (
                <div className="p-8 text-xs text-slate-500">Select a file from the explorer to preview its contents.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
