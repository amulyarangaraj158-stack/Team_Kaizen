import React, { useEffect, useState, useCallback } from 'react';
import { Radar, GitBranch, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { severityHex, severityTextClass } from '../../lib/format';
import type { ImpactNode, ImpactRadarData, ProjectSummary, WorkspaceModule } from '../../types';
import { EmptyState, LoadingPanel } from '../ui/ToastAndConfirm';

interface ImpactRadarModuleProps {
  project: ProjectSummary | null;
  onJumpToCode: (fileId: string, line: number) => void;
  onNavigate: (mod: WorkspaceModule) => void;
  refreshTrigger: number;
}

export function ImpactRadarModule({
  project,
  onJumpToCode,
  onNavigate,
  refreshTrigger,
}: ImpactRadarModuleProps) {
  const [data, setData] = useState<ImpactRadarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const loadImpact = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<ImpactRadarData>(`/api/projects/${project.id}/impact`);
      setData(res);
      if (res.nodes.length > 0) {
        setSelectedFilePath((prev) =>
          prev && res.nodes.some((n) => n.filePath === prev) ? prev : res.nodes[0].filePath
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to analyze project dependencies.');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void loadImpact();
  }, [loadImpact, refreshTrigger]);

  if (!project) {
    return (
      <EmptyState
        title="Select a project to inspect Code Impact Radar"
        description="Code Impact Radar parses real imports and function declarations to visualize affected components and cascading defect risk."
        actionLabel="Go to Projects & Upload"
        onAction={() => onNavigate('projects')}
        icon={<Radar className="w-5 h-5" />}
      />
    );
  }

  if (loading && !data) return <LoadingPanel message="Analyzing verified source dependencies..." />;
  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (!data || data.nodes.length === 0) {
    return (
      <EmptyState
        title="No source files found"
        description="Upload source files to inspect component impact and dependency relationships."
        actionLabel="Upload Files"
        onAction={() => onNavigate('projects')}
      />
    );
  }

  const selectedNode: ImpactNode =
    data.nodes.find((n) => n.filePath === selectedFilePath) || data.nodes[0];

  // Arrange nodes deterministically on concentric radar rings (higher risk closer to center)
  const cx = 300;
  const cy = 220;
  const positioned = data.nodes.map((node, idx) => {
    const angle = (idx / Math.max(1, data.nodes.length)) * Math.PI * 2 - Math.PI / 2;
    const radius =
      node.maxSeverity === 'critical'
        ? 68
        : node.maxSeverity === 'high'
          ? 110
          : node.maxSeverity === 'medium'
            ? 145
            : 172;
    return {
      node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });

  const posMap = new Map(positioned.map((p) => [p.node.filePath, p]));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Code Impact Radar</h1>
          <p className="text-xs text-slate-400 mt-1">
            Verified static dependency map and cascading defect blast radius for{' '}
            <span className="text-slate-200 font-medium">{project.name}</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={loadImpact}
          className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Recompute Dependencies
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">High-Risk Components</p>
          <p className="text-2xl font-mono font-bold text-red-400 tabular-nums mt-1">
            {data.summary.highRiskFiles}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Files with open critical or high defects</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Verified Dependency Edges</p>
          <p className="text-2xl font-mono font-bold text-blue-400 tabular-nums mt-1">
            {data.summary.totalDependencies}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Parsed strictly from import / include statements</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Cascading Impact Files</p>
          <p className="text-2xl font-mono font-bold text-amber-400 tabular-nums mt-1">
            {data.summary.cascadingFilesCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Downstream modules importing buggy files</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Interactive SVG Radar Visualization */}
        <div className="xl:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-white font-display">Dependency & Risk Radar</h2>
              <p className="text-xs text-slate-500">
                Inner rings indicate higher severity; arrows point from importer to dependency
              </p>
            </div>
            {!data.hasVerifiedDependencies && (
              <span className="text-[11px] font-mono text-slate-400">No cross-file imports detected</span>
            )}
          </div>

          <div className="bg-[#080D19] border border-[#162038] rounded-xl overflow-hidden flex-1 flex items-center justify-center p-2">
            <svg viewBox="0 0 600 440" className="w-full h-[380px]">
              <defs>
                <marker id="arrow-dep" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#475569" />
                </marker>
                <marker id="arrow-active" viewBox="0 0 10 10" refX="18" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#60A5FA" />
                </marker>
              </defs>

              {/* Concentric Radar Rings */}
              {[172, 130, 88, 46].map((r, i) => (
                <circle
                  key={r}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={i === 3 ? '#EF444428' : '#1E2B4A'}
                  strokeDasharray={i % 2 === 1 ? '4 4' : undefined}
                  strokeWidth={1}
                />
              ))}
              <line x1={cx - 185} y1={cy} x2={cx + 185} y2={cy} stroke="#151F38" strokeWidth={1} />
              <line x1={cx} y1={cy - 185} x2={cx} y2={cy + 185} stroke="#151F38" strokeWidth={1} />

              {/* Ring Labels */}
              <text x={cx + 6} y={cy - 50} fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">Critical</text>
              <text x={cx + 6} y={cy - 92} fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">High</text>
              <text x={cx + 6} y={cy - 134} fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">Medium</text>
              <text x={cx + 6} y={cy - 176} fill="#64748B" fontSize="9" fontFamily="JetBrains Mono">Low / Clean</text>

              {/* Verified Dependency Edges */}
              {data.edges.map((edge) => {
                const fromPos = posMap.get(edge.from);
                const toPos = posMap.get(edge.to);
                if (!fromPos || !toPos) return null;
                const isRelated =
                  edge.from === selectedNode.filePath || edge.to === selectedNode.filePath;
                return (
                  <line
                    key={`${edge.from}->${edge.to}`}
                    x1={fromPos.x}
                    y1={fromPos.y}
                    x2={toPos.x}
                    y2={toPos.y}
                    stroke={isRelated ? '#60A5FA' : '#334155'}
                    strokeWidth={isRelated ? 2 : 1.2}
                    markerEnd={isRelated ? 'url(#arrow-active)' : 'url(#arrow-dep)'}
                  />
                );
              })}

              {/* File Nodes */}
              {positioned.map(({ node, x, y }) => {
                const isSelected = node.filePath === selectedNode.filePath;
                const fill = severityHex(node.maxSeverity);
                const nodeRadius = 11 + Math.min(8, node.openBugCount * 2.5);
                return (
                  <g
                    key={node.fileId}
                    onClick={() => setSelectedFilePath(node.filePath)}
                    className="cursor-pointer"
                  >
                    {isSelected && (
                      <circle cx={x} cy={y} r={nodeRadius + 7} fill="none" stroke="#60A5FA" strokeWidth={2} />
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={nodeRadius}
                      fill={fill}
                      fillOpacity={0.22}
                      stroke={fill}
                      strokeWidth={2}
                    />
                    <text
                      x={x}
                      y={y + 4}
                      textAnchor="middle"
                      fill="#F8FAFC"
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="JetBrains Mono"
                    >
                      {node.openBugCount}
                    </text>
                    <text
                      x={x}
                      y={y + nodeRadius + 14}
                      textAnchor="middle"
                      fill={isSelected ? '#FFFFFF' : '#94A3B8'}
                      fontSize="10.5"
                      fontFamily="JetBrains Mono"
                    >
                      {node.fileName}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Component Detail Inspector */}
        <div className="xl:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-[#162038]">
            <div className="min-w-0">
              <p className="text-xs font-mono text-blue-400 truncate">{selectedNode.filePath}</p>
              <p className="text-xs text-slate-400 mt-1">
                {selectedNode.language} · {selectedNode.lineCount} lines · Risk Score{' '}
                <span className="font-mono text-white tabular-nums">{selectedNode.riskScore}/100</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onJumpToCode(selectedNode.fileId, selectedNode.bugs[0]?.lineStart || 1)}
              className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1A2745] border border-[#1E2B4A] rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Inspect File
            </button>
          </div>

          {/* Functions & Affected Functions */}
          <div>
            <h3 className="text-xs font-mono text-slate-400 mb-2">
              Detected Functions ({selectedNode.functions.length})
            </h3>
            {selectedNode.functions.length === 0 ? (
              <p className="text-xs text-slate-500">No top-level functions parsed in this file.</p>
            ) : (
              <div className="flex flex-wrap gap-2 text-xs font-mono">
                {selectedNode.functions.map((fn) => {
                  const isAffected = selectedNode.affectedFunctions.includes(fn);
                  return (
                    <span
                      key={fn}
                      className={`px-2 py-1 rounded bg-[#080D19] border ${
                        isAffected
                          ? 'border-amber-500/40 text-amber-300'
                          : 'border-[#18233C] text-slate-300'
                      }`}
                    >
                      {fn}()
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Verified Dependency Relations */}
          <div className="pt-3 border-t border-[#162038] space-y-2.5 text-xs">
            <h3 className="font-mono text-slate-400 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-blue-400" />
              Verified Source Dependencies
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#080D19] border border-[#162038] rounded-lg p-3">
                <p className="text-[11px] text-slate-500 mb-1">Imports From</p>
                {selectedNode.directImports.length === 0 ? (
                  <p className="text-slate-500">None established</p>
                ) : (
                  <ul className="space-y-1 font-mono text-[11px] text-slate-200">
                    {selectedNode.directImports.map((dep) => (
                      <li key={dep} className="truncate">{dep}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="bg-[#080D19] border border-[#162038] rounded-lg p-3">
                <p className="text-[11px] text-slate-500 mb-1">Imported By</p>
                {selectedNode.importedBy.length === 0 ? (
                  <p className="text-slate-500">None established</p>
                ) : (
                  <ul className="space-y-1 font-mono text-[11px] text-slate-200">
                    {selectedNode.importedBy.map((dep) => (
                      <li key={dep} className="truncate">{dep}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Cascading Risk */}
          {selectedNode.cascadingRiskFiles.length > 0 && (
            <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs">
              <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Cascading Defect Impact
              </p>
              <p className="text-amber-200/80 mt-1 leading-relaxed">
                Open defects in <span className="font-mono">{selectedNode.fileName}</span> can propagate into downstream consumers:{' '}
                <span className="font-mono text-amber-100">{selectedNode.cascadingRiskFiles.join(', ')}</span>.
              </p>
            </div>
          )}

          {/* File Bugs */}
          <div className="pt-3 border-t border-[#162038]">
            <h3 className="text-xs font-mono text-slate-400 mb-2">
              Associated Defects ({selectedNode.bugs.length})
            </h3>
            {selectedNode.bugs.length === 0 ? (
              <p className="text-xs text-emerald-400">No defects recorded in this file.</p>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto">
                {selectedNode.bugs.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onJumpToCode(selectedNode.fileId, b.lineStart)}
                    className="w-full text-left bg-[#080D19] hover:bg-[#111B33] border border-[#162038] rounded-lg p-2.5 transition-colors"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className={`uppercase font-semibold ${severityTextClass(b.severity)}`}>{b.severity}</span>
                      <span className="text-slate-500">Line {b.lineStart} · {b.status}</span>
                    </div>
                    <p className="text-xs text-slate-200 mt-0.5 truncate">{b.title}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
