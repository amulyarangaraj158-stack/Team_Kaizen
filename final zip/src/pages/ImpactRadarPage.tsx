import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Code2, Radar } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { EmptyState } from '../components/ui/Primitives';

interface ImpactNodeRecord {
  id: string;
  file_path: string;
  label: string;
  language: string;
  exports: string[];
  direct_dependents: number;
  indirect_dependents: number;
  impact_level: 'low' | 'medium' | 'high' | 'critical';
  open_bugs: number;
}

interface ImpactEdgeRecord {
  id: string;
  source_path: string;
  target_path: string;
  import_type: string;
  symbols: string[];
}

export function ImpactRadarPage() {
  const navigate = useNavigate();
  const { activeProjectId } = useAppStore();
  const [nodesData, setNodesData] = useState<ImpactNodeRecord[]>([]);
  const [edgesData, setEdgesData] = useState<ImpactEdgeRecord[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiFetch<{ nodes: ImpactNodeRecord[]; edges: ImpactEdgeRecord[] }>(
      `/api/projects/${activeProjectId}/impact`
    )
      .then((res) => {
        setNodesData(res.nodes);
        setEdgesData(res.edges);
        setSelectedPath(res.nodes[0]?.file_path ?? null);
      })
      .catch(() => {
        setNodesData([]);
        setEdgesData([]);
      })
      .finally(() => setLoading(false));
  }, [activeProjectId]);

  // Compute direct & indirect affected modules when a node is selected
  const impactSets = useMemo(() => {
    const direct = new Set<string>();
    const indirect = new Set<string>();
    const imports = new Set<string>();
    if (!selectedPath) return { direct, indirect, imports };

    const reverseMap = new Map<string, string[]>();
    for (const e of edgesData) {
      if (!reverseMap.has(e.target_path)) reverseMap.set(e.target_path, []);
      reverseMap.get(e.target_path)!.push(e.source_path);
      if (e.source_path === selectedPath) imports.add(e.target_path);
    }

    const firstHop = reverseMap.get(selectedPath) || [];
    for (const f of firstHop) direct.add(f);

    const queue = [...firstHop];
    const visited = new Set<string>([selectedPath, ...firstHop]);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const next of reverseMap.get(curr) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          indirect.add(next);
          queue.push(next);
        }
      }
    }
    return { direct, indirect, imports };
  }, [selectedPath, edgesData]);

  const flowNodes: Node[] = useMemo(() => {
    const cols = Math.max(2, Math.ceil(Math.sqrt(nodesData.length)));
    return nodesData.map((n, index) => {
      const isSelected = n.file_path === selectedPath;
      const isDirect = impactSets.direct.has(n.file_path);
      const isIndirect = impactSets.indirect.has(n.file_path);
      const isHighImpact = n.impact_level === 'high' || n.impact_level === 'critical';

      const borderColor = isSelected
        ? '#00F5FF'
        : isDirect
          ? '#FF3864'
          : isIndirect
            ? '#FFB020'
            : isHighImpact
              ? '#A855F7'
              : 'rgba(0, 245, 255, 0.28)';

      const bgColor = isSelected
        ? '#142238'
        : isDirect
          ? 'rgba(255, 56, 100, 0.14)'
          : isIndirect
            ? 'rgba(255, 176, 32, 0.12)'
            : '#101A2B';

      const col = index % cols;
      const row = Math.floor(index / cols);

      return {
        id: n.file_path,
        position: { x: col * 290 + 40, y: row * 150 + 40 },
        data: {
          label: (
            <div className="text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold text-[#F1F5F9]">{n.label}</span>
                {n.open_bugs > 0 && (
                  <span className="font-mono text-[10px] font-bold text-[#FF3864]">{n.open_bugs} bug(s)</span>
                )}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-[#94A3B8]">{n.file_path}</div>
              <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-[#00F5FF]">
                <span>{n.language}</span>
                <span>·</span>
                <span>{n.direct_dependents} dep(s)</span>
              </div>
            </div>
          ),
        },
        style: {
          width: 235,
          backgroundColor: bgColor,
          border: `1.5px solid ${borderColor}`,
          borderRadius: 8,
          padding: 10,
          color: '#F1F5F9',
          boxShadow: isSelected ? '0 0 20px rgba(0,245,255,0.35)' : undefined,
        },
      };
    });
  }, [nodesData, selectedPath, impactSets]);

  const flowEdges: Edge[] = useMemo(() => {
    return edgesData.map((e) => {
      const affected = e.target_path === selectedPath || impactSets.direct.has(e.target_path);
      return {
        id: e.id,
        source: e.source_path,
        target: e.target_path,
        animated: false,
        label: e.symbols.slice(0, 2).join(', ') || undefined,
        labelStyle: { fill: '#94A3B8', fontSize: 10, fontFamily: 'JetBrains Mono' },
        labelBgStyle: { fill: '#070B14', fillOpacity: 0.85 },
        style: {
          stroke: e.target_path === selectedPath ? '#FF3864' : affected ? '#FFB020' : '#00F5FF',
          strokeWidth: affected ? 2.4 : 1.4,
          strokeDasharray: affected ? '6 3' : undefined,
          opacity: affected ? 1 : 0.65,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: e.target_path === selectedPath ? '#FF3864' : '#00F5FF',
        },
      };
    });
  }, [edgesData, selectedPath, impactSets]);

  const selectedNode = nodesData.find((n) => n.file_path === selectedPath) ?? null;

  if (!activeProjectId) {
    return (
      <EmptyState
        icon={<Radar className="h-5 w-5" />}
        title="No project selected"
        description="Select a project to visualize real import relationships and change blast radius."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1520px] space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Code Impact Radar</h1>
          <p className="text-xs text-[#94A3B8]">
            Interactive React Flow dependency graph built from real parsed imports. Select any module to trace direct and indirect blast radius.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-[#94A3B8]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#00F5FF]" /> Selected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#FF3864]" /> Direct Dependent
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#FFB020]" /> Indirect Dependent
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#A855F7]" /> High-Impact Core
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* React Flow Canvas */}
        <div className="cyber-panel h-[580px] overflow-hidden rounded-lg xl:col-span-8">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-[#94A3B8]">
              Building dependency topology...
            </div>
          ) : nodesData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[#94A3B8]">
              No source files indexed for this project yet. Run a scan to map imports.
            </div>
          ) : (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              fitView
              onNodeClick={(_evt, node) => setSelectedPath(node.id)}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(0, 245, 255, 0.08)" gap={24} />
              <Controls />
              <MiniMap
                nodeColor={(n) => (n.id === selectedPath ? '#00F5FF' : '#3B82F6')}
                maskColor="rgba(7, 11, 20, 0.75)"
              />
            </ReactFlow>
          )}
        </div>

        {/* Node Detail Inspector */}
        <div className="cyber-panel space-y-4 rounded-lg p-5 xl:col-span-4">
          {selectedNode ? (
            <>
              <div>
                <div className="font-mono text-xs text-[#00F5FF]">{selectedNode.language}</div>
                <h2 className="mt-1 break-all font-mono text-sm font-bold text-[#F1F5F9]">
                  {selectedNode.file_path}
                </h2>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-md bg-[#0B1220] p-3 text-center">
                <div>
                  <div className="font-mono text-lg font-bold tabular-nums text-[#FF3864]">
                    {impactSets.direct.size}
                  </div>
                  <div className="text-[11px] text-[#94A3B8]">Direct Deps</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-bold tabular-nums text-[#FFB020]">
                    {impactSets.indirect.size}
                  </div>
                  <div className="text-[11px] text-[#94A3B8]">Indirect</div>
                </div>
                <div>
                  <div className="font-mono text-lg font-bold tabular-nums text-[#00F5FF]">
                    {selectedNode.open_bugs}
                  </div>
                  <div className="text-[11px] text-[#94A3B8]">Open Bugs</div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#F1F5F9]">Exported Functions / Symbols</div>
                {selectedNode.exports.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-xs text-[#00F5FF]">
                    {selectedNode.exports.map((sym, i) => (
                      <React.Fragment key={sym}>
                        {i > 0 && <span className="text-[#94A3B8]">·</span>}
                        <span>{sym}</span>
                      </React.Fragment>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-[#94A3B8]">No named exports parsed in this module.</p>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold text-[#F1F5F9]">Potentially Affected Modules</div>
                {impactSets.direct.size + impactSets.indirect.size === 0 ? (
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    Leaf module — no other project files import this file directly.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5 font-mono text-xs">
                    {Array.from(impactSets.direct).map((p) => (
                      <li key={p} className="flex items-center justify-between rounded bg-[#FF3864]/10 px-2.5 py-1.5">
                        <span className="truncate text-[#F1F5F9]">{p}</span>
                        <span className="text-[10px] text-[#FF3864]">Direct</span>
                      </li>
                    ))}
                    {Array.from(impactSets.indirect).map((p) => (
                      <li key={p} className="flex items-center justify-between rounded bg-[#FFB020]/10 px-2.5 py-1.5">
                        <span className="truncate text-[#F1F5F9]">{p}</span>
                        <span className="text-[10px] text-[#FFB020]">Indirect</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={() => navigate('/workbench')}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-[#00F5FF] px-4 py-2 text-xs font-semibold text-[#070B14] hover:bg-[#33f7ff]"
              >
                <Code2 className="h-3.5 w-3.5" />
                Inspect File in Workbench
              </button>
            </>
          ) : (
            <p className="text-xs text-[#94A3B8]">Click any node in the graph to inspect its exports and blast radius.</p>
          )}
        </div>
      </div>
    </div>
  );
}
