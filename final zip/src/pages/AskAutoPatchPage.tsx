import React, { useEffect, useRef, useState } from 'react';
import { Bot, FileCode2, Loader2, MessageSquarePlus, Send, Shield, User as UserIcon } from 'lucide-react';
import { apiFetch, ProjectFile } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { cn, EmptyState } from '../components/ui/Primitives';

interface Conversation {
  id: string;
  project_id: string;
  title: string;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  context_file: string | null;
  context_code: string | null;
  created_at: string;
}

export function AskAutoPatchPage() {
  const { activeProjectId, projects, pushToast } = useAppStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const loadConversations = async () => {
    if (!activeProjectId) return;
    try {
      const [convRes, projRes] = await Promise.all([
        apiFetch<{ conversations: Conversation[] }>(`/api/chat/conversations?projectId=${encodeURIComponent(activeProjectId)}`),
        apiFetch<{ files: ProjectFile[] }>(`/api/projects/${activeProjectId}`),
      ]);
      setConversations(convRes.conversations);
      setFiles(projRes.files);
      if (convRes.conversations.length > 0 && !convRes.conversations.some((c) => c.id === activeConvId)) {
        setActiveConvId(convRes.conversations[0].id);
      } else if (convRes.conversations.length === 0) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadConversations();
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    apiFetch<{ messages: ChatMessage[] }>(`/api/chat/conversations/${activeConvId}/messages`)
      .then((res) => setMessages(res.messages))
      .catch(() => setMessages([]));
  }, [activeConvId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleNewConversation = async (): Promise<string | null> => {
    if (!activeProjectId) return null;
    try {
      const res = await apiFetch<{ conversation: Conversation }>('/api/chat/conversations', {
        method: 'POST',
        body: JSON.stringify({ projectId: activeProjectId, title: 'New Debugging Session' }),
      });
      setConversations((prev) => [res.conversation, ...prev]);
      setActiveConvId(res.conversation.id);
      setMessages([]);
      return res.conversation.id;
    } catch (err: unknown) {
      pushToast({ tone: 'error', title: 'Could not start chat', message: err instanceof Error ? err.message : 'Error' });
      return null;
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = input.trim();
    if (!prompt || sending || !activeProjectId) return;
    setErrorMsg('');
    setSending(true);

    try {
      let convId = activeConvId;
      if (!convId) {
        convId = await handleNewConversation();
        if (!convId) return;
      }

      const fileObj = files.find((f) => f.path === selectedFile);
      const res = await apiFetch<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>(
        `/api/chat/conversations/${convId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: prompt,
            contextFile: fileObj?.path,
            contextCode: fileObj?.content,
          }),
        }
      );

      setMessages((prev) => [...prev, res.userMessage, res.assistantMessage]);
      setInput('');
      loadConversations();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to receive AI debugging response.');
    } finally {
      setSending(false);
    }
  };

  if (!activeProject) {
    return (
      <EmptyState
        icon={<Bot className="h-5 w-5" />}
        title="Select a project to start Ask AutoPatch"
        description="Ask AutoPatch indexes your selected project's files and detected bugs to provide accurate debugging answers."
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#F1F5F9]">Ask AutoPatch</h1>
          <p className="text-xs text-[#94A3B8]">
            Project-aware AI debugging assistant for <strong className="text-[#00F5FF]">{activeProject.name}</strong>. Conversations persist in SQLite.
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewConversation}
          className="inline-flex items-center gap-2 rounded-md border border-[#00F5FF]/30 bg-[#142238] px-3.5 py-2 text-xs font-semibold text-[#F1F5F9] hover:border-[#00F5FF] hover:text-[#00F5FF] whitespace-nowrap shrink-0"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Session
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Conversation History Sidebar */}
        <div className="cyber-panel rounded-lg p-4 lg:col-span-3">
          <h2 className="text-xs font-semibold text-[#94A3B8]">Stored Sessions</h2>
          <div className="mt-3 space-y-1.5">
            {conversations.length === 0 ? (
              <p className="py-4 text-xs text-[#94A3B8]">No prior sessions for this project yet.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveConvId(c.id)}
                  className={cn(
                    'block w-full rounded-md px-3 py-2 text-left text-xs transition-colors',
                    activeConvId === c.id
                      ? 'bg-[#142238] text-[#00F5FF]'
                      : 'text-[#F1F5F9] hover:bg-[#0B1220]'
                  )}
                >
                  <div className="truncate font-medium">{c.title}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-[#94A3B8]">
                    {new Date(c.updated_at).toLocaleDateString()}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main Chat Thread */}
        <div className="cyber-panel flex h-[640px] flex-col rounded-lg lg:col-span-9">
          {/* Safety notice bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#00F5FF]/15 px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-[#94A3B8]">
              <Shield className="h-3.5 w-3.5 text-[#39FF88]" />
              <span>Read-only advisory mode: chat never silently modifies project files.</span>
            </div>
            <div className="flex items-center gap-2">
              <FileCode2 className="h-3.5 w-3.5 text-[#00F5FF]" />
              <label htmlFor="chat-file-context" className="sr-only">
                Attach file context
              </label>
              <select
                id="chat-file-context"
                value={selectedFile}
                onChange={(e) => setSelectedFile(e.target.value)}
                className="rounded border border-[#00F5FF]/20 bg-[#070B14] px-2.5 py-1 font-mono text-xs text-[#F1F5F9]"
              >
                <option value="">Attach file context (optional)</option>
                {files.map((f) => (
                  <option key={f.id} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Bot className="h-8 w-8 text-[#00F5FF]" />
                <h3 className="mt-3 text-base font-semibold text-[#F1F5F9]">Ask AutoPatch about {activeProject.name}</h3>
                <p className="mt-1 max-w-md text-xs text-[#94A3B8]">
                  Ask for root-cause explanations, security walkthroughs, step-by-step debugging instructions, or dependency impact analysis.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {[
                    'Explain the critical SQL injection vulnerability in this project and how to fix it safely.',
                    'Which files have the highest blast radius if modified?',
                    'Suggest unit test edge cases we should add before patching.',
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="rounded-md border border-[#00F5FF]/20 bg-[#0B1220] px-3 py-2 text-left text-xs text-[#F1F5F9] hover:border-[#00F5FF]/50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex gap-3',
                    m.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {m.role === 'assistant' && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#00F5FF]/15 text-[#00F5FF]">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={cn(
                      'max-w-2xl rounded-lg p-3.5 text-sm leading-relaxed',
                      m.role === 'user'
                        ? 'bg-[#142238] text-[#F1F5F9] border border-[#00F5FF]/25'
                        : 'bg-[#0B1220] text-[#F1F5F9] border border-[#00F5FF]/12'
                    )}
                  >
                    {m.context_file && (
                      <div className="mb-2 font-mono text-[11px] text-[#00F5FF]">
                        Context file: {m.context_file}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words text-xs leading-relaxed sm:text-sm">
                      {m.content}
                    </div>
                  </div>
                  {m.role === 'user' && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#A855F7]/20 text-[#A855F7]">
                      <UserIcon className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {errorMsg && (
            <div className="mx-4 mb-2 rounded-md border border-[#FF3864]/40 bg-[#FF3864]/10 px-3 py-2 text-xs text-[#FF3864]">
              {errorMsg}
            </div>
          )}

          {/* Composer */}
          <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-[#00F5FF]/15 p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about an error, bug cause, function, or optimization..."
              aria-label="Message Ask AutoPatch"
              className="flex-1 rounded-md border border-[#00F5FF]/20 bg-[#070B14] px-3.5 py-2.5 text-sm text-[#F1F5F9] placeholder-[#94A3B8] focus:border-[#00F5FF] focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#00F5FF] px-4 py-2.5 text-sm font-semibold text-[#070B14] hover:bg-[#33f7ff] disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
