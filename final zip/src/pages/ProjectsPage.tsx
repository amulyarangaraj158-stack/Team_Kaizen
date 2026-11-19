import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Code2, FolderGit2, Plus, ScanSearch, Trash2 } from 'lucide-react';
import { apiFetch, ProjectSummary } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { CircularGauge, ConfirmDialog, EmptyState } from '../components/ui/Primitives';

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, activeProjectId, setActiveProjectId, fetchProjects, pushToast } = useAppStore();
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/projects/${deleteTarget.id}`, { method: 'DELETE' });
      pushToast({ tone: 'success', title: 'Project deleted', message: `Removed "${deleteTarget.name}" from workspace.` });
      setDeleteTarget(null);
      await fetchProjects();
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Delete failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">My Projects</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Manage uploaded repositories, monitor real-time health scores, and launch autonomous code scans.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/scan?mode=upload')}
          className="inline-flex items-center gap-2 rounded-md bg-[#00F5FF] px-4 py-2.5 text-sm font-semibold text-[#070B14] transition-colors hover:bg-[#33f7ff] whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 className="h-5 w-5" />}
          title="No projects in workspace"
          description="Upload source files or create a new repository to begin automated static analysis, AI patch synthesis, and regression testing."
          action={
            <button
              type="button"
              onClick={() => navigate('/scan?mode=upload')}
              className="rounded-md bg-[#00F5FF] px-4 py-2 text-sm font-semibold text-[#070B14]"
            >
              Upload First Project
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <div
                key={project.id}
                className={`cyber-panel flex flex-col justify-between rounded-lg p-5 transition-colors ${
                  isActive ? 'border-[#00F5FF]/50' : 'hover:border-[#00F5FF]/30'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                      <span className="font-mono text-[#00F5FF]">{project.primary_language}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{project.file_count} files</span>
                      {isActive && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-[#39FF88]">Active</span>
                        </>
                      )}
                    </div>
                    <h2 className="mt-1.5 truncate text-lg font-semibold text-[#F1F5F9]">{project.name}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-[#94A3B8] line-clamp-2">
                      {project.description || 'No repository description provided.'}
                    </p>
                  </div>
                  <CircularGauge
                    value={project.health_score}
                    label="Health"
                    size={72}
                    color={
                      project.health_score >= 80 ? '#39FF88' : project.health_score >= 55 ? '#FFB020' : '#FF3864'
                    }
                  />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 border-y border-[#00F5FF]/10 py-3 text-center">
                  <div>
                    <div className="font-mono text-base font-bold tabular-nums text-[#F1F5F9]">
                      {project.open_bugs}
                    </div>
                    <div className="text-[11px] text-[#94A3B8]">Open Bugs</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-bold tabular-nums text-[#FF3864]">
                      {project.critical_bugs}
                    </div>
                    <div className="text-[11px] text-[#94A3B8]">Critical</div>
                  </div>
                  <div>
                    <div className="font-mono text-base font-bold tabular-nums text-[#39FF88]">
                      {project.resolved_bugs}
                    </div>
                    <div className="text-[11px] text-[#94A3B8]">Resolved</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-[#94A3B8] tabular-nums">
                    {project.last_scan_at
                      ? `Last scan: ${new Date(project.last_scan_at).toLocaleDateString()}`
                      : 'Not yet scanned'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProjectId(project.id);
                        navigate('/scan');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#00F5FF]/25 bg-[#142238] px-3 py-1.5 text-xs font-medium text-[#F1F5F9] hover:border-[#00F5FF] hover:text-[#00F5FF]"
                    >
                      <ScanSearch className="h-3.5 w-3.5" />
                      Scan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProjectId(project.id);
                        navigate('/workbench');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#00F5FF] px-3 py-1.5 text-xs font-semibold text-[#070B14] hover:bg-[#33f7ff]"
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      Workbench
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(project)}
                      aria-label={`Delete project ${project.name}`}
                      className="rounded-md border border-slate-700 bg-[#0B1220] p-1.5 text-[#94A3B8] hover:border-[#FF3864]/50 hover:text-[#FF3864]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Project Repository"
        description={`Permanently delete "${deleteTarget?.name}" along with its files, detected bugs, and snapshots?`}
        confirmLabel="Delete Project"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
