import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  ShieldCheck,
  ArrowRight,
  Code2,
  GitCompare,
  FlaskConical,
  Radar,
  Lock,
  History,
  CheckCircle2,
  AlertTriangle,
  Cpu,
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: (mode?: 'login' | 'register') => void;
}

const PREVIEW_STAGES = [
  {
    id: 'detect',
    label: '01. Defect Detected',
    file: 'src/pricing.js',
    line: 5,
    severity: 'High · Runtime Error',
    summary: 'Off-by-one loop condition i <= items.length dereferences undefined item.price at end of array.',
    codeBefore: [
      'export function calculateSubtotal(items) {',
      '  let subtotal = 0;',
      '  for (let i = 0; i <= items.length; i++) {',
      '    const item = items[i];',
      '    subtotal += item.price * item.quantity;',
      '  }',
      '  return subtotal;',
      '}',
    ],
    codeAfter: [
      'export function calculateSubtotal(items) {',
      '  if (!Array.isArray(items)) return 0;',
      '  let subtotal = 0;',
      '  for (let i = 0; i < items.length; i++) {',
      '    const item = items[i];',
      '    subtotal += item.price * item.quantity;',
      '  }',
      '  return subtotal;',
      '}',
    ],
    highlightBefore: 2,
    highlightAfter: [1, 3],
    testSummary: 'Before fix: 2/6 passed (TypeError)  ->  After fix: 6/6 passed in isolated sandbox',
  },
  {
    id: 'security',
    label: '02. Security Patch',
    file: 'src/coupons.js',
    line: 14,
    severity: 'Critical · Security Vulnerability',
    summary: 'Direct eval() invocation allows arbitrary code execution from promotional rule expressions.',
    codeBefore: [
      'export function parseCustomRule(expression) {',
      '  // Unsafe dynamic evaluation',
      '  return eval(expression);',
      '}',
    ],
    codeAfter: [
      'const ALLOWED_RULES = { HOLIDAY: 0.15, BUNDLE: 0.2 };',
      'export function parseCustomRule(expression) {',
      '  const key = String(expression || "").trim().toUpperCase();',
      '  return ALLOWED_RULES[key] ?? 0;',
      '}',
    ],
    highlightBefore: 2,
    highlightAfter: [0, 2, 3],
    testSummary: 'Injection payload blocked  ·  6/6 isolated validation assertions verified',
  },
];

export function LandingPage({ onGetStarted }: LandingPageProps) {
  const [stageIdx, setStageIdx] = useState(0);
  const [showRepaired, setShowRepaired] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setShowRepaired((prev) => {
        if (prev) {
          setStageIdx((s) => (s + 1) % PREVIEW_STAGES.length);
          return false;
        }
        return true;
      });
    }, 3600);
    return () => clearInterval(timer);
  }, []);

  const currentStage = PREVIEW_STAGES[stageIdx];

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100">
      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="sticky top-0 z-40 bg-[#070B14]/90 backdrop-blur-md border-b border-[#172036]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-white font-display whitespace-nowrap shrink-0 flex items-center gap-2.5"
          >
            <span className="w-7 h-7 rounded-md bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xs font-mono font-bold text-white">
              AP
            </span>
            AutoPatch AI
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
            <button
              type="button"
              onClick={() => scrollToSection('capabilities')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('workflow')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Workflow
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('safety')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Safety
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('stack')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Architecture
            </button>
          </nav>

          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => onGetStarted('login')}
              className="text-sm font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 hidden sm:inline-block"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onGetStarted('register')}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="top" className="relative overflow-hidden border-b border-[#151E33]">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 70% 10%, rgba(59,130,246,0.14), transparent 65%), radial-gradient(ellipse 50% 45% at 20% 80%, rgba(124,58,237,0.10), transparent 65%)',
          }}
        />
        <div className="max-w-7xl mx-auto px-6 py-20 lg:py-28 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium tracking-wider text-blue-400 font-mono mb-4">
                Detect · Understand · Repair · Verify
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-bold tracking-tight text-white leading-[1.08] font-display max-w-xl">
                Find Bugs. Understand Code. Fix with Confidence.
              </h1>
              <p className="text-base text-slate-400 mt-6 leading-relaxed max-w-xl">
                AutoPatch AI is an integrated debugging and safe code-repair platform. Upload source files or full ZIP
                repositories, run Gemini AI root cause analysis, review side-by-side diffs without altering your
                original baseline, and validate patches in an isolated test environment.
              </p>

              <div className="flex flex-wrap items-center gap-4 mt-8">
                <button
                  type="button"
                  onClick={() => onGetStarted('login')}
                  className="px-6 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
                >
                  Get Started
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToSection('capabilities')}
                  className="px-5 py-3 text-sm font-medium text-slate-200 bg-[#10182C] hover:bg-[#172340] border border-[#1E2B4A] rounded-lg transition-colors whitespace-nowrap"
                >
                  Explore Features
                </button>
              </div>

              <div className="mt-10 pt-6 border-t border-[#151F38] flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
                <span>Immutable Baseline Storage</span>
                <span aria-hidden="true">·</span>
                <span>Isolated Sandbox Execution</span>
                <span aria-hidden="true">·</span>
                <span>Auditable Patch Rollbacks</span>
              </div>
            </div>

            {/* Interactive Animated Code Editor & Bug Repair Preview */}
            <div className="lg:col-span-6 flex flex-col">
              <div className="bg-[#0B1222] border border-[#1E2B4A] rounded-xl overflow-hidden flex-1 flex flex-col shadow-2xl">
                {/* Editor Top Bar */}
                <div className="px-4 py-3 bg-[#0E172B] border-b border-[#1A2642] flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-slate-200 truncate">{currentStage.file}</span>
                    <span className="text-xs text-slate-500 font-mono">Line {currentStage.line}</span>
                  </div>
                  <div className="flex items-center gap-1 bg-[#070B14] p-0.5 rounded-md border border-[#1A2642]">
                    <button
                      type="button"
                      onClick={() => setShowRepaired(false)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        !showRepaired ? 'bg-[#1A2642] text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Original
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRepaired(true)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                        showRepaired ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      AI Patch
                    </button>
                  </div>
                </div>

                {/* Defect / Verification Context Bar */}
                <div className="px-4 py-2.5 bg-[#0A101E] border-b border-[#162038] flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {showRepaired ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span className={showRepaired ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                      {showRepaired ? 'Minimal Safe Patch Generated' : currentStage.severity}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {PREVIEW_STAGES.map((st, idx) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setStageIdx(idx);
                          setShowRepaired(false);
                        }}
                        className={`text-xs transition-colors ${
                          idx === stageIdx ? 'text-blue-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        Case {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Animated Code Body */}
                <motion.div
                  key={`${stageIdx}-${showRepaired}`}
                  initial={{ opacity: 0.4, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22 }}
                  className="p-4 font-mono text-xs leading-6 overflow-x-auto flex-1 bg-[#080E1B]"
                >
                  {(showRepaired ? currentStage.codeAfter : currentStage.codeBefore).map((line, i) => {
                    const isRemoved = !showRepaired && i === currentStage.highlightBefore;
                    const isAdded = showRepaired && currentStage.highlightAfter.includes(i);
                    return (
                      <div
                        key={i}
                        className={`flex items-start px-2 rounded ${
                          isRemoved
                            ? 'bg-red-500/15 text-red-200'
                            : isAdded
                              ? 'bg-emerald-500/15 text-emerald-200'
                              : 'text-slate-300'
                        }`}
                      >
                        <span className="w-7 text-slate-600 select-none tabular-nums shrink-0">{i + 1}</span>
                        <span className="w-4 select-none shrink-0 text-center">
                          {isRemoved ? '-' : isAdded ? '+' : ' '}
                        </span>
                        <span className="whitespace-pre">{line}</span>
                      </div>
                    );
                  })}
                </motion.div>

                {/* RCA & Validation Footer */}
                <div className="px-4 py-3 bg-[#0C1426] border-t border-[#1A2642] space-y-1.5">
                  <p className="text-xs text-slate-300 leading-relaxed">{currentStage.summary}</p>
                  <p className="text-[11px] font-mono text-blue-300 tabular-nums">{currentStage.testSummary}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities Asymmetric Grid */}
      <section id="capabilities" className="max-w-7xl mx-auto px-6 py-20 border-b border-[#151E33]">
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-mono text-blue-400 mb-2">Core Capabilities</p>
          <h2 className="text-3xl font-bold text-white font-display tracking-tight">
            One connected engineering workspace from discovery to verified patch
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          <div className="md:col-span-7 bg-[#0C1324] border border-[#1B2742] rounded-xl p-7">
            <Code2 className="w-5 h-5 text-blue-400 mb-4" />
            <h3 className="text-lg font-semibold text-white font-display">
              AI Bug Scanner & 12-Point Root Cause Analysis
            </h3>
            <p className="text-sm text-slate-400 mt-2.5 leading-relaxed">
              Detects syntax errors, runtime crashes, edge-case failures, security vulnerabilities, and maintainability
              issues with exact line citations, impact scoring, root cause explanation, and smart prioritization. Jump
              straight from any bug report to the exact offending line in Monaco Editor.
            </p>
          </div>

          <div className="md:col-span-5 bg-[#0C1324] border border-[#1B2742] rounded-xl p-7">
            <GitCompare className="w-5 h-5 text-violet-400 mb-4" />
            <h3 className="text-lg font-semibold text-white font-display">Minimal Diff Repair</h3>
            <p className="text-sm text-slate-400 mt-2.5 leading-relaxed">
              Generates targeted surgical fixes with side-by-side Monaco Diff comparison, repair risk notes, and
              explicit developer approval before touching active code.
            </p>
          </div>

          <div className="md:col-span-5 bg-[#0C1324] border border-[#1B2742] rounded-xl p-7">
            <FlaskConical className="w-5 h-5 text-emerald-400 mb-4" />
            <h3 className="text-lg font-semibold text-white font-display">Test Guardian Validation</h3>
            <p className="text-sm text-slate-400 mt-2.5 leading-relaxed">
              Generates normal, invalid, and boundary regression tests. Runs before-and-after validation in an isolated
              execution sandbox and flags regressions automatically.
            </p>
          </div>

          <div className="md:col-span-7 bg-[#0C1324] border border-[#1B2742] rounded-xl p-7">
            <Radar className="w-5 h-5 text-blue-400 mb-4" />
            <h3 className="text-lg font-semibold text-white font-display">
              Code Impact Radar, Pattern Intelligence & Developer Growth
            </h3>
            <p className="text-sm text-slate-400 mt-2.5 leading-relaxed">
              Visualizes verified file import dependencies and cascading defect impact, tracks recurring bug categories
              across projects, turns real defect history into personalized learning concepts, and exports complete PDF
              audit reports.
            </p>
          </div>
        </div>
      </section>

      {/* Five-Stage Workflow */}
      <section id="workflow" className="max-w-7xl mx-auto px-6 py-20 border-b border-[#151E33]">
        <div className="max-w-2xl mb-12">
          <p className="text-xs font-mono text-violet-400 mb-2">Five-Stage Workflow</p>
          <h2 className="text-3xl font-bold text-white font-display tracking-tight">
            Structured remediation without blind auto-commits
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              num: '01',
              title: 'Upload',
              body: 'Drop source files or full ZIP archives. Paths are sanitized, validated, and indexed as an immutable baseline.',
            },
            {
              num: '02',
              title: 'Scan',
              body: 'Gemini AI analyzes each file with exact line numbers, categorizing defects and prioritizing by severity and impact.',
            },
            {
              num: '03',
              title: 'Explain',
              body: 'Select any function or block in Monaco Editor for beginner-friendly execution traces, risk highlights, and complexity.',
            },
            {
              num: '04',
              title: 'Repair',
              body: 'Inspect minimal AI patches side-by-side in Monaco Diff Editor with risk disclosure before accepting or rejecting.',
            },
            {
              num: '05',
              title: 'Test',
              body: 'Run before-and-after regression suites in an isolated sandbox. Defects mark Verified only after approval and passing checks.',
            },
          ].map((step) => (
            <div key={step.num} className="bg-[#0B1222] border border-[#19243E] rounded-xl p-5 flex flex-col">
              <span className="text-xs font-mono text-blue-400 tabular-nums mb-3">{step.num}.</span>
              <h3 className="text-base font-semibold text-white font-display">{step.title}</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Engineering Safety */}
      <section id="safety" className="max-w-7xl mx-auto px-6 py-20 border-b border-[#151E33]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-5">
            <p className="text-xs font-mono text-emerald-400 mb-2">Engineering Safety</p>
            <h2 className="text-3xl font-bold text-white font-display tracking-tight">
              Built for defensive engineering teams
            </h2>
            <p className="text-sm text-slate-400 mt-4 leading-relaxed">
              Autonomous repair tools earn trust through strict guardrails. AutoPatch AI never silently overwrites source
              baselines, never executes untrusted code on the host server, and never marks an unverified patch as fixed.
            </p>
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                icon: Lock,
                title: 'Safe Repair Mode',
                text: 'Original uploaded source remains immutable in the database. Working files only change on explicit user approval.',
              },
              {
                icon: ShieldCheck,
                title: 'Isolated Sandbox Execution',
                text: 'JS/TS tests run in a stripped-environment child process VM with strict timeouts. Unsupported languages run honest static validation.',
              },
              {
                icon: History,
                title: 'Auditable Rollbacks',
                text: 'Every patch acceptance, rejection, and rollback logs developer identity, timestamp, and full before/after snapshots.',
              },
              {
                icon: Cpu,
                title: 'Server-Side AI & Strict Scoping',
                text: 'All Gemini API calls execute strictly server-side with scrypt password hashing and user-isolated project records.',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="bg-[#0C1324] border border-[#1A2642] rounded-xl p-5">
                  <Icon className="w-4 h-4 text-blue-400 mb-3" />
                  <h3 className="text-sm font-semibold text-white font-display">{item.title}</h3>
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{item.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Technology Stack */}
      <section id="stack" className="max-w-7xl mx-auto px-6 py-20 border-b border-[#151E33]">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <p className="text-xs font-mono text-blue-400 mb-2">Technology Stack</p>
            <h2 className="text-2xl font-bold text-white font-display tracking-tight">
              Production full-stack architecture
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onGetStarted('login')}
            className="px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap self-start md:self-auto"
          >
            Launch Workspace
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { name: 'React 19 + TS', detail: 'Modular SPA UI' },
            { name: 'Monaco Editor', detail: 'Code & Side-by-Side Diff' },
            { name: 'Google Gemini', detail: 'Structured JSON Analysis' },
            { name: 'Express + Node 22', detail: 'Authenticated REST API' },
            { name: 'node:sqlite', detail: 'Normalized + MySQL DDL' },
            { name: 'JSZip + jsPDF', detail: 'Archive & PDF Audit Reports' },
          ].map((tech) => (
            <div key={tech.name} className="bg-[#0B1120] border border-[#18233C] rounded-lg px-4 py-3.5">
              <p className="text-sm font-semibold text-slate-100">{tech.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{tech.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 text-xs text-slate-500">
        <div>
          <span className="text-sm font-bold text-slate-200 font-display">AutoPatch AI</span>
          <p className="mt-1">Autonomous Software Bug Detection, Root Cause Analysis, Code Repair & Validation.</p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <button type="button" onClick={() => scrollToSection('capabilities')} className="hover:text-slate-300">
            Capabilities
          </button>
          <button type="button" onClick={() => scrollToSection('workflow')} className="hover:text-slate-300">
            Workflow
          </button>
          <button type="button" onClick={() => scrollToSection('safety')} className="hover:text-slate-300">
            Safety
          </button>
          <a href="mailto:engineering@autopatch.dev" className="hover:text-slate-300">
            engineering@autopatch.dev
          </a>
        </div>
      </footer>
    </div>
  );
}
