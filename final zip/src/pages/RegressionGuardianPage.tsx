import React, { useEffect, useState } from 'react';
import { Check, Cpu, Loader2, Play, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { apiFetch, DetectedBug, SuggestedFix, TestResultRecord } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { cn, EmptyState, RiskText } from '../components/ui/Primitives';

export function RegressionGuardianPage() {
  const { activeProjectId, projects, fetchProjects, pushToast } = useAppStore();
  const [bugs, setBugs] = useState<DetectedBug[]>([]);
  const [history, setHistory] = useState<TestResultRecord[]>([]);
  const [runningFixId, setRunningFixId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadData = async () => {
    if (!activeProjectId) return;
    try {
      const [bRes, tRes] = await Promise.all([
        apiFetch<{ bugs: DetectedBug[] }>(`/api/projects/${activeProjectId}/bugs`),
        apiFetch<{ testResults: TestResultRecord[] }>(`/api/projects/${activeProjectId}/test-results`),
      ]);
      setBugs(bRes.bugs);
      setHistory(tRes.testResults);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadData();
  }, [activeProjectId]);

  const pendingFixes: Array<{ bug: DetectedBug; fix: SuggestedFix }> = [];
  for (const bug of bugs) {
    for (const fix of bug.fixes) {
      if (fix.status === 'pending') {
        pendingFixes.push({ bug, fix });
      }
    }
  }

  const runGuardian = async (fixId: string) => {
    setRunningFixId(fixId);
    try {
      await apiFetch(`/api/fixes/${fixId}/regression-test`, { method: 'POST', body: JSON.stringify({}) });
      await loadData();
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Regression run failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setRunningFixId(null);
    }
  };

  const handleAccept = async (fixId: string) => {
    setBusyAction(fixId);
    try {
      await apiFetch(`/api/fixes/${fixId}/apply`, { method: 'POST', body: JSON.stringify({}) });
      await Promise.all([loadData(), fetchProjects()]);
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Apply failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleReject = async (fixId: string) => {
    setBusyAction(fixId);
    try {
      await apiFetch(`/api/fixes/${fixId}/reject`, { method: 'POST' });
      await loadData();
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Reject failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRequestAnother = async (bugId: string) => {
    setBusyAction(bugId);
    try {
      await apiFetch(`/api/bugs/${bugId}/suggest-fix`, { method: 'POST' });
      await loadData();
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Suggestion failed', message: err instanceof Error ? err.message : 'Error' });
    } finally {
      setBusyAction(null);
    }
  };

  if (!activeProjectId || projects.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-5 w-5" />}
        title="No active project"
        description="Select a project to run isolated baseline vs patched regression verification."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Regression Guardian</h1>
        <p className="mt-1 text-sm text-[#94A3B8]">
          Executes baseline unit tests, applies candidate patches inside an isolated temporary working copy, re-runs tests, and flags any newly introduced failures before you approve changes.
        </p>
      </div>

      {/* Pending Candidate Patches */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-[#F1F5F9]">Candidate Patches Awaiting Verification</h2>
        {pendingFixes.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="No pending patches in queue"
            description="Generate an AI fix in the Code Workbench or run a scan to queue candidate patches for sandbox testing."
          />
        ) : (
          pendingFixes.map(({ bug, fix }) => {
            const latest = history.find((h) => h.fix_id === fix.id);
            const baseline = latest?.baselineComparison?.baseline;
            const patched = latest?.baselineComparison?.patched;
            const regDetected = latest?.baselineComparison?.regressionDetected;

            return (
              <div key={fix.id} className="cyber-panel rounded-lg p-5 space-y-4">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                      <span className="font-mono text-[#00F5FF]">{bug.file_path}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">Confidence {fix.confidence_score}%</span>
                      <span aria-hidden="true">·</span>
                      <RiskText level={fix.risk_category} />
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-[#F1F5F9]">{bug.title}</h3>
                    <p className="mt-1 text-xs text-[#94A3B8]">{fix.explanation}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={runningFixId === fix.id}
                      onClick={() => runGuardian(fix.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#39FF88]/40 bg-[#39FF88]/10 px-3.5 py-2 text-xs font-semibold text-[#39FF88] hover:bg-[#39FF88]/20 disabled:opacity-50"
                    >
                      {runningFixId === fix.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Run Isolated Regression Check
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === fix.id}
                      onClick={() => handleAccept(fix.id)}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#00F5FF] px-3.5 py-2 text-xs font-semibold text-[#070B14] hover:bg-[#33f7ff] disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Accept Patch
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === fix.id}
                      onClick={() => handleReject(fix.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#FF3864]/40 bg-[#FF3864]/10 px-3 py-2 text-xs font-semibold text-[#FF3864] hover:bg-[#FF3864]/20"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                    <button
                      type="button"
                      disabled={busyAction === bug.id}
                      onClick={() => handleRequestAnother(bug.id)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#A855F7]/40 bg-[#A855F7]/10 px-3 py-2 text-xs font-semibold text-[#F1F5F9] hover:bg-[#A855F7]/20"
                    >
                      <Cpu className="h-3.5 w-3.5 text-[#A855F7]" />
                      New Suggestion
                    </button>
                  </div>
                </div>

                {latest && (
                  <div className="space-y-3 border-t border-[#00F5FF]/15 pt-4">
                    <div
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-3.5 py-2.5 text-xs font-medium',
                        regDetected
                          ? 'border-[#FF3864]/40 bg-[#FF3864]/10 text-[#FF3864]'
                          : 'border-[#39FF88]/30 bg-[#39FF88]/10 text-[#39FF88]'
                      )}
                    >
                      {regDetected ? <ShieldAlert className="h-4 w-4 shrink-0" /> : <ShieldCheck className="h-4 w-4 shrink-0" />}
                      <span>{latest.baselineComparison?.summary || `Sandbox test run status: ${latest.status}`}</span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="rounded-md border border-[#00F5FF]/12 bg-[#0B1220] p-3.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#F1F5F9]">Before Patch (Baseline)</span>
                          <span className="font-mono tabular-nums text-[#94A3B8]">
                            {baseline ? `${baseline.passedTests}/${baseline.totalTests} passed (${baseline.runner})` : 'N/A'}
                          </span>
                        </div>
                        <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-[#94A3B8]">
                          {baseline?.outputLog || 'No baseline log captured.'}
                        </pre>
                      </div>
                      <div className="rounded-md border border-[#00F5FF]/12 bg-[#0B1220] p-3.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#F1F5F9]">After Patch (Isolated Working Copy)</span>
                          <span className="font-mono tabular-nums text-[#39FF88]">
                            {patched ? `${patched.passedTests}/${patched.totalTests} passed (${patched.runner})` : `${latest.passed_tests}/${latest.total_tests} passed`}
                          </span>
                        </div>
                        <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-[#F1F5F9]">
                          {patched?.outputLog || latest.output_log}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Historical Sandbox Executions */}
      <section className="cyber-panel rounded-lg p-5">
        <h2 className="text-base font-semibold text-[#F1F5F9]">Sandbox Execution History</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#00F5FF]/15 text-[#94A3B8]">
                <th className="py-2 pr-4 font-medium">Timestamp</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Target</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 text-right font-medium">Passed / Total</th>
                <th className="py-2 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#00F5FF]/10">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-[#94A3B8]">
                    No sandbox runs logged for this project yet.
                  </td>
                </tr>
              ) : (
                history.map((tr) => (
                  <tr key={tr.id}>
                    <td className="py-2.5 pr-4 font-mono tabular-nums text-[#94A3B8] whitespace-nowrap">
                      {new Date(tr.created_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-[#00F5FF]">{tr.run_type}</td>
                    <td className="py-2.5 pr-4 text-[#F1F5F9]">{tr.bug_title || tr.file_path || 'Project baseline'}</td>
                    <td
                      className={cn(
                        'py-2.5 pr-4 font-mono font-semibold',
                        tr.status === 'passed'
                          ? 'text-[#39FF88]'
                          : tr.status === 'failed'
                            ? 'text-[#FF3864]'
                            : 'text-[#94A3B8]'
                      )}
                    >
                      {tr.status}
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-[#F1F5F9]">
                      {tr.passed_tests}/{tr.total_tests}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-[#94A3B8]">{tr.duration_ms}ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
