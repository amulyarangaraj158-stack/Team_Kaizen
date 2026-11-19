import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Code2,
  Cpu,
  FileCode2,
  Info,
  Languages,
  Play,
  RefreshCw,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type {
  LanguageBreakdownItem,
  LanguageCapability,
  LanguageDiagnostic,
  ProjectSummary,
  WorkspaceModule,
} from '../../types';
import { EmptyState, LoadingPanel } from '../ui/ToastAndConfirm';

interface MultiLanguageModuleProps {
  project: ProjectSummary | null;
  onJumpToCode: (fileId: string, line: number) => void;
  onNavigate: (module: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'info' | 'warning', title: string, desc?: string) => void;
  onRefreshWorkspace: () => Promise<void>;
  refreshTrigger: number;
}

interface DiagnosticsReport {
  filesAnalyzed: number;
  languagesChecked: string[];
  diagnostics: LanguageDiagnostic[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

export const MultiLanguageModule: React.FC<MultiLanguageModuleProps> = ({
  project,
  onJumpToCode,
  onNavigate,
  onNotify,
  onRefreshWorkspace,
  refreshTrigger,
}) => {
  const [capabilities, setCapabilities] = useState<LanguageCapability[]>([]);
  const [breakdown, setBreakdown] = useState<LanguageBreakdownItem[]>([]);
  const [selectedLang, setSelectedLang] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<DiagnosticsReport | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (project) {
        const res = await apiRequest<{
          breakdown: LanguageBreakdownItem[];
          capabilities: LanguageCapability[];
        }>(`/api/projects/${project.id}/languages`);
        setBreakdown(res.breakdown);
        setCapabilities(res.capabilities);
      } else {
        const res = await apiRequest<{ capabilities: LanguageCapability[] }>('/api/languages/capabilities');
        setCapabilities(res.capabilities);
        setBreakdown([]);
      }
    } catch (err: unknown) {
      onNotify('error', 'Failed to load language metadata', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [project?.id, onNotify]);

  useEffect(() => {
    void loadData();
    setReport(null);
  }, [loadData, refreshTrigger]);

  const handleRunDiagnostics = async (languageFilter?: string) => {
    if (!project) return;
    setAnalyzing(true);
    try {
      const langParam = languageFilter && languageFilter !== 'all' ? languageFilter : undefined;
      const res = await apiRequest<DiagnosticsReport>(`/api/projects/${project.id}/languages/analyze`, {
        method: 'POST',
        body: JSON.stringify({ language: langParam }),
      });
      setReport(res);
      await onRefreshWorkspace();
      onNotify(
        res.summary.errors > 0 ? 'warning' : 'success',
        'Multi-Language Diagnostics Completed',
        `Analyzed ${res.filesAnalyzed} file(s): ${res.summary.errors} error(s), ${res.summary.warnings} warning(s), ${res.summary.infos} info note(s).`
      );
    } catch (err: unknown) {
      onNotify('error', 'Diagnostics failed', err instanceof Error ? err.message : undefined);
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return <LoadingPanel message="Loading multi-language intelligence matrix..." />;
  }

  const activeCapability =
    selectedLang !== 'all' ? capabilities.find((c) => c.id === selectedLang) || null : null;

  const filteredDiagnostics = report
    ? selectedLang === 'all'
      ? report.diagnostics
      : report.diagnostics.filter((d) => d.language === selectedLang)
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight flex items-center gap-2.5">
            <Languages className="w-5 h-5 text-cyan-400" />
            Multi-Language Intelligence
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Syntax verification, static defect analysis, Gemini AI bug detection, and honest execution-tier reporting
            across 14 supported programming and web languages.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={selectedLang}
            onChange={(e) => setSelectedLang(e.target.value)}
            className="px-3 py-2 text-xs bg-[#0C1324] border border-[#1E2B48] rounded-md text-slate-200 focus:border-cyan-500/50 focus:outline-none"
          >
            <option value="all">All 14 Languages</option>
            {capabilities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.extensions.join(', ')})
              </option>
            ))}
          </select>

          {project && (
            <button
              onClick={() => void handleRunDiagnostics(selectedLang)}
              disabled={analyzing}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-md transition-colors"
            >
              {analyzing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {analyzing ? 'Analyzing...' : 'Run Language Diagnostics'}
            </button>
          )}
        </div>
      </div>

      {/* Active Project Language Breakdown */}
      {project ? (
        <div className="bg-[#0C1324] border border-[#19243E] rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-white">
                Detected Languages in {project.name}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {breakdown.length} active language(s) across {project.total_files} file(s) and{' '}
                {project.total_lines.toLocaleString()} lines of code.
              </p>
            </div>
            <button
              onClick={() => onNavigate('scanner')}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
            >
              Open AI Bug Scanner →
            </button>
          </div>

          {breakdown.length === 0 ? (
            <div className="text-xs text-slate-500 py-4">No source files indexed in this project yet.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {breakdown.map((item) => {
                const isSelected = selectedLang === item.language;
                return (
                  <div
                    key={item.language}
                    onClick={() => setSelectedLang(isSelected ? 'all' : item.language)}
                    className={`p-3.5 rounded-lg border cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#121D36] border-cyan-500/45'
                        : 'bg-[#090F1E] border-[#19243E] hover:border-[#283960]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white">
                        {item.capability?.name || item.language}
                      </span>
                      <span className="text-xs font-mono text-cyan-400 tabular-nums">
                        {item.fileCount} file{item.fileCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                      <span>{item.totalLines.toLocaleString()} lines</span>
                      <span className={item.openBugs > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                        {item.bugCount} bug{item.bugCount === 1 ? '' : 's'} ({item.openBugs} open)
                      </span>
                    </div>
                    {item.capability && (
                      <div className="mt-2.5 pt-2 border-t border-[#19243E] text-[11px] text-slate-500 truncate">
                        Engine: {item.capability.syntaxEngine}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<Code2 className="w-5 h-5" />}
          title="No project selected"
          description="Select or upload a project to view its language breakdown and run live compiler/static diagnostics."
          actionLabel="Go to Projects & Upload"
          onAction={() => onNavigate('projects')}
        />
      )}

      {/* Selected Language Detail Inspector */}
      {activeCapability && (
        <div className="bg-[#0C1324] border border-cyan-500/30 rounded-lg p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {activeCapability.name} Analysis Profile
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Extensions: {activeCapability.extensions.join('  ')}
              </p>
            </div>
            <span className="text-xs font-mono text-cyan-300">
              {activeCapability.syntaxCheck === 'compiler_parser'
                ? 'Real Compiler / Parser Syntax Check'
                : 'Structural Syntax + Static Rule Engine'}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-3">{activeCapability.executionNotes}</p>
          <div className="text-[11px] text-slate-400">
            <span className="text-slate-500 uppercase tracking-wider font-semibold mr-2">
              Target Defect Classes:
            </span>
            {activeCapability.commonDefectClasses.join(' · ')}
          </div>
        </div>
      )}

      {/* Live Diagnostics Results */}
      {report && (
        <div className="bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#19243E] bg-[#090F1E] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Live Syntax & Static Diagnostic Results</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Checked {report.filesAnalyzed} file(s) across {report.languagesChecked.join(', ') || 'selected scope'}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs tabular-nums">
              <span className="text-red-400 font-medium">{report.summary.errors} Errors</span>
              <span className="text-amber-400 font-medium">{report.summary.warnings} Warnings</span>
              <span className="text-cyan-400 font-medium">{report.summary.infos} Info</span>
            </div>
          </div>

          {filteredDiagnostics.length === 0 ? (
            <div className="p-6 text-center text-xs text-emerald-400 flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Zero syntax errors or static-rule warnings detected in the analyzed files.
            </div>
          ) : (
            <div className="divide-y divide-[#162038]">
              {filteredDiagnostics.map((d, idx) => (
                <div
                  key={`${d.fileId}-${d.line}-${d.code}-${idx}`}
                  className="px-5 py-3.5 hover:bg-[#0F182E] flex flex-wrap items-start justify-between gap-3 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {d.severity === 'error' ? (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    ) : d.severity === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono font-semibold text-white">{d.code}</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-400">{d.engine}</span>
                      </div>
                      <p className="text-xs text-slate-200 mt-1">{d.message}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => onJumpToCode(d.fileId, d.line)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono bg-[#090F1E] hover:bg-[#15223D] border border-[#1E2B48] rounded text-cyan-300 shrink-0"
                  >
                    <FileCode2 className="w-3 h-3" />
                    {d.filePath}:{d.line}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Honest 14-Language Capability Matrix */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#19243E] bg-[#090F1E] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-violet-400" />
              14-Language Engineering Capability Matrix
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Transparent separation between real syntax parsers, static security rules, Gemini AI analysis, and
              isolated runtime test execution.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#19243E] bg-[#080D1A] text-[11px] uppercase tracking-wider text-slate-400">
                <th className="py-2.5 px-4 font-semibold">Language</th>
                <th className="py-2.5 px-4 font-semibold">Extensions</th>
                <th className="py-2.5 px-4 font-semibold">Syntax Verification Engine</th>
                <th className="py-2.5 px-4 font-semibold">Static Rules</th>
                <th className="py-2.5 px-4 font-semibold">AI Scan & Repair</th>
                <th className="py-2.5 px-4 font-semibold">Test Execution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#162038]">
              {capabilities.map((cap) => (
                <tr
                  key={cap.id}
                  onClick={() => setSelectedLang(cap.id)}
                  className={`cursor-pointer transition-colors ${
                    selectedLang === cap.id ? 'bg-[#121D36]' : 'hover:bg-[#0F182E]'
                  }`}
                >
                  <td className="py-2.5 px-4 font-medium text-white">{cap.name}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-400">{cap.extensions.join(', ')}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className={
                        cap.syntaxCheck === 'compiler_parser' ? 'text-cyan-300' : 'text-slate-300'
                      }
                    >
                      {cap.syntaxEngine}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-emerald-400">Active</td>
                  <td className="py-2.5 px-4 text-emerald-400">Full Gemini AI</td>
                  <td className="py-2.5 px-4">
                    {cap.isolatedExecution ? (
                      <span className="text-cyan-300 font-medium">Isolated VM Sandbox</span>
                    ) : (
                      <span className="text-slate-400">Static Assertion Validation</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
