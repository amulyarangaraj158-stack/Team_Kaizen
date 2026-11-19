import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BookOpen, BrainCircuit, Cpu, Languages, Loader2, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { cn, EmptyState, SeverityIndicator } from '../components/ui/Primitives';

interface PatternData {
  byCategory: Array<{ category: string; count: number }>;
  repeatedTitles: Array<{ title: string; category: string; severity: string; occurrences: number }>;
  hotFiles: Array<{ filePath: string; projectName: string; bugCount: number; severeCount: number }>;
  timeline: Array<{ date: string; detected: number; resolved: number }>;
  commonCauses: Array<{ rootCause: string; category: string; count: number }>;
}

interface LessonItem {
  id: string;
  project_name: string;
  file_path: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  root_cause: string;
  code_snippet: string;
  original_code: string | null;
  proposed_code: string | null;
  fix_explanation: string | null;
  prevention_tip: string;
  relatedConcepts: string[];
  resolved_at: string | null;
}

interface LanguageCap {
  language: string;
  extensions: string[];
  configuredTools: string[];
  unconfiguredTools: string[];
  supportLevel: string;
}

export function BugIntelligencePage() {
  const { activeProjectId, pushToast } = useAppStore();
  const [tab, setTab] = useState<'patterns' | 'learning' | 'languages'>('patterns');
  const [scopeAll, setScopeAll] = useState(true);
  const [patterns, setPatterns] = useState<PatternData | null>(null);
  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [languages, setLanguages] = useState<LanguageCap[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);

  const [lessonSearch, setLessonSearch] = useState('');
  const [lessonCategory, setLessonCategory] = useState('all');

  useEffect(() => {
    const query = !scopeAll && activeProjectId ? `?projectId=${encodeURIComponent(activeProjectId)}` : '';
    apiFetch<PatternData>(`/api/intelligence/patterns${query}`)
      .then(setPatterns)
      .catch(() => setPatterns(null));

    apiFetch<{ languages: LanguageCap[] }>('/api/capabilities/languages')
      .then((res) => setLanguages(res.languages))
      .catch(() => setLanguages([]));
  }, [activeProjectId, scopeAll]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (!scopeAll && activeProjectId) params.set('projectId', activeProjectId);
    if (lessonCategory !== 'all') params.set('category', lessonCategory);
    if (lessonSearch.trim()) params.set('q', lessonSearch.trim());
    apiFetch<{ lessons: LessonItem[] }>(`/api/intelligence/learning?${params.toString()}`)
      .then((res) => setLessons(res.lessons))
      .catch(() => setLessons([]));
  }, [activeProjectId, scopeAll, lessonCategory, lessonSearch]);

  const handleGenerateRecs = async () => {
    setLoadingRecs(true);
    try {
      const res = await apiFetch<{ recommendations: string[] }>('/api/intelligence/recommendations', {
        method: 'POST',
      });
      setRecommendations(res.recommendations);
    } catch (err: unknown) {
      pushToast({
        tone: 'error',
        title: 'AI Recommendations Unavailable',
        message: err instanceof Error ? err.message : 'Unable to generate recommendations.',
      });
    } finally {
      setLoadingRecs(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Bug Intelligence & Learning Centre</h1>
          <p className="mt-1 text-sm text-[#94A3B8]">
            Historical pattern telemetry, resolved bug knowledge modules, and transparent 14-language analyzer coverage.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-[#00F5FF]/20 bg-[#0B1220] p-1">
            <button
              type="button"
              onClick={() => setTab('patterns')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold',
                tab === 'patterns' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              )}
            >
              <BrainCircuit className="h-3.5 w-3.5" />
              Pattern Intelligence
            </button>
            <button
              type="button"
              onClick={() => setTab('learning')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold',
                tab === 'learning' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              )}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Learn From Your Bugs
            </button>
            <button
              type="button"
              onClick={() => setTab('languages')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold',
                tab === 'languages' ? 'bg-[#142238] text-[#00F5FF]' : 'text-[#94A3B8] hover:text-[#F1F5F9]'
              )}
            >
              <Languages className="h-3.5 w-3.5" />
              14 Languages
            </button>
          </div>

          {tab !== 'languages' && (
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[#94A3B8]">
              <input
                type="checkbox"
                checked={scopeAll}
                onChange={(e) => setScopeAll(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#00F5FF]"
              />
              All projects
            </label>
          )}
        </div>
      </div>

      {/* TAB 1: FEATURE 4 — BUG PATTERN INTELLIGENCE */}
      {tab === 'patterns' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Most Frequent Bug Categories */}
            <section className="cyber-panel rounded-lg p-5">
              <h2 className="text-sm font-semibold text-[#F1F5F9]">Most Frequent Bug Categories</h2>
              <div className="mt-4 h-64">
                {patterns?.byCategory.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={patterns.byCategory} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(0,245,255,0.08)" strokeDasharray="3 3" />
                      <XAxis dataKey="category" stroke="#94A3B8" fontSize={11} />
                      <YAxis stroke="#94A3B8" fontSize={11} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#101A2B',
                          borderColor: 'rgba(0,245,255,0.25)',
                          color: '#F1F5F9',
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" fill="#00F5FF" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[#94A3B8]">
                    No historical bug category data yet.
                  </div>
                )}
              </div>
            </section>

            {/* Bug Frequency Over Time */}
            <section className="cyber-panel rounded-lg p-5">
              <h2 className="text-sm font-semibold text-[#F1F5F9]">Bug Detection vs Resolution Over Time</h2>
              <div className="mt-4 h-64">
                {patterns?.timeline.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={patterns.timeline} margin={{ top: 8, right: 12, left: -16, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(0,245,255,0.08)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} />
                      <YAxis stroke="#94A3B8" fontSize={11} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#101A2B',
                          borderColor: 'rgba(0,245,255,0.25)',
                          color: '#F1F5F9',
                          fontSize: 12,
                        }}
                      />
                      <Line type="monotone" dataKey="detected" name="Detected" stroke="#FF3864" strokeWidth={2} />
                      <Line type="monotone" dataKey="resolved" name="Resolved" stroke="#39FF88" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[#94A3B8]">
                    No timeline records yet.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Frequently Affected Files */}
            <section className="cyber-panel rounded-lg p-5">
              <h2 className="text-sm font-semibold text-[#F1F5F9]">Frequently Affected Files</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#00F5FF]/15 text-[#94A3B8]">
                      <th className="py-2 pr-3 font-medium">File Path</th>
                      <th className="py-2 pr-3 font-medium">Project</th>
                      <th className="py-2 pr-3 text-right font-medium">Bugs</th>
                      <th className="py-2 text-right font-medium">High/Crit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#00F5FF]/10">
                    {patterns?.hotFiles.map((hf) => (
                      <tr key={`${hf.projectName}-${hf.filePath}`}>
                        <td className="py-2.5 pr-3 font-mono text-[#00F5FF]">{hf.filePath}</td>
                        <td className="py-2.5 pr-3 text-[#94A3B8]">{hf.projectName}</td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[#F1F5F9]">{hf.bugCount}</td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#FF3864]">{hf.severeCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Repeated Errors & Common Root Causes */}
            <section className="cyber-panel rounded-lg p-5">
              <h2 className="text-sm font-semibold text-[#F1F5F9]">Repeated Error Patterns & Root Causes</h2>
              <div className="mt-3 space-y-2.5">
                {patterns?.repeatedTitles.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 rounded-md border border-[#00F5FF]/10 bg-[#0B1220] px-3 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#F1F5F9]">{item.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[#94A3B8]">
                        <SeverityIndicator severity={item.severity} />
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{item.category}</span>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-[#00F5FF]">
                      {item.occurrences}x
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* AI Prevention Recommendations */}
          <section className="cyber-panel rounded-lg p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#F1F5F9]">AI-Generated Prevention Recommendations</h2>
                <p className="text-xs text-[#94A3B8]">
                  Synthesized by Gemini directly from your workspace's actual SQL bug history.
                </p>
              </div>
              <button
                type="button"
                disabled={loadingRecs}
                onClick={handleGenerateRecs}
                className="inline-flex items-center gap-2 rounded-md border border-[#A855F7]/40 bg-[#A855F7]/15 px-4 py-2 text-xs font-semibold text-[#F1F5F9] hover:bg-[#A855F7]/25 disabled:opacity-50"
              >
                {loadingRecs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5 text-[#A855F7]" />}
                Generate Prevention Plan
              </button>
            </div>
            {recommendations.length > 0 && (
              <ul className="mt-4 space-y-2">
                {recommendations.map((rec, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-[#A855F7]/20 bg-[#0B1220] px-4 py-3 text-xs leading-relaxed text-[#F1F5F9]"
                  >
                    <span className="mr-2 font-mono font-bold text-[#A855F7]">{String(i + 1).padStart(2, '0')}.</span>
                    {rec}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* TAB 2: FEATURE 5 — LEARN FROM YOUR BUGS */}
      {tab === 'learning' && (
        <div className="space-y-5">
          <div className="cyber-panel flex flex-wrap items-center gap-3 rounded-lg p-4">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
              <input
                type="search"
                value={lessonSearch}
                onChange={(e) => setLessonSearch(e.target.value)}
                placeholder="Search resolved bugs, root causes, prevention techniques..."
                aria-label="Search learning centre"
                className="w-full rounded-md border border-[#00F5FF]/20 bg-[#070B14] py-2 pl-9 pr-3 text-xs text-[#F1F5F9] placeholder-[#94A3B8] focus:border-[#00F5FF] focus:outline-none"
              />
            </div>
            <select
              aria-label="Filter lessons by category"
              value={lessonCategory}
              onChange={(e) => setLessonCategory(e.target.value)}
              className="rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3 py-2 text-xs text-[#F1F5F9]"
            >
              <option value="all">All Categories</option>
              <option value="sql_injection">SQL Injection</option>
              <option value="security">Security</option>
              <option value="logic_bug">Logic Bug</option>
              <option value="error_handling">Error Handling</option>
              <option value="syntax">Syntax</option>
            </select>
          </div>

          {lessons.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-5 w-5" />}
              title="No resolved bug lessons match your filter"
              description="Approve and apply patches in the Code Workbench to automatically convert resolved issues into reusable engineering lessons."
            />
          ) : (
            <div className="space-y-4">
              {lessons.map((lesson) => (
                <article key={lesson.id} className="cyber-panel rounded-lg p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                        <SeverityIndicator severity={lesson.severity} />
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[#00F5FF]">{lesson.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{lesson.file_path}</span>
                        <span aria-hidden="true">·</span>
                        <span>{lesson.project_name}</span>
                      </div>
                      <h3 className="mt-1.5 text-base font-semibold text-[#F1F5F9]">{lesson.title}</h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-md border border-[#FF3864]/20 bg-[#070B14] p-3.5">
                      <div className="text-xs font-semibold text-[#FF3864]">Incorrect Code (Before)</div>
                      <pre className="mt-2 overflow-x-auto font-mono text-xs text-[#F1F5F9]">
                        {lesson.original_code || lesson.code_snippet}
                      </pre>
                    </div>
                    <div className="rounded-md border border-[#39FF88]/25 bg-[#070B14] p-3.5">
                      <div className="text-xs font-semibold text-[#39FF88]">Corrected Code (After)</div>
                      <pre className="mt-2 overflow-x-auto font-mono text-xs text-[#F1F5F9]">
                        {lesson.proposed_code || 'Manually resolved in workbench'}
                      </pre>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-3">
                    <div className="rounded-md bg-[#0B1220] p-3.5">
                      <div className="font-semibold text-[#F1F5F9]">Root Cause</div>
                      <p className="mt-1 leading-relaxed text-[#94A3B8]">{lesson.root_cause || lesson.description}</p>
                    </div>
                    <div className="rounded-md bg-[#0B1220] p-3.5">
                      <div className="font-semibold text-[#F1F5F9]">Why the Fix Works</div>
                      <p className="mt-1 leading-relaxed text-[#94A3B8]">
                        {lesson.fix_explanation || 'Remediated defect and verified against project constraints.'}
                      </p>
                    </div>
                    <div className="rounded-md bg-[#0B1220] p-3.5">
                      <div className="font-semibold text-[#39FF88]">Prevention Technique</div>
                      <p className="mt-1 leading-relaxed text-[#94A3B8]">
                        {lesson.prevention_tip || 'Enforce static analysis and unit test assertions for this failure mode.'}
                      </p>
                    </div>
                  </div>

                  {lesson.relatedConcepts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                      <span className="font-medium text-[#F1F5F9]">Related concepts:</span>
                      {lesson.relatedConcepts.map((c, idx) => (
                        <React.Fragment key={c}>
                          {idx > 0 && <span aria-hidden="true">·</span>}
                          <span className="font-mono text-[#00F5FF]">{c}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: FEATURE 8 — MULTI-LANGUAGE INTELLIGENCE MATRIX */}
      {tab === 'languages' && (
        <section className="cyber-panel rounded-lg p-5">
          <h2 className="text-base font-semibold text-[#F1F5F9]">Multi-Language Analysis Capability Matrix</h2>
          <p className="mt-1 text-xs text-[#94A3B8]">
            Transparent disclosure of configured parsers, compilers, and sandbox runners versus optional unconfigured external tools across all 14 supported languages.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#00F5FF]/15 text-[#94A3B8]">
                  <th className="py-2.5 pr-4 font-medium">Language</th>
                  <th className="py-2.5 pr-4 font-medium">Extensions</th>
                  <th className="py-2.5 pr-4 font-medium">Support Level</th>
                  <th className="py-2.5 pr-4 font-medium">Configured & Active Tools</th>
                  <th className="py-2.5 font-medium">Not Configured in Container</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#00F5FF]/10">
                {languages.map((lang) => (
                  <tr key={lang.language} className="hover:bg-[#142238]/40">
                    <td className="py-3 pr-4 font-mono font-semibold text-[#00F5FF]">{lang.language}</td>
                    <td className="py-3 pr-4 font-mono text-[#94A3B8]">{lang.extensions.join(', ')}</td>
                    <td className="py-3 pr-4 font-mono text-[#39FF88]">{lang.supportLevel.replace(/_/g, ' ')}</td>
                    <td className="py-3 pr-4 text-[#F1F5F9]">{lang.configuredTools.join(' · ')}</td>
                    <td className="py-3 text-[#94A3B8]">
                      {lang.unconfiguredTools.length > 0 ? lang.unconfiguredTools.join(' · ') : 'None'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
