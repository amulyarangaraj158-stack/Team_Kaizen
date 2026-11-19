import React, { useEffect, useState, useCallback } from 'react';
import { GraduationCap, Sparkles, Loader2, CheckCircle2, BookOpen } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import type { LearningInsight, WorkspaceModule } from '../../types';
import { EmptyState, LoadingPanel } from '../ui/ToastAndConfirm';

interface LearningResponse {
  insights: LearningInsight[];
  categoryBreakdown: Array<{ category: string; encountered: number; resolved: number }>;
}

interface LearningInsightsModuleProps {
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
  refreshTrigger: number;
}

export function LearningInsightsModule({
  onNavigate,
  onNotify,
  refreshTrigger,
}: LearningInsightsModuleProps) {
  const [data, setData] = useState<LearningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingAI, setRefreshingAI] = useState(false);

  const loadLearning = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest<LearningResponse>('/api/learning');
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLearning();
  }, [loadLearning, refreshTrigger]);

  const handleRefreshAI = async () => {
    setRefreshingAI(true);
    try {
      const res = await apiRequest<{ insights: LearningInsight[] }>('/api/learning/refresh', { method: 'POST' });
      setData((prev) => ({
        insights: res.insights,
        categoryBreakdown: prev?.categoryBreakdown || [],
      }));
      onNotify('success', 'Personalized Insights Updated', 'Gemini synthesized lessons from your actual scan history.');
    } catch (err: unknown) {
      onNotify('error', 'Failed to refresh insights', err instanceof Error ? err.message : 'Unable to generate insights.');
    } finally {
      setRefreshingAI(false);
    }
  };

  const updateStatus = async (id: string, status: LearningInsight['status']) => {
    try {
      await apiRequest(`/api/learning/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              insights: prev.insights.map((ins) => (ins.id === id ? { ...ins, status } : ins)),
            }
          : prev
      );
      onNotify('info', 'Learning progress saved', `Marked concept as ${status}.`);
    } catch (err: unknown) {
      onNotify('error', 'Update failed', err instanceof Error ? err.message : 'Could not update status.');
    }
  };

  if (loading && !data) return <LoadingPanel message="Loading developer learning progress..." />;
  if (!data) return null;

  const totalInsights = data.insights.length;
  const masteredCount = data.insights.filter((i) => i.status === 'mastered').length;
  const practicingCount = data.insights.filter((i) => i.status === 'practicing').length;
  const masteryPct = totalInsights > 0 ? Math.round((masteredCount / totalInsights) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Learn & Growth</h1>
          <p className="text-xs text-slate-400 mt-1">
            Personalized coding concepts and mistake-prevention guidance derived strictly from your real scan history.
          </p>
        </div>

        <button
          type="button"
          disabled={refreshingAI}
          onClick={handleRefreshAI}
          className="px-4 py-2 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
        >
          {refreshingAI ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {refreshingAI ? 'Analyzing Scan History...' : 'Refresh Personalized Insights with AI'}
        </button>
      </div>

      {/* Progress Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Tracked Concepts</p>
          <p className="text-2xl font-mono font-bold text-white tabular-nums mt-1">{totalInsights}</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Currently Practicing</p>
          <p className="text-2xl font-mono font-bold text-blue-400 tabular-nums mt-1">{practicingCount}</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Mastered Concepts</p>
          <p className="text-2xl font-mono font-bold text-emerald-400 tabular-nums mt-1">{masteredCount}</p>
        </div>
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl px-4 py-3.5">
          <p className="text-xs text-slate-400">Mastery Progress</p>
          <p className="text-2xl font-mono font-bold text-violet-400 tabular-nums mt-1">{masteryPct}%</p>
          <div className="w-full h-1.5 bg-[#151F38] rounded-full overflow-hidden mt-2">
            <div className="h-full bg-violet-500 transition-all" style={{ width: `${masteryPct}%` }} />
          </div>
        </div>
      </div>

      {/* Category Resolution Progress */}
      {data.categoryBreakdown.length > 0 && (
        <div className="bg-[#0C1324] border border-[#19243E] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white font-display mb-3">
            Encountered Mistakes vs. Verified Resolutions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.categoryBreakdown.map((cat) => {
              const pct = cat.encountered > 0 ? Math.round((cat.resolved / cat.encountered) * 100) : 0;
              return (
                <div key={cat.category} className="bg-[#080D19] border border-[#162038] rounded-lg p-3.5">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-medium text-slate-200">{cat.category}</span>
                    <span className="font-mono text-slate-400 tabular-nums">
                      {cat.resolved}/{cat.encountered} resolved
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[#141E34] rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Personalized Learning Concept Cards */}
      {data.insights.length === 0 ? (
        <EmptyState
          title="No personalized learning insights yet"
          description="Run an AI scan on a project, then click Refresh Personalized Insights with AI to generate tailored engineering lessons."
          actionLabel="Open Scanner & RCA"
          onAction={() => onNavigate('scanner')}
          icon={<GraduationCap className="w-5 h-5" />}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {data.insights.map((ins) => (
            <div key={ins.id} className="bg-[#0C1324] border border-[#19243E] rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-blue-400">
                      <span>{ins.mistake_category}</span>
                      <span className="text-slate-600">·</span>
                      <span className="tabular-nums">Seen {ins.frequency_count}x</span>
                    </div>
                    <h3 className="text-base font-bold text-white font-display mt-1">{ins.concept_title}</h3>
                  </div>
                  {ins.status === 'mastered' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <p className="font-mono text-[11px] text-amber-400 mb-0.5">Why This Mistake Happens</p>
                    <p className="text-slate-300 leading-relaxed">{ins.why_it_happens}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[11px] text-slate-400 mb-0.5 flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />
                      Beginner-Friendly Explanation
                    </p>
                    <p className="text-slate-300 leading-relaxed">{ins.explanation}</p>
                  </div>
                  <div className="bg-[#080F1E] border border-[#172542] rounded-lg p-3">
                    <p className="font-mono text-[11px] text-emerald-400 mb-0.5">Recommended Next Practice</p>
                    <p className="text-slate-200 leading-relaxed">{ins.recommendation}</p>
                  </div>
                </div>
              </div>

              {/* Status Toggle */}
              <div className="pt-3 border-t border-[#162038] flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">Skill Status</span>
                <div className="flex items-center gap-1 p-0.5 bg-[#080D19] border border-[#18233C] rounded-lg">
                  {(['active', 'practicing', 'mastered'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => updateStatus(ins.id, st)}
                      className={`px-2.5 py-1 text-[11px] rounded capitalize transition-colors ${
                        ins.status === st
                          ? st === 'mastered'
                            ? 'bg-emerald-600 text-white font-medium'
                            : 'bg-[#1A2848] text-white font-medium'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
