import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  Bug,
  Check,
  Code2,
  Copy,
  FileCode2,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { formatTimestamp, severityTextClass } from '../../lib/format';
import type {
  AiConversation,
  AiMessage,
  ChatCodeSnippet,
  DetectedBug,
  ProjectSummary,
  UploadedFile,
  WorkspaceModule,
} from '../../types';
import { EmptyState } from '../ui/ToastAndConfirm';

interface AskAutoPatchModuleProps {
  project: ProjectSummary | null;
  files: UploadedFile[];
  bugs: DetectedBug[];
  pendingSnippet: ChatCodeSnippet | null;
  onClearPendingSnippet: () => void;
  onJumpToCode: (fileId: string, line: number) => void;
  onSelectBugForRepair: (bugId: string) => void;
  onNavigate: (module: WorkspaceModule) => void;
  onNotify: (type: 'success' | 'error' | 'info' | 'warning', title: string, desc?: string) => void;
}

const SUGGESTED_QUESTIONS: string[] = [
  'Why is my code failing?',
  'Explain this bug in simple language.',
  'What caused this error?',
  'How can I fix this problem?',
  'Is this suggested patch safe?',
  'Can you find similar bugs in my project?',
  'Explain the corrected code.',
  'Can this modification break another feature?',
  'Why did my test case fail?',
  'How can I improve this code?',
];

interface ParsedSegment {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

function parseMessageContent(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      language: match[1] || 'code',
      content: match[2].replace(/\n$/, ''),
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return segments;
}

export const AskAutoPatchModule: React.FC<AskAutoPatchModuleProps> = ({
  project,
  files,
  bugs,
  pendingSnippet,
  onClearPendingSnippet,
  onJumpToCode,
  onSelectBugForRepair,
  onNavigate,
  onNotify,
}) => {
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'beginner' | 'advanced'>('beginner');
  const [attachedSnippet, setAttachedSnippet] = useState<ChatCodeSnippet | null>(null);
  const [showSnippetPicker, setShowSnippetPicker] = useState(false);
  const [pickerFileId, setPickerFileId] = useState<string>('');
  const [pickerStartLine, setPickerStartLine] = useState<number>(1);
  const [pickerEndLine, setPickerEndLine] = useState<number>(25);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync incoming snippet from Code & Explain
  useEffect(() => {
    if (pendingSnippet) {
      setAttachedSnippet(pendingSnippet);
      onClearPendingSnippet();
    }
  }, [pendingSnippet, onClearPendingSnippet]);

  useEffect(() => {
    if (files.length > 0 && !pickerFileId) {
      setPickerFileId(files[0].id);
    }
  }, [files, pickerFileId]);

  const bugMap = useMemo(() => new Map(bugs.map((b) => [b.id, b])), [bugs]);
  const fileByPath = useMemo(() => new Map(files.map((f) => [f.file_path, f])), [files]);

  const loadConversations = async (projectId: string, preferId?: string | null) => {
    setLoadingConvos(true);
    try {
      const res = await apiRequest<{ conversations: AiConversation[] }>(`/api/projects/${projectId}/conversations`);
      setConversations(res.conversations);
      if (preferId && res.conversations.some((c) => c.id === preferId)) {
        setActiveConvoId(preferId);
      } else if (res.conversations.length > 0) {
        setActiveConvoId(res.conversations[0].id);
      } else {
        setActiveConvoId(null);
        setMessages([]);
      }
    } catch {
      setConversations([]);
      setActiveConvoId(null);
      setMessages([]);
    } finally {
      setLoadingConvos(false);
    }
  };

  useEffect(() => {
    if (!project) {
      setConversations([]);
      setActiveConvoId(null);
      setMessages([]);
      return;
    }
    void loadConversations(project.id);
  }, [project?.id]);

  useEffect(() => {
    if (!activeConvoId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    apiRequest<{ conversation: AiConversation; messages: AiMessage[] }>(
      `/api/conversations/${activeConvoId}/messages`
    )
      .then((res) => {
        setMessages(res.messages);
        if (res.conversation?.explanation_mode === 'advanced' || res.conversation?.explanation_mode === 'beginner') {
          setMode(res.conversation.explanation_mode);
        }
      })
      .catch(() => {
        setMessages([]);
      })
      .finally(() => setLoadingMessages(false));
  }, [activeConvoId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const createNewConversation = async (): Promise<string | null> => {
    if (!project) return null;
    try {
      const res = await apiRequest<{ conversation: AiConversation }>(`/api/projects/${project.id}/conversations`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Debugging Session · ${project.name}`,
          explanationMode: mode,
        }),
      });
      setConversations((prev) => [res.conversation, ...prev]);
      setActiveConvoId(res.conversation.id);
      setMessages([]);
      return res.conversation.id;
    } catch (err: unknown) {
      onNotify('error', 'Failed to create conversation', err instanceof Error ? err.message : undefined);
      return null;
    }
  };

  const handleDeleteConversation = async (convoId: string) => {
    if (!project) return;
    try {
      await apiRequest(`/api/conversations/${convoId}`, { method: 'DELETE' });
      const remaining = conversations.filter((c) => c.id !== convoId);
      setConversations(remaining);
      if (activeConvoId === convoId) {
        setActiveConvoId(remaining[0]?.id || null);
      }
      onNotify('info', 'Conversation cleared', 'Debugging thread removed from history.');
    } catch (err: unknown) {
      onNotify('error', 'Clear failed', err instanceof Error ? err.message : undefined);
    }
  };

  const handleSend = async (promptText?: string) => {
    if (!project || sending) return;
    const text = (promptText ?? input).trim();
    if (!text) return;

    setSending(true);
    if (!promptText) setInput('');

    let targetConvoId = activeConvoId;
    if (!targetConvoId) {
      targetConvoId = await createNewConversation();
      if (!targetConvoId) {
        setSending(false);
        return;
      }
    }

    const snippetToSend = attachedSnippet;
    const optimisticUserMsg: AiMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: targetConvoId,
      role: 'user',
      content: text,
      code_context: snippetToSend,
      referenced_bug_ids: [],
      referenced_files: [],
      follow_up_suggestions: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);

    try {
      const res = await apiRequest<{ userMessage: AiMessage; assistantMessage: AiMessage }>(
        `/api/conversations/${targetConvoId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: text,
            explanationMode: mode,
            selectedSnippet: snippetToSend,
          }),
        }
      );

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUserMsg.id),
        res.userMessage,
        res.assistantMessage,
      ]);
      setAttachedSnippet(null);
      await loadConversations(project.id, targetConvoId);
    } catch (err: unknown) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
      onNotify(
        'error',
        'Ask AutoPatch request failed',
        err instanceof Error ? err.message : 'Unable to reach Gemini AI.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleAttachSnippetFromPicker = () => {
    const f = files.find((item) => item.id === pickerFileId);
    if (!f) return;
    const lines = f.current_content.split('\n');
    const start = Math.max(1, Math.min(pickerStartLine, lines.length));
    const end = Math.max(start, Math.min(pickerEndLine, lines.length));
    const code = lines.slice(start - 1, end).join('\n');
    setAttachedSnippet({
      fileId: f.id,
      filePath: f.file_path,
      lineStart: start,
      lineEnd: end,
      code,
    });
    setShowSnippetPicker(false);
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId((curr) => (curr === key ? null : curr)), 1800);
    } catch {
      onNotify('warning', 'Copy unavailable', 'Clipboard access was blocked by the browser.');
    }
  };

  if (!project) {
    return (
      <EmptyState
        icon={<Bot className="w-5 h-5" />}
        title="Select a project to launch Ask AutoPatch"
        description="Ask AutoPatch analyzes your active project's actual source files, detected bugs, suggested patches, and test runs."
        actionLabel="Open Projects & Upload"
        onAction={() => onNavigate('projects')}
      />
    );
  }

  return (
    <div className="h-[calc(100vh-116px)] min-h-[600px] flex flex-col lg:flex-row gap-4">
      {/* Left Sidebar: Conversations & Project Context Summary */}
      <aside className="w-full lg:w-72 shrink-0 bg-[#0C1324] border border-[#19243E] rounded-lg flex flex-col overflow-hidden">
        <div className="p-3.5 border-b border-[#19243E] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Bot className="w-4 h-4 text-cyan-400" />
              Ask AutoPatch
            </h2>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">{project.name}</p>
          </div>
          <button
            onClick={() => void createNewConversation()}
            className="p-1.5 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors"
            title="New debugging conversation"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        </div>

        {/* Context Awareness Strip */}
        <div className="px-3.5 py-2.5 border-b border-[#19243E] bg-[#090F1E] grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs font-semibold text-white tabular-nums">{files.length}</div>
            <div className="text-[10px] text-slate-500">Files</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-amber-400 tabular-nums">{bugs.length}</div>
            <div className="text-[10px] text-slate-500">Bugs</div>
          </div>
          <div>
            <div className="text-xs font-semibold text-cyan-400 tabular-nums">{conversations.length}</div>
            <div className="text-[10px] text-slate-500">Threads</div>
          </div>
        </div>

        {/* Conversation History List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingConvos ? (
            <div className="p-4 text-xs text-slate-500">Loading threads...</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-xs text-slate-500 leading-relaxed">
              No saved conversations for this project yet. Pick a suggested question or type a question to start.
            </div>
          ) : (
            conversations.map((c) => {
              const active = c.id === activeConvoId;
              return (
                <div
                  key={c.id}
                  onClick={() => setActiveConvoId(c.id)}
                  className={`group px-2.5 py-2 rounded-md cursor-pointer border transition-colors ${
                    active
                      ? 'bg-[#121D36] border-cyan-500/30 text-white'
                      : 'border-transparent hover:bg-[#10192D] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium leading-snug line-clamp-2">{c.title}</p>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteConversation(c.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5 transition-opacity shrink-0"
                      title="Delete conversation"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                    <span className="capitalize">{c.explanation_mode}</span>
                    <span>{formatTimestamp(c.updated_at)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Safety Policy Footer */}
        <div className="p-3 border-t border-[#19243E] bg-[#090F1E] text-[11px] text-slate-400 flex items-start gap-2">
          <ShieldAlert className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
          <span>Read-only assistant: suggested code is never auto-applied. Approve edits in Repair & Diff.</span>
        </div>
      </aside>

      {/* Main Chat Panel */}
      <section className="flex-1 bg-[#0C1324] border border-[#19243E] rounded-lg flex flex-col overflow-hidden min-w-0">
        {/* Top Controls Bar */}
        <div className="px-4 py-3 border-b border-[#19243E] flex flex-wrap items-center justify-between gap-3 bg-[#090F1E]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white truncate">
                Project-Grounded AI Debugger
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Inspecting {files.length} file(s) & {bugs.length} detected defect(s) in {project.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Beginner / Advanced toggle */}
            <div className="flex items-center bg-[#070B14] border border-[#1E2B48] rounded-md p-0.5 text-xs">
              <button
                onClick={() => setMode('beginner')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  mode === 'beginner' ? 'bg-cyan-600/25 text-cyan-300 font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Beginner
              </button>
              <button
                onClick={() => setMode('advanced')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  mode === 'advanced' ? 'bg-violet-600/25 text-violet-300 font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Advanced
              </button>
            </div>

            <button
              onClick={() => setShowSnippetPicker((s) => !s)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#10192D] hover:bg-[#162340] border border-[#1E2B48] text-slate-200 rounded-md transition-colors"
            >
              <Code2 className="w-3.5 h-3.5 text-cyan-400" />
              Attach Code Section
            </button>

            {activeConvoId && (
              <button
                onClick={() => void handleDeleteConversation(activeConvoId)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-[#10192D] hover:bg-red-950/50 border border-[#1E2B48] hover:border-red-500/30 text-slate-400 hover:text-red-300 rounded-md transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Code Section Picker Drawer */}
        {showSnippetPicker && (
          <div className="px-4 py-3 border-b border-[#19243E] bg-[#0B1222] flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] text-slate-400 mb-1">Project File</label>
              <select
                value={pickerFileId}
                onChange={(e) => setPickerFileId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200"
              >
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.file_path} ({f.line_count} lines)
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="block text-[11px] text-slate-400 mb-1">Start Line</label>
              <input
                type="number"
                min={1}
                value={pickerStartLine}
                onChange={(e) => setPickerStartLine(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200 tabular-nums"
              />
            </div>
            <div className="w-24">
              <label className="block text-[11px] text-slate-400 mb-1">End Line</label>
              <input
                type="number"
                min={1}
                value={pickerEndLine}
                onChange={(e) => setPickerEndLine(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-2.5 py-1.5 text-xs bg-[#070B14] border border-[#1E2B48] rounded-md text-slate-200 tabular-nums"
              />
            </div>
            <button
              onClick={handleAttachSnippetFromPicker}
              className="px-3 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md"
            >
              Attach Section
            </button>
            <button
              onClick={() => setShowSnippetPicker(false)}
              className="p-1.5 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {loadingMessages ? (
            <div className="text-xs text-slate-400 py-8 text-center">Loading conversation history...</div>
          ) : messages.length === 0 ? (
            <div className="max-w-3xl mx-auto py-4 space-y-5">
              <div className="bg-[#090F1E] border border-[#19243E] rounded-lg p-5">
                <div className="flex items-center gap-2.5 mb-2">
                  <Bot className="w-5 h-5 text-cyan-400" />
                  <h4 className="text-sm font-semibold text-white">
                    Ask anything about {project.name}
                  </h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  I have full context on your {files.length} indexed source file(s), {bugs.length} detected bug(s),
                  suggested patches, and test guardian validation results. Select a question below or attach a code
                  section to begin.
                </p>
              </div>

              {/* 10 Suggested Questions */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
                  Suggested Debugging Questions
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => void handleSend(q)}
                      disabled={sending}
                      className="text-left px-3 py-2.5 text-xs text-slate-200 bg-[#090F1E] hover:bg-[#121D36] border border-[#19243E] hover:border-cyan-500/40 rounded-md transition-colors disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Contextual Bug Prompts */}
              {bugs.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Active Bugs in This Project
                  </div>
                  <div className="space-y-1.5">
                    {bugs.slice(0, 4).map((b) => (
                      <button
                        key={b.id}
                        onClick={() =>
                          void handleSend(
                            `Explain the root cause of "${b.title}" in ${b.file_path} (lines ${b.line_start}-${b.line_end}) and how to fix it safely.`
                          )
                        }
                        className="w-full text-left px-3 py-2 bg-[#090F1E] hover:bg-[#121D36] border border-[#19243E] rounded-md flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Bug className={`w-3.5 h-3.5 shrink-0 ${severityTextClass(b.severity)}`} />
                          <span className="text-xs text-slate-200 truncate">{b.title}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-500 shrink-0">
                          {b.file_path}:{b.line_start}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              const segments = parseMessageContent(msg.content);
              return (
                <div key={msg.id} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {!isUser && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-cyan-400" />
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-lg border px-4 py-3 ${
                      isUser
                        ? 'bg-[#13203C] border-cyan-500/30 text-slate-100'
                        : 'bg-[#090F1E] border-[#19243E] text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-1.5">
                      <span className="text-[11px] font-medium text-slate-400">
                        {isUser ? 'You' : 'Ask AutoPatch'}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">{formatTimestamp(msg.created_at)}</span>
                        {!isUser && (
                          <button
                            onClick={() => void handleCopyText(`msg-${msg.id}`, msg.content)}
                            className="text-slate-500 hover:text-cyan-400 transition-colors"
                            title="Copy full response"
                          >
                            {copiedId === `msg-${msg.id}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Attached Code Snippet */}
                    {msg.code_context && (
                      <div className="mb-2.5 bg-[#070B14] border border-[#1E2B48] rounded-md overflow-hidden">
                        <div className="px-2.5 py-1 bg-[#0F172A] border-b border-[#1E2B48] text-[11px] font-mono text-cyan-300 flex items-center gap-1.5">
                          <FileCode2 className="w-3 h-3" />
                          {msg.code_context.filePath} (lines {msg.code_context.lineStart}-{msg.code_context.lineEnd})
                        </div>
                        <pre className="p-2.5 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40">
                          {msg.code_context.code}
                        </pre>
                      </div>
                    )}

                    {/* Message Body with Formatted Code Blocks */}
                    <div className="space-y-2.5 text-xs leading-relaxed">
                      {segments.map((seg, idx) =>
                        seg.type === 'code' ? (
                          <div
                            key={idx}
                            className="bg-[#070B14] border border-[#1E2B48] rounded-md overflow-hidden my-2"
                          >
                            <div className="px-3 py-1.5 bg-[#0E1629] border-b border-[#1E2B48] flex items-center justify-between">
                              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                                {seg.language || 'code'}
                              </span>
                              <button
                                onClick={() => void handleCopyText(`code-${msg.id}-${idx}`, seg.content)}
                                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 transition-colors"
                              >
                                {copiedId === `code-${msg.id}-${idx}` ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" /> Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" /> Copy Code
                                  </>
                                )}
                              </button>
                            </div>
                            <pre className="p-3 text-[11.5px] font-mono text-cyan-100 overflow-x-auto leading-relaxed">
                              {seg.content}
                            </pre>
                          </div>
                        ) : (
                          <div key={idx} className="whitespace-pre-wrap text-slate-200">
                            {seg.content}
                          </div>
                        )
                      )}
                    </div>

                    {/* Linked Bug Reports & File References */}
                    {!isUser && (msg.referenced_bug_ids.length > 0 || msg.referenced_files.length > 0) && (
                      <div className="mt-3 pt-2.5 border-t border-[#19243E] space-y-2">
                        {msg.referenced_bug_ids.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">
                              Linked Bugs:
                            </span>
                            {msg.referenced_bug_ids.map((bid) => {
                              const b = bugMap.get(bid);
                              if (!b) return null;
                              return (
                                <button
                                  key={bid}
                                  onClick={() => onSelectBugForRepair(bid)}
                                  className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] bg-[#10192D] hover:bg-[#162340] border border-[#1E2B48] rounded text-slate-200 transition-colors"
                                >
                                  <Bug className={`w-3 h-3 ${severityTextClass(b.severity)}`} />
                                  <span className="truncate max-w-[200px]">{b.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {msg.referenced_files.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">
                              Code References:
                            </span>
                            {msg.referenced_files.map((rf, rIdx) => {
                              const fileObj = fileByPath.get(rf.filePath);
                              return (
                                <button
                                  key={`${rf.filePath}-${rIdx}`}
                                  onClick={() => {
                                    if (fileObj) onJumpToCode(fileObj.id, rf.lineStart);
                                  }}
                                  disabled={!fileObj}
                                  className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono bg-[#0B1222] hover:bg-[#131F3A] border border-cyan-500/25 rounded text-cyan-300 transition-colors disabled:opacity-50"
                                  title={rf.note || 'Open in Code & Explain'}
                                >
                                  <FileCode2 className="w-3 h-3" />
                                  {rf.filePath}:{rf.lineStart}
                                  {rf.lineEnd > rf.lineStart ? `-${rf.lineEnd}` : ''}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Follow-Up Suggestions */}
                    {!isUser && msg.follow_up_suggestions.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-[#19243E] flex flex-wrap gap-1.5">
                        {msg.follow_up_suggestions.map((sug, sIdx) => (
                          <button
                            key={sIdx}
                            onClick={() => void handleSend(sug)}
                            disabled={sending}
                            className="text-[11px] px-2.5 py-1 bg-[#10192D] hover:bg-violet-600/20 border border-[#1E2B48] hover:border-violet-500/40 rounded text-slate-300 hover:text-violet-200 transition-colors"
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="w-8 h-8 rounded-lg bg-[#15223D] border border-[#24355B] flex items-center justify-center shrink-0 mt-0.5">
                      <UserIcon className="w-4 h-4 text-slate-300" />
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Typing Indicator */}
          {sending && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-cyan-400 animate-pulse" />
              </div>
              <div className="bg-[#090F1E] border border-[#19243E] rounded-lg px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
                </span>
                Analyzing project source code and defect context...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer */}
        <div className="p-3.5 border-t border-[#19243E] bg-[#090F1E] space-y-2">
          {attachedSnippet && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#0C1528] border border-cyan-500/30 rounded-md text-xs">
              <span className="font-mono text-cyan-300 truncate">
                Attached: {attachedSnippet.filePath} (lines {attachedSnippet.lineStart}-{attachedSnippet.lineEnd})
              </span>
              <button
                onClick={() => setAttachedSnippet(null)}
                className="text-slate-400 hover:text-white shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={`Ask AutoPatch about ${project.name} (Enter to send, Shift+Enter for newline)...`}
              className="flex-1 resize-none px-3 py-2 text-xs bg-[#070B14] border border-[#1E2B48] focus:border-cyan-500/50 focus:outline-none rounded-md text-slate-100 placeholder:text-slate-500"
            />
            <button
              onClick={() => void handleSend()}
              disabled={sending || !input.trim()}
              className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              Send
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
