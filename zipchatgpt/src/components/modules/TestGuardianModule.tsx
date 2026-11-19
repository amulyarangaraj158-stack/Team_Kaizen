import React, { useState, useEffect, useCallback } from 'react';
import {
  FlaskConical,
  Loader2,
  Play,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatTimestamp, statusLabel } from '../../lib/format';
import type {
  DetectedBug,
  GeneratedTestCase,
  ProjectSummary,
  TestResultRecord,
  WorkspaceModule,
} from '../../types';
import { EmptyState } from '../ui/ToastAndConfirm';

interface TestGuardianModuleProps {
  project: ProjectSummary | null;
  bugs: DetectedBug[];
  selectedBugId: string | null;
  onSelectBugId: (bugId: string | null) => void;
  onRefreshProjectData: () => Promise<void>;
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
}

export function TestGuardianModule({
  project,
  bugs,
  selectedBugId,
  onSelectBugId,
  onRefreshProjectData,
  onNavigate,
  onNotify,
}: TestGuardianModuleProps) {
  const [testCasesByBug, setTestCasesByBug] = useState<Record<string, GeneratedTestCase[]>>({});
  const [history, setHistory] = useState<TestResultRecord[]>([]);
  const [generating, setGenerating] = useState(false);
  const [runningPhase, setRunningPhase] = useState<'before' | 'after' | null>(null);

  const loadHistory = useCallback(async () => {
    if (!project) return;
    try {
      const res = await apiRequest<{ testResults: TestResultRecord[] }>(`/api/projects/${project.id}/tests`);
      setHistory(res.testResults);
    } catch {
      // ignore initial error
    }
  }, [project]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (bugs.length > 0 && (!selectedBugId || !bugs.some((b) => b.id === selectedBugId))) {
      onSelectBugId(bugs[0].id);
    }
  }, [bugs, selectedBugId, onSelectBugId]);

  const activeBug = bugs.find((b) => b.id === selectedBugId) || bugs[0] || null;
  const activeTestCases = activeBug ? testCasesByBug[activeBug.id] || [] : [];

  const bugRuns = activeBug ? history.filter((h) => h.bug_id === activeBug.id) : [];
  const latestBefore = bugRuns.find((r) => r.phase === 'before') || null;
  const latestAfter = bugRuns.find((r) => r.phase === 'after') || null;

  const handleGenerateTests = async () => {
    if (!activeBug) return;
    setGenerating(true);
    try {
      const data = await apiRequest<{ testCases: GeneratedTestCase[]; language: string }>(
        `/api/bugs/${activeBug.id}/generate-tests`,
        { method: 'POST' }
      );
      setTestCasesByBug((prev) => ({ ...prev, [activeBug.id]: data.testCases }));
      onNotify(
        'success',
        `Generated ${data.testCases.length} Regression Tests`,
        'Includes normal, invalid, and boundary input test cases.'
      );
    } catch (err: unknown) {
      onNotify('error', 'Test generation failed', err instanceof Error ? err.message : 'Gemini AI error.');
    } finally {
      setGenerating(false);
    }
  };

  const handleRunTests = async (phase: 'before' | 'after') => {
    if (!activeBug || activeTestCases.length === 0) return;
    setRunningPhase(phase);
    try {
      const data = await apiRequest<{ testResult: TestResultRecord; bugStatus: string }>(
        `/api/bugs/${activeBug.id}/run-tests`,
        {
          method: 'POST',
          body: JSON.stringify({
            phase,
            testCases: activeTestCases,
          }),
        }
      );
      await loadHistory();
      await onRefreshProjectData();
      const tr = data.testResult;
      onNotify(
        tr.failed_tests === 0 ? 'success' : 'warning',
        `${phase === 'before' ? 'Before-Fix' : 'After-Fix'} Run Completed`,
        tr.summary
      );
    } catch (err: unknown) {
      onNotify('error', 'Validation failed', err instanceof Error ? err.message : 'Execution error.');
    } finally {
      setRunningPhase(null);
    }
  };

  if (!project) {
    return (
      <EmptyState
        title="Select a project to run Test Guardian"
        description="Generate AI regression tests covering normal, invalid, and boundary inputs and validate fixes safely."
        actionLabel="Go to Projects & Upload"
        onAction={() => onNavigate('projects')}
        icon={<FlaskConical className="w-5 h-5" />}
      />
    );
  }

  if (bugs.length === 0) {
    return (
      <EmptyState
        title="No detected bugs available for testing"
        description="Scan a project in Scanner & RCA and generate a patch before validating with Test Guardian."
        actionLabel="Open Scanner & RCA"
        onAction={() => onNavigate('scanner')}
        icon={<FlaskConical className="w-5 h-5" />}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Test Guardian & Validation</h1>
          <p className="text-xs text-slate-400 mt-1">
            Isolated child-process VM sandbox for JavaScript/TypeScript; honest static invariant checks for unsupported host languages.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={generating || !activeBug}
            onClick={handleGenerateTests}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'Generating Suite...' : 'Generate AI Regression Tests'}
          </button>

          <button
            type="button"
            disabled={runningPhase !== null || activeTestCases.length === 0}
            onClick={() => handleRunTests('before')}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#121B31] hover:bg-[#1B2847] disabled:opacity-40 border border-[#1E2B4A] rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {runningPhase === 'before' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 text-amber-400" />}
            Run Before-Fix Tests
          </button>

          <button
            type="button"
            disabled={runningPhase !== null || activeTestCases.length === 0}
            onClick={() => handleRunTests('after')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            {runningPhase === 'after' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run After-Fix Tests
          </button>
        </div>
      </div>

      {/* Bug Selector */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="block text-[11px] font-mono text-slate-500 mb-1">Bug Under Validation</label>
          <select
            value={activeBug?.id || ''}
            onChange={(e) => onSelectBugId(e.target.value)}
            className="w-full px-3 py-2 text-xs bg-[#080D19] border border-[#1E2B4A] rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
          >
            {bugs.map((b) => (
              <option key={b.id} value={b.id}>
                [{b.severity.toUpperCase()}] {b.title} — {b.file_path} ({statusLabel(b.status).text})
              </option>
            ))}
          </select>
        </div>
        {activeBug && (
          <div className="text-xs font-mono text-right shrink-0">
            <p className="text-slate-500">Current Bug Status</p>
            <p className={`font-semibold mt-0.5 ${statusLabel(activeBug.status).className}`}>
              {statusLabel(activeBug.status).text}
            </p>
          </div>
        )}
      </div>

      {/* Before vs After Summary Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-white font-display">Before-Fix Baseline Run</h2>
            {latestBefore && (
              <span className="text-[11px] font-mono text-slate-400">
                {latestBefore.execution_mode === 'isolated_vm' ? 'Isolated Sandbox' : 'Static Validation'}
              </span>
            )}
          </div>
          {!latestBefore ? (
            <p className="text-xs text-slate-500 py-4">
              Generate tests and click <strong className="text-slate-300">Run Before-Fix Tests</strong> to verify the defect reproduces against the immutable baseline.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-6 font-mono text-xs tabular-nums">
                <span className="text-emerald-400">Passed: {latestBefore.passed_tests}</span>
                <span className="text-red-400">Failed: {latestBefore.failed_tests}</span>
                <span className="text-slate-400">Total: {latestBefore.total_tests}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{latestBefore.summary}</p>
              <p className="text-[11px] font-mono text-slate-500">{formatTimestamp(latestBefore.created_at)}</p>
            </div>
          )}
        </div>

        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-white font-display">After-Fix Validation Run</h2>
            {latestAfter && (
              <span className="text-[11px] font-mono text-blue-400">
                {latestAfter.execution_mode === 'isolated_vm' ? 'Isolated Sandbox' : 'Static Validation'}
              </span>
            )}
          </div>
          {!latestAfter ? (
            <p className="text-xs text-slate-500 py-4">
              Click <strong className="text-slate-300">Run After-Fix Tests</strong> to validate the repaired code and check for regressions.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-6 font-mono text-xs tabular-nums">
                <span className="text-emerald-400">Passed: {latestAfter.passed_tests}</span>
                <span className={latestAfter.failed_tests > 0 ? 'text-red-400' : 'text-slate-400'}>
                  Failed: {latestAfter.failed_tests}
                </span>
                <span className="text-slate-300 uppercase">{latestAfter.validation_status}</span>
              </div>
              {latestAfter.regression_detected && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Regression detected: a previously passing test failed after applying the fix.
                </div>
              )}
              <p className="text-xs text-slate-300 leading-relaxed">{latestAfter.summary}</p>
              {activeBug?.status === 'verified' ? (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Patch accepted and validation passed — Defect is now Verified.
                </p>
              ) : (
                latestAfter.failed_tests === 0 && (
                  <p className="text-xs text-amber-300">
                    Tests pass on the patch. Accept the patch in Repair & Diff (then re-run) to mark the defect Verified.
                  </p>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detailed Test Case Matrix */}
      <div className="bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#162038] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white font-display">
            Regression Test Cases ({latestAfter?.cases.length || latestBefore?.cases.length || activeTestCases.length})
          </h2>
          <span className="text-xs font-mono text-slate-500">
            Categories: Normal · Invalid · Boundary
          </span>
        </div>

        {activeTestCases.length === 0 && !latestBefore && !latestAfter ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Click <strong className="text-slate-200">Generate AI Regression Tests</strong> to create a targeted test suite for this bug.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#090F1E] text-slate-400 border-b border-[#162038]">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Test Case</th>
                  <th className="py-2.5 px-4 font-medium">Type</th>
                  <th className="py-2.5 px-4 font-medium">Input & Expected</th>
                  <th className="py-2.5 px-4 font-medium">Before Fix</th>
                  <th className="py-2.5 px-4 font-medium">After Fix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141E34]">
                {(latestAfter?.cases || latestBefore?.cases || activeTestCases).map((tc, idx) => {
                  const beforeCase = latestBefore?.cases.find((c) => c.id === tc.id) || latestBefore?.cases[idx];
                  const afterCase = latestAfter?.cases.find((c) => c.id === tc.id) || latestAfter?.cases[idx];
                  return (
                    <tr key={tc.id || idx} className="hover:bg-[#101930] align-top">
                      <td className="py-3 px-4 max-w-xs">
                        <p className="font-medium text-slate-100">{tc.name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{tc.description}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] capitalize text-blue-300 whitespace-nowrap">
                        {tc.category}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <p className="text-slate-300 font-mono text-[11px]">In: {tc.inputSummary}</p>
                        <p className="text-slate-400 text-[11px] mt-0.5">Exp: {tc.expectedSummary}</p>
                      </td>
                      <td className="py-3 px-4 max-w-[220px]">
                        {beforeCase ? (
                          <div>
                            <span className={`font-mono font-semibold flex items-center gap-1 ${beforeCase.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                              {beforeCase.passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                              {beforeCase.passed ? 'Passed' : 'Failed'}
                            </span>
                            <p className="text-[11px] text-slate-400 mt-1 break-words">{beforeCase.actual}</p>
                          </div>
                        ) : (
                          <span className="text-slate-600 font-mono">Not run</span>
                        )}
                      </td>
                      <td className="py-3 px-4 max-w-[220px]">
                        {afterCase ? (
                          <div>
                            <span className={`font-mono font-semibold flex items-center gap-1 ${afterCase.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                              {afterCase.passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                              {afterCase.passed ? 'Passed' : 'Failed'}
                            </span>
                            <p className="text-[11px] text-slate-400 mt-1 break-words">{afterCase.actual}</p>
                          </div>
                        ) : (
                          <span className="text-slate-600 font-mono">Not run</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
