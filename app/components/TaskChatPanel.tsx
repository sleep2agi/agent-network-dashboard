'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { timeAgo } from './utils';
import { AliasAvatar } from './AliasAvatar';

interface ChatTask {
  task_id: string;
  from_name: string;
  to_name: string;
  status: string;
  priority: string;
  content: string;
  result: string;
  created_at: string;
  completed_at?: string;
}

type ChatEvent =
  | { kind: 'task'; task: ChatTask; at: string }
  | { kind: 'reply'; task: ChatTask; at: string };

function eventTime(value?: string) {
  if (!value) return 0;
  return new Date(value.replace(' ', 'T') + (value.includes('T') ? '' : 'Z')).getTime() || 0;
}

function formatTimestamp(value?: string) {
  if (!value) return '--';
  const d = new Date(value.replace(' ', 'T') + (value.includes('T') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function quotePreview(text: string, max = 140) {
  const compact = (text || '')
    .replace(/\[Dashboard 附件[\s\S]*$/m, '[附件]')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function extractAttachmentPreviews(text: string): string[] {
  const urls: string[] = [];
  for (const line of (text || '').split('\n')) {
    const match = line.match(/^\s*-\s*预览:\s*(\S+)\s*$/);
    if (match?.[1]) urls.push(match[1]);
  }
  return Array.from(new Set(urls));
}

function AttachmentPreviews({ text }: { text: string }) {
  const urls = extractAttachmentPreviews(text);
  if (urls.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {urls.map((url) => (
        <a key={url} href={url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border border-cyan-500/20 bg-black/20">
          <img
            src={url}
            alt="Dashboard attachment preview"
            className="h-28 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

function LocalImagePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-cyan-500/25 bg-black/20">
      {url && <img src={url} alt={file.name} className="h-full w-full object-cover" />}
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-red-500"
        aria-label={`Remove ${file.name}`}
      >
        ×
      </button>
    </div>
  );
}

const STATUS_STEPS = ['created', 'delivered', 'running', 'replied'];
const STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-400', delivered: 'bg-blue-400', running: 'bg-green-400',
  replied: 'bg-purple-400', failed: 'bg-red-400', closed: 'bg-gray-500',
};

function StatusBar({ status }: { status: string }) {
  const idx = STATUS_STEPS.indexOf(status);
  const isFailed = status === 'failed';
  return (
    <div className="flex items-center gap-1 mt-1.5">
      {STATUS_STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full transition-all duration-700 ${
            isFailed ? (i === 0 ? 'bg-red-400' : 'bg-[var(--border)]')
            : i <= idx ? (STATUS_COLORS[s] || 'bg-gray-600') : 'bg-[var(--border)]'
          }`} />
          {i < STATUS_STEPS.length - 1 && (
            <div className={`w-4 h-px transition-colors duration-700 ${
              isFailed ? 'bg-red-800' : i < idx ? 'bg-gray-500' : 'bg-[var(--border)]'
            }`} />
          )}
        </div>
      ))}
      <span className={`text-[10px] ml-1.5 font-medium ${
        isFailed ? 'text-red-400' : status === 'replied' ? 'text-purple-400'
        : status === 'running' ? 'text-green-400' : 'text-[var(--fg-muted)]'
      }`}>{status}</span>
      {(status === 'running' || status === 'delivered') && (
        <span className="ml-1">
          <span className="inline-block w-1 h-1 rounded-full bg-green-400 animate-pulse" />
          <span className="inline-block w-1 h-1 rounded-full bg-green-400 animate-pulse ml-0.5" style={{ animationDelay: '0.2s' }} />
          <span className="inline-block w-1 h-1 rounded-full bg-green-400 animate-pulse ml-0.5" style={{ animationDelay: '0.4s' }} />
        </span>
      )}
    </div>
  );
}

// Full markdown rendering — handles tables, headings, lists, links, code,
// blockquotes via react-markdown + GFM. Earlier hand-rolled parser only did
// code blocks + bold; tables / headings showed as raw `|---|` text.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSSE } from '../lib/useSSE';
import { useNetworkId } from '../lib/network-context';
import { markChatRead } from '../lib/chat-unread';

function MarkdownContent({ text }: { text: string }) {
  if (!text) return <span className="text-[var(--fg-dim)] italic">No content</span>;
  return (
    <div className="break-words leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-base font-semibold text-[var(--fg)] mt-2 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold text-[var(--fg)] mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-cyan-300 mt-1.5 mb-0.5">{children}</h3>,
          p: ({ children }) => <p className="my-1">{children}</p>,
          strong: ({ children }) => <strong className="text-[var(--fg)] font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic text-[var(--fg-muted)]">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-cyan-300 underline">{children}</a>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-cyan-500/30 pl-3 my-1 text-[var(--fg-muted)] italic">{children}</blockquote>,
          hr: () => <hr className="border-t border-[var(--border)] my-2" />,
          code: ({ className, children }) => {
            const inline = !className?.startsWith('language-');
            if (inline) {
              return <code className="bg-[var(--code-bg)] rounded px-1.5 py-0.5 text-cyan-300 text-[11px] border border-[var(--border)]">{children}</code>;
            }
            const lang = className?.replace(/^language-/, '') || '';
            return (
              <div className="my-2 rounded-lg overflow-hidden border border-[var(--border)]">
                {lang && <div className="bg-[var(--code-bg)] px-3 py-1 text-[10px] text-[var(--fg-muted)] border-b border-[var(--border)]">{lang}</div>}
                <pre className="bg-[var(--code-bg)] px-3 py-2 text-[11px] text-green-300 overflow-x-auto"><code>{children}</code></pre>
              </div>
            );
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-[var(--code-bg)]">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-[var(--border)]">{children}</tr>,
          th: ({ children }) => <th className="text-left text-cyan-300 font-semibold px-2 py-1 border border-[var(--border)]">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1 border border-[var(--border)] align-top">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

interface TaskChatPanelProps {
  alias: string;
  onClose: () => void;
  /** When true, renders without outer panel chrome (for use inside CommandCenter) */
  inline?: boolean;
  /** Available nodes for @ mention */
  availableNodes?: string[];
}

export function TaskChatPanel({ alias, onClose, inline, availableNodes }: TaskChatPanelProps) {
  const { networkId } = useNetworkId();
  const [messages, setMessages] = useState<ChatTask[]>([]);
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [priority, setPriority] = useState('normal');
  const [sending, setSending] = useState(false);
  const [pollingIds, setPollingIds] = useState<Set<string>>(new Set());
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [targetAlias, setTargetAlias] = useState(alias);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionNodes, setMentionNodes] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // #217 M4 (Vincent: 倒序加载, 上滑再拉旧的): history is paged. We load
  // only the newest PAGE on open and grow the window when the user
  // scrolls to the top. The hub API has no `before` cursor (offset is
  // ignored), so "older" = refetch with a larger limit and prepend the
  // delta — each step is on-demand and tiny vs one full pull.
  const HISTORY_PAGE = 20;
  const scrollRef = useRef<HTMLDivElement>(null);
  const histLimitRef = useRef(HISTORY_PAGE);
  const skipAutoScrollRef = useRef(false);
  const anchoredRef = useRef(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Load available nodes for @ mention
  useEffect(() => {
    if (availableNodes) { setMentionNodes(availableNodes); return; }
    fetch('/api/hub/status').then(r => r.json()).then(d => {
      const nodes = (d.sessions || []).filter((s: { status: string }) => s.status !== 'offline').map((s: { alias: string }) => s.alias);
      setMentionNodes(nodes);
    }).catch(() => {});
  }, [availableNodes]);

  // Reset target when alias changes
  useEffect(() => { setTargetAlias(alias); }, [alias]);

  useEffect(() => {
    if (!alias) return;
    markChatRead(alias, networkId);
  }, [alias, networkId]);

  // Load task history for this node — newest `limit` only (M4).
  // Vincent tg923 (转圈加载太久): bound the request with an AbortController so
  // a stalled hub call can't leave the panel spinning forever. On
  // timeout/error we clear the spinner and flag historyError, which renders a
  // tappable retry row instead of an endless spin.
  const loadHistory = useCallback(async (limit: number) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(
        `/api/hub/tasks?to_name=${encodeURIComponent(alias)}&limit=${limit}`,
        { signal: ctrl.signal },
      );
      const data = await res.json();
      if (data.tasks) {
        const fetched = data.tasks.reverse(); // oldest first for display
        if (data.tasks.length < limit) setHasOlder(false);
        // Merge: keep current messages the fetch doesn't know about yet
        // (optimistic sends / SSE patches) so growing the window never
        // drops an in-flight bubble.
        setMessages(prev => {
          const ids = new Set(fetched.map((t: { task_id?: string }) => t.task_id));
          const extras = prev.filter(t => t.task_id && !ids.has(t.task_id));
          return [...fetched, ...extras];
        });
      }
      setHistoryError(false);
    } catch {
      setHistoryError(true);
    } finally {
      clearTimeout(timer);
      setHistoryLoaded(true);
    }
  }, [alias]);

  useEffect(() => {
    setMessages([]);
    setHistoryLoaded(false);
    setHistoryError(false);
    histLimitRef.current = HISTORY_PAGE;
    anchoredRef.current = false;
    setHasOlder(true);
    loadHistory(HISTORY_PAGE);
    // Focus textarea
    setTimeout(() => textareaRef.current?.focus(), 300);
  }, [alias, loadHistory]);

  // M4: user scrolled to the top → grow the history window, keeping the
  // viewport anchored on the message they were looking at.
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    skipAutoScrollRef.current = true;
    histLimitRef.current += HISTORY_PAGE;
    await loadHistory(histLimitRef.current);
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
      setLoadingOlder(false);
    });
  }, [loadingOlder, hasOlder, loadHistory]);

  const onMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The initial bottom-anchor is a smooth scroll, so its own scroll
    // events pass through scrollTop≈0 territory. Arm the older-page
    // trigger only after the container has actually reached the bottom
    // once — everything before that is layout/auto-scroll noise.
    if (!anchoredRef.current) {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) anchoredRef.current = true;
      return;
    }
    if (el.scrollTop < 40) loadOlder();
  }, [loadOlder]);

  // Auto-scroll to bottom on new messages — but not when we just
  // prepended older history (that would yank the user away from what
  // they scrolled up to read).
  useEffect(() => {
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // SSE-driven task updates: the server pushes new_reply events to the
  // sender's alias channel (/events/<from_session>), so we just listen for
  // them and patch the matching bubble immediately. No polling needed for
  // the normal path. The polling block below remains as a safety-net for
  // SSE-unavailable environments / disconnect windows.
  useSSE({
    url: '/api/hub/events',
    enabled: pollingIds.size > 0,
    onEvent: async (e: { type?: string; in_reply_to?: string; message_id?: string }) => {
      if (e?.type !== 'new_reply' || !e.in_reply_to) return;
      // Refetch the task to get the full reply text + final status.
      try {
        const res = await fetch(`/api/hub/tasks?task_id=${encodeURIComponent(e.in_reply_to)}`);
        const data = await res.json();
        const updated = data?.tasks?.[0];
        if (!updated) return;
        setMessages(prev => prev.map(m => m.task_id === e.in_reply_to ? { ...m, ...updated } : m));
        if (['replied', 'failed', 'closed', 'expired', 'cancelled'].includes(updated.status)) {
          setPollingIds(prev => { const n = new Set(prev); n.delete(e.in_reply_to!); return n; });
        }
      } catch {}
    },
  });

  // Polling fallback (SSE-unavailable / proxies stripping events).
  // Slow cadence so we're not the bulk of server load — SSE handles the fast path.
  useEffect(() => {
    if (pollingIds.size === 0) return;
    // 30s cadence — the SSE listener handles the fast path. Polling only
    // catches state when the SSE connection is unavailable (proxy stripping
    // events, browser HTTP/2 oddities, etc). Cap 1h to match server TTL.
    const startTime = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startTime > 3600_000) {
        setPollingIds(new Set());
        clearInterval(interval);
        return;
      }
      for (const taskId of pollingIds) {
        try {
          const res = await fetch(`/api/hub/tasks?task_id=${encodeURIComponent(taskId)}`);
          const data = await res.json();
          if (data.tasks?.[0]) {
            const updated = data.tasks[0];
            setMessages(prev => prev.map(m => m.task_id === taskId ? { ...m, ...updated } : m));
            if (['replied', 'failed', 'closed', 'expired', 'cancelled'].includes(updated.status)) {
              setPollingIds(prev => { const n = new Set(prev); n.delete(taskId); return n; });
            }
          }
        } catch {}
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [pollingIds]);

  const uploadAttachments = async () => {
    const uploaded = [];
    for (const file of attachedFiles) {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/hub/upload', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (!res.ok || !data.ok) throw new Error(data.error || data.detail || `upload failed: ${file.name}`);
      uploaded.push({ type: 'image', name: file.name, path: data.path, url: data.url, mime: data.mime, size: data.size });
    }
    return uploaded;
  };

  const send = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || sending) return;
    let taskContent = input.trim();
    let sendTo = targetAlias;

    // Parse @mention at start: "@NodeName rest of message"
    const atMatch = taskContent.match(/^@(\S+)\s+([\s\S]+)/);
    if (atMatch) {
      const mentioned = mentionNodes.find(n => n.toLowerCase() === atMatch[1].toLowerCase());
      if (mentioned) {
        sendTo = mentioned;
        taskContent = atMatch[2];
      }
    }

    setSending(true);
    setInput('');
    setAttachedFiles([]);
    setShowMentions(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const pendingAttachmentText = attachedFiles.length > 0
      ? `\n\n[Dashboard 附件待上传]\n${attachedFiles.map(f => `- 图片: ${f.name}`).join('\n')}`
      : '';

    // Optimistic echo first so the user always sees their message in history
    // even if the network call fails or the server returns ok:false. Earlier
    // version only added on data.ok=true → silent failures looked like
    // 'tasks get swallowed'.
    const localTaskId = `tmp-${Date.now()}`;
    const optimistic: ChatTask = {
      task_id: localTaskId,
      from_name: 'Dashboard',
      to_name: sendTo,
      status: 'created',
      priority,
      content: `${taskContent}${pendingAttachmentText}`.trim(),
      result: '',
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const uploaded = await uploadAttachments();
      if (uploaded.length > 0) {
        const attachmentText = [
          '',
          '',
          '[Dashboard 附件]',
          ...uploaded.map(f => `- 图片: ${f.path}`),
          ...uploaded.map(f => `- 预览: ${f.url}`),
        ].join('\n');
        taskContent = `${taskContent}${attachmentText}`.trim();
        setMessages(prev => prev.map(m =>
          m.task_id === localTaskId ? { ...m, content: taskContent } : m,
        ));
      }
      const res = await fetch('/api/hub/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: sendTo, task: taskContent, priority, attachments: uploaded }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
      if (data.ok && data.message_id) {
        setMessages(prev => prev.map(m =>
          m.task_id === localTaskId ? { ...m, task_id: data.message_id, status: 'delivered' } : m,
        ));
        setPollingIds(prev => new Set(prev).add(data.message_id));
      } else {
        const reason = data.error || data.detail || `send failed (status ${res.status})`;
        setMessages(prev => prev.map(m =>
          m.task_id === localTaskId ? { ...m, status: 'failed', result: `❌ ${reason}` } : m,
        ));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => prev.map(m =>
        m.task_id === localTaskId ? { ...m, status: 'failed', result: `❌ network error: ${msg}` } : m,
      ));
    }
    setSending(false);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends, Shift+Enter inserts newline (standard chat UX).
    // Users habit-pressed Enter expecting send and saw nothing happen.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape') setShowMentions(false);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    // Check if user just typed @
    const lastAt = value.lastIndexOf('@');
    if (lastAt >= 0 && (lastAt === 0 || value[lastAt - 1] === ' ' || value[lastAt - 1] === '\n')) {
      const after = value.slice(lastAt + 1);
      if (!after.includes(' ') && !after.includes('\n')) {
        setMentionFilter(after.toLowerCase());
        setShowMentions(true);
        return;
      }
    }
    setShowMentions(false);
  };

  const addImageFiles = (files: FileList | File[]) => {
    const images = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (images.length === 0) return;
    setAttachedFiles(prev => [...prev, ...images].slice(0, 6));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files || []);
    if (files.some(file => file.type.startsWith('image/'))) {
      addImageFiles(files);
      e.preventDefault();
    }
  };

  const insertMention = (nodeName: string) => {
    const lastAt = input.lastIndexOf('@');
    const before = input.slice(0, lastAt);
    setInput(`${before}@${nodeName} `);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const filteredMentions = mentionNodes.filter(n =>
    n !== alias && n.toLowerCase().includes(mentionFilter)
  ).slice(0, 8);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  };

  const chatEvents: ChatEvent[] = messages
    .flatMap((task): ChatEvent[] => {
      const events: ChatEvent[] = [{ kind: 'task', task, at: task.created_at }];
      if (task.result) events.push({ kind: 'reply', task, at: task.completed_at || task.created_at });
      return events;
    })
    .sort((a, b) => {
      const delta = eventTime(a.at) - eventTime(b.at);
      if (delta !== 0) return delta;
      if (a.task.task_id !== b.task.task_id) return a.task.task_id.localeCompare(b.task.task_id);
      return a.kind === 'task' ? -1 : 1;
    });

  // Inline mode: just the chat content, no panel chrome
  const chatContent = (
    <>
        {/* Messages area */}
        {/* R12 of #190 mobile polish: the chat scroll surface used
            space-y-3 between task+reply pairs at mobile = 12 px, which
            in a long thread (the panel's bread-and-butter use case)
            adds up to a significant scroll length. Drop to space-y-2 at
            mobile and the per-pair grouping (line 540) from space-y-2
            to space-y-1.5 so messages read denser without losing the
            speaker-turn rhythm. Desktop unchanged at sm: and up. */}
        <div ref={scrollRef} onScroll={onMessagesScroll} className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 space-y-2 sm:space-y-4">
          {!historyLoaded && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            </div>
          )}
          {/* M4: top-of-thread row — scroll-to-top auto-loads older, and
              the row is also tappable for short threads that don't
              overflow (nothing to scroll). Quiet "beginning" marker
              once history is exhausted. */}
          {historyLoaded && hasOlder && messages.length > 0 && (
            <button
              type="button"
              onClick={loadOlder}
              className="w-full flex justify-center py-2 text-[11px] text-[var(--fg-dim)] hover:text-[var(--fg-muted)]"
            >
              {loadingOlder ? (
                <span className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
              ) : (
                <span>↑ Load earlier messages</span>
              )}
            </button>
          )}
          {historyLoaded && !hasOlder && messages.length > 0 && (
            <div className="text-center text-[10px] text-[var(--fg-dim)] py-1">— beginning of history —</div>
          )}
          {historyLoaded && !historyError && messages.length === 0 && (
            <div className="text-center py-12">
              <div className="text-3xl mb-3">💬</div>
              <div className="text-[var(--fg-muted)] text-sm">Start a conversation</div>
              <div className="text-[var(--fg-dim)] text-xs mt-1">Send a task to {alias}</div>
            </div>
          )}
          {/* Vincent tg923: bounded fetch failed/timed out — offer a retry
              instead of a stuck spinner or a misleading empty state. */}
          {historyLoaded && historyError && messages.length === 0 && (
            <div className="text-center py-12">
              <div className="text-[var(--fg-muted)] text-sm">加载超时</div>
              <button
                type="button"
                onClick={() => { setHistoryLoaded(false); setHistoryError(false); loadHistory(histLimitRef.current); }}
                className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 underline"
              >
                点此重试
              </button>
            </div>
          )}

          {chatEvents.map((event) => {
            const m = event.task;
            // Distinguish task source so users can tell when a peer agent
            // forwarded a task vs when they themselves sent it from Dashboard.
            const fromUser = !m.from_name || m.from_name === 'Dashboard' || m.from_name === 'api' || m.from_name === 'hub';
            const senderLabel = fromUser ? 'You' : m.from_name;
            const senderBadge = fromUser
              ? null
              : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-[9px] text-purple-300 font-medium">↳ {m.from_name}</span>;
            if (event.kind === 'reply') {
              return (
                <div key={`${m.task_id}:reply`} className="flex justify-start">
                  <div className="max-w-[92%] sm:max-w-[85%] bg-green-500/8 border border-green-500/15 rounded-2xl rounded-bl-md px-3 py-2.5 sm:px-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {m.to_name && <AliasAvatar alias={m.to_name} size={14} />}
                        <span className="text-[10px] text-[var(--fg)] font-medium truncate">{m.to_name}</span>
                        <span className="text-[9px] text-green-300/70">replied</span>
                      </div>
                      <span className="shrink-0 rounded-md bg-black/20 px-1.5 py-0.5 text-[9px] text-[var(--fg-dim)]" title={event.at}>
                        {timeAgo(event.at)} · {formatTimestamp(event.at)}
                      </span>
                    </div>
                    <div className="mb-2 rounded-lg border-l-2 border-cyan-400/40 bg-black/20 px-2.5 py-1.5">
                      <div className="text-[9px] text-cyan-300/80">
                        引用 {senderLabel} 的任务 · {formatTimestamp(m.created_at)}
                      </div>
                      <div className="mt-0.5 max-h-10 overflow-hidden text-[11px] leading-5 text-[var(--fg-muted)]">
                        {quotePreview(m.content) || 'No content'}
                      </div>
                    </div>
                    <div className="text-[13px] text-[var(--fg)]">
                      <MarkdownContent text={m.result} />
                      <AttachmentPreviews text={m.result} />
                    </div>
                  </div>
                </div>
              );
            }
            return (
            <div key={`${m.task_id}:task`} className="space-y-1.5 sm:space-y-2">
              {/* Outgoing task — labeled with origin so peer-forwarded tasks are obvious */}
              <div className="flex justify-end">
                <div className="max-w-[92%] sm:max-w-[85%] bg-cyan-500/8 border border-cyan-500/15 rounded-2xl rounded-br-md px-3 py-2.5 sm:px-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-medium ${fromUser ? 'text-cyan-400' : 'text-purple-300'}`}>{senderLabel}</span>
                    {!fromUser && <span className="text-[9px] text-[var(--fg-dim)]">forwarded to {m.to_name}</span>}
                  </div>
                  <div className="text-[13px] text-[var(--fg)]">
                    <MarkdownContent text={m.content} />
                    <AttachmentPreviews text={m.content} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between mt-1.5 gap-2 sm:gap-3">
                    <StatusBar status={m.status} />
                    <div className="flex items-center gap-2 shrink-0">
                      {senderBadge}
                      <span className="rounded-md bg-black/15 px-1.5 py-0.5 text-[9px] text-[var(--fg-dim)]" title={m.created_at}>
                        {timeAgo(m.created_at)} · {formatTimestamp(m.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Typing indicator when running */}
              {m.status === 'running' && !m.result && (
                <div className="flex justify-start">
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0s' }} />
                      <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0.15s' }} />
                      <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0.3s' }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              {/* @ mention dropdown */}
              {showMentions && filteredMentions.length > 0 && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl shadow-black/50 overflow-hidden z-10 max-h-48 overflow-y-auto">
                  {filteredMentions.map(node => (
                    <button key={node} onClick={() => insertMention(node)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-cyan-500/10 transition-colors">
                      <AliasAvatar alias={node} size={16} />
                      <span className="text-[var(--fg-muted)]">{node}</span>
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { handleInputChange(e.target.value); autoResize(e.target); }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={`Message ${alias}...`}
                rows={1}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl px-3 py-2.5 pr-24 text-base sm:px-4 sm:text-sm text-[var(--fg)] placeholder-[var(--fg-dim)] focus:border-cyan-500/40 focus:outline-none resize-none transition-colors"
              />
              <div className="absolute right-2 bottom-1.5 flex items-center gap-1">
                <label className="p-1 text-[var(--fg-dim)] hover:text-cyan-300 cursor-pointer rounded hover:bg-cyan-500/10" title="Attach image">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => { if (e.target.files) addImageFiles(e.target.files); e.currentTarget.value = ''; }}
                  />
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6.5l-7.78 7.78a3 3 0 104.24 4.24l8.49-8.49a5 5 0 00-7.07-7.07L5.89 11.45a7 7 0 109.9 9.9l7.07-7.07" />
                  </svg>
                </label>
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="bg-transparent text-[9px] text-[var(--fg-dim)] focus:outline-none cursor-pointer">
                  <option value="normal">N</option>
                  <option value="high">H</option>
                  <option value="low">L</option>
                </select>
              </div>
            </div>
            {/* R17 of #190: send button was p-2.5 + w-5 icon = ~40 x 40
                hit zone, 4 px short of the iOS 44 px guideline on
                the short axis. Bump to inline-flex + min-h/w 44. */}
            <button onClick={send} aria-label="Send message" disabled={sending || (!input.trim() && attachedFiles.length === 0)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center bg-cyan-600 hover:bg-cyan-500 disabled:bg-[var(--border)] disabled:text-[var(--fg-dim)] text-[var(--fg)] rounded-xl transition-all shrink-0 active:scale-95">
              {sending ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </button>
          </div>
          {attachedFiles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachedFiles.map((file, index) => (
                <LocalImagePreview
                  key={`${file.name}-${file.size}-${index}`}
                  file={file}
                  onRemove={() => setAttachedFiles(prev => prev.filter((_, i) => i !== index))}
                />
              ))}
            </div>
          )}
          <div className="hidden sm:flex justify-between text-[9px] text-[var(--fg-dim)] mt-1.5">
            <span>{input.includes('@') ? `Sending to: ${targetAlias}` : `Type @ to mention another node`}</span>
            <span>Enter to send · paste image</span>
          </div>
        </div>
    </>
  );

  if (inline) {
    return <div className="flex flex-col h-full">{chatContent}</div>;
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40 lg:hidden anet-fade-in" onClick={onClose} />
      <div className="fixed top-0 right-0 h-[100dvh] w-full lg:w-[640px] xl:w-[760px] 2xl:w-[860px] bg-[var(--bg)] border-l border-[var(--border)] z-50 flex flex-col shadow-2xl shadow-black/60 animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <AliasAvatar alias={alias} size={32} />
            <div>
              <div className="text-sm font-semibold text-[var(--fg)]">{alias}</div>
              <div className="text-[10px] text-[var(--fg-muted)]">{pollingIds.size > 0 ? 'Processing...' : 'Ready'}</div>
            </div>
          </div>
          {/* R16 of #190: was p-1.5 + w-5 h-5 svg = ~32 px tap target.
              The chat panel close is high-frequency on mobile (user
              dismisses to scroll the underlying page); bump to a
              uniform 44 x 44 hit zone via inline-flex + min-h/w. */}
          <button onClick={onClose} aria-label="Close chat" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-[var(--fg-muted)] hover:text-[var(--fg)] rounded-lg hover:bg-[var(--bg-elevated)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {chatContent}
      </div>
    </>
  );
}
