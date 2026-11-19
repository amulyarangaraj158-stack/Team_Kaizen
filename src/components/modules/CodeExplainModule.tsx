import React, { useState, useEffect, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';
import { SafeCodeEditor } from '../ui/SafeMonaco';
import { BookOpenText, Loader2, AlertTriangle, Cpu, Layers, FileCode2, Bot } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { toMonacoLanguage } from '../../lib/format';
import type { ChatCodeSnippet, CodeExplanation, ProjectSummary, UploadedFile, WorkspaceModule } from '../../types';
import { EmptyState } from '../ui/ToastAndConfirm';

interface CodeExplainModuleProps {
  project: ProjectSummary | null;
  files: UploadedFile[];
  jumpTarget: { fileId: string; line: number } | null;
  onClearJumpTarget: () => void;
  onAskAboutCode?: (snippet: ChatCodeSnippet) => void;
  onNavigate: (mod: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'warning' | 'info', title: string, desc?: string) => void;
}

export function CodeExplainModule({
  project,
  files,
  jumpTarget,
  onClearJumpTarget,
  onAskAboutCode,
  onNavigate,
  onNotify,
}: CodeExplainModuleProps) {
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<{ text: string; startLine: number; endLine: number } | null>(null);
  const [explanation, setExplanation] = useState<CodeExplanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const decorationsRef = useRef<string[]>([]);

  useEffect(() => {
    if (jumpTarget && files.some((f) => f.id === jumpTarget.fileId)) {
      setActiveFileId(jumpTarget.fileId);
    } else if (!activeFileId || !files.some((f) => f.id === activeFileId)) {
      setActiveFileId(files[0]?.id || null);
      setExplanation(null);
    }
  }, [files, activeFileId, jumpTarget]);

  useEffect(() => {
    if (jumpTarget && editorRef.current && monacoRef.current && activeFileId === jumpTarget.fileId) {
      const ed = editorRef.current;
      const monaco = monacoRef.current;
      ed.revealLineInCenter(jumpTarget.line);
      ed.setPosition({ lineNumber: jumpTarget.line, column: 1 });
      decorationsRef.current = ed.deltaDecorations(decorationsRef.current, [
        {
          range: new monaco.Range(jumpTarget.line, 1, jumpTarget.line, 1),
          options: {
            isWholeLine: true,
            className: 'autopatch-bug-line',
            glyphMarginClassName: 'autopatch-glyph-bug',
          },
        },
      ]);
      onClearJumpTarget();
    }
  }, [jumpTarget, activeFileId, onClearJumpTarget]);

  const activeFile = files.find((f) => f.id === activeFileId) || null;

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model || sel.isEmpty()) {
        setSelectionInfo(null);
        return;
      }
      const text = model.getValueInRange(sel);
      if (text.trim().length > 0) {
        setSelectionInfo({
          text,
          startLine: sel.startLineNumber,
          endLine: sel.endLineNumber,
        });
      } else {
        setSelectionInfo(null);
      }
    });

    if (jumpTarget && activeFile?.id === jumpTarget.fileId) {
      editor.revealLineInCenter(jumpTarget.line);
      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, [
        {
          range: new monaco.Range(jumpTarget.line, 1, jumpTarget.line, 1),
          options: { isWholeLine: true, className: 'autopatch-bug-line' },
        },
      ]);
      onClearJumpTarget();
    }
  };

  const highlightLines = (startLine: number, endLine: number) => {
    if (!editorRef.current || !monacoRef.current) return;
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    ed.revealLineInCenter(startLine);
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, [
      {
        range: new monaco.Range(startLine, 1, Math.max(startLine, endLine), 1),
        options: { isWholeLine: true, className: 'autopatch-risk-line' },
      },
    ]);
  };

  const runExplain = async (useSelection: boolean) => {
    if (!project || !activeFile) return;
    setExplaining(true);
    setError(null);
    try {
      const data = await apiRequest<{ explanation: CodeExplanation }>(`/api/projects/${project.id}/explain`, {
        method: 'POST',
        body: JSON.stringify({
          fileId: activeFile.id,
          selectedCode: useSelection && selectionInfo ? selectionInfo.text : undefined,
          startLine: useSelection && selectionInfo ? selectionInfo.startLine : 1,
          endLine: useSelection && selectionInfo ? selectionInfo.endLine : activeFile.line_count,
        }),
      });
      setExplanation(data.explanation);
      if (data.explanation.riskySections?.length && editorRef.current && monacoRef.current) {
        const monaco = monacoRef.current;
        decorationsRef.current = editorRef.current.deltaDecorations(
          decorationsRef.current,
          data.explanation.riskySections.map((r) => ({
            range: new monaco.Range(r.lineStart, 1, Math.max(r.lineStart, r.lineEnd), 1),
            options: { isWholeLine: true, className: 'autopatch-risk-line' },
          }))
        );
      }
      onNotify('success', 'Code explanation ready', `Analyzed ${activeFile.file_path} with Gemini AI.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Explanation failed.';
      setError(msg);
      onNotify('error', 'AI Explain failed', msg);
    } finally {
      setExplaining(false);
    }
  };

  if (!project || files.length === 0) {
    return (
      <EmptyState
        title="Select or upload a project to explain code"
        description="Code & Explain loads your repository into Monaco Editor and uses Gemini AI to explain logic, risks, and complexity."
        actionLabel="Go to Projects & Upload"
        onAction={() => onNavigate('projects')}
        icon={<BookOpenText className="w-5 h-5" />}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white font-display tracking-tight">Code & Explain</h1>
          <p className="text-xs text-slate-400 mt-1">
            Highlight any line or function in Monaco Editor to get beginner-friendly execution traces, risky section alerts, and complexity analysis.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeFile?.id || ''}
            onChange={(e) => {
              setActiveFileId(e.target.value);
              setSelectionInfo(null);
              setExplanation(null);
            }}
            className="px-3 py-2 text-xs font-mono bg-[#0C1324] border border-[#1E2B4A] rounded-lg text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.file_path} ({f.language})
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={explaining || !selectionInfo}
            onClick={() => runExplain(true)}
            className="px-3.5 py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            {explaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookOpenText className="w-3.5 h-3.5" />}
            {selectionInfo
              ? `Explain Lines ${selectionInfo.startLine}-${selectionInfo.endLine}`
              : 'Select Lines to Explain'}
          </button>

          <button
            type="button"
            disabled={explaining}
            onClick={() => runExplain(false)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
          >
            {explaining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileCode2 className="w-3.5 h-3.5" />}
            Explain Full File
          </button>

          {onAskAboutCode && activeFile && (
            <button
              type="button"
              onClick={() => {
                if (selectionInfo) {
                  onAskAboutCode({
                    fileId: activeFile.id,
                    filePath: activeFile.file_path,
                    lineStart: selectionInfo.startLine,
                    lineEnd: selectionInfo.endLine,
                    code: selectionInfo.text,
                  });
                } else {
                  onAskAboutCode({
                    fileId: activeFile.id,
                    filePath: activeFile.file_path,
                    lineStart: 1,
                    lineEnd: Math.min(activeFile.line_count, 60),
                    code: activeFile.current_content.split('\n').slice(0, 60).join('\n'),
                  });
                }
              }}
              className="px-3.5 py-2 text-xs font-medium text-cyan-200 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/35 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
            >
              <Bot className="w-3.5 h-3.5 text-cyan-400" />
              {selectionInfo ? 'Ask AutoPatch about Selection' : 'Ask AutoPatch'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Monaco Editor Pane */}
        <div className="xl:col-span-7 bg-[#0C1324] border border-[#19243E] rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 bg-[#090F1E] border-b border-[#162038] flex items-center justify-between text-xs">
            <span className="font-mono text-slate-200">{activeFile?.file_path}</span>
            <span className="text-slate-500 font-mono">
              {selectionInfo
                ? `Selected L${selectionInfo.startLine}–L${selectionInfo.endLine}`
                : `${activeFile?.line_count || 0} lines · Read-only inspector`}
            </span>
          </div>
          <div className="h-[580px]">
            {activeFile && (
              <SafeCodeEditor
                height="100%"
                theme="vs-dark"
                path={`${activeFile.id}/${activeFile.file_path}`}
                language={toMonacoLanguage(activeFile.language)}
                value={activeFile.current_content}
                onMount={handleEditorMount}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  glyphMargin: true,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            )}
          </div>
        </div>

        {/* AI Explanation Panel */}
        <div className="xl:col-span-5 bg-[#0C1324] border border-[#19243E] rounded-xl p-5 overflow-y-auto max-h-[626px] space-y-5">
          {error && (
            <div className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}

          {explaining ? (
            <div className="py-24 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <p className="text-sm">Gemini AI is tracing execution flow and complexity...</p>
            </div>
          ) : !explanation ? (
            <div className="py-16 text-center space-y-3">
              <BookOpenText className="w-8 h-8 text-blue-400 mx-auto" />
              <h3 className="text-sm font-semibold text-white font-display">Ready to Explain Code</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Select a specific block of lines in the editor or click <strong className="text-slate-200">Explain Full File</strong> to generate a beginner-friendly walkthrough, risky code flags, and Big-O complexity analysis.
              </p>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-xs font-mono text-blue-400 mb-1.5">Code Summary</h2>
                <p className="text-sm text-slate-100 leading-relaxed">{explanation.summary}</p>
              </div>

              <div className="pt-4 border-t border-[#162038]">
                <h3 className="text-xs font-mono text-violet-400 mb-1.5">Beginner-Friendly Walkthrough</h3>
                <p className="text-xs text-slate-300 leading-relaxed">{explanation.beginnerExplanation}</p>
              </div>

              {/* Complexity */}
              <div className="pt-4 border-t border-[#162038]">
                <h3 className="text-xs font-mono text-slate-400 mb-2.5 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  Complexity Analysis
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[#080D19] border border-[#17223B] rounded-lg p-3">
                    <p className="text-[11px] text-slate-500">Time Complexity</p>
                    <p className="text-sm font-mono font-semibold text-blue-300 mt-0.5">{explanation.complexity.time}</p>
                  </div>
                  <div className="bg-[#080D19] border border-[#17223B] rounded-lg p-3">
                    <p className="text-[11px] text-slate-500">Space Complexity</p>
                    <p className="text-sm font-mono font-semibold text-violet-300 mt-0.5">{explanation.complexity.space}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{explanation.complexity.notes}</p>
              </div>

              {/* Risky Sections */}
              {explanation.riskySections?.length > 0 && (
                <div className="pt-4 border-t border-[#162038]">
                  <h3 className="text-xs font-mono text-amber-400 mb-2.5 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Highlighted Risky Sections ({explanation.riskySections.length})
                  </h3>
                  <div className="space-y-2">
                    {explanation.riskySections.map((risk, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => highlightLines(risk.lineStart, risk.lineEnd)}
                        className="w-full text-left bg-[#080D19] hover:bg-[#10192E] border border-[#1E2B4A] rounded-lg p-3 transition-colors"
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                          <span className="text-amber-400">
                            Lines {risk.lineStart}–{risk.lineEnd}
                          </span>
                          <span className="text-slate-400 capitalize">{risk.severity}</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{risk.reason}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step-by-Step Execution */}
              {explanation.stepByStep?.length > 0 && (
                <div className="pt-4 border-t border-[#162038]">
                  <h3 className="text-xs font-mono text-slate-400 mb-2.5">Step-by-Step Execution</h3>
                  <ol className="space-y-2.5">
                    {explanation.stepByStep.map((s) => (
                      <li key={s.step} className="bg-[#080D19] border border-[#17223B] rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-100">
                            {s.step}. {s.title}
                          </span>
                          <span className="font-mono text-[11px] text-blue-400 shrink-0">{s.lines}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">{s.detail}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Constructs */}
              {explanation.constructs?.length > 0 && (
                <div className="pt-4 border-t border-[#162038]">
                  <h3 className="text-xs font-mono text-slate-400 mb-2.5 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-violet-400" />
                    Functions, Variables & Logic Constructs
                  </h3>
                  <div className="divide-y divide-[#151F38] text-xs">
                    {explanation.constructs.map((c, idx) => (
                      <div key={idx} className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-blue-300">{c.name}</span>
                          <span className="text-slate-500">·</span>
                          <span className="text-slate-400">{c.kind}</span>
                        </div>
                        <p className="text-slate-300 mt-0.5 leading-relaxed">{c.role}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
