'use client';

import { useMemo, useState } from 'react';
import { useMessages } from '../lib/hooks';
import { timeAgo } from '../components/utils';
import { EmptyState } from '../components/EmptyState';
import { AliasAvatar } from '../components/AliasAvatar';

interface MessageItem {
  id: string;
  type?: string;
  from_alias?: string;
  to_alias?: string;
  priority?: string;
  content?: string;
  created_at?: string;
  task_id?: string;
}

const TYPE_COLORS: Record<string, string> = {
  task: 'bg-green-500/10 text-green-300 border-green-500/20',
  message: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  broadcast: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  reply: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
};

function normalizeDate(value?: string) {
  if (!value) return 0;
  return new Date(value.replace(' ', 'T') + 'Z').getTime();
}

function formatDividerLabel(value?: string) {
  if (!value) return 'Time gap';
  const date = new Date(value.replace(' ', 'T') + 'Z');
  return date.toLocaleString();
}

function bubbleVariant(message: MessageItem) {
  if (message.type === 'broadcast') return 'broadcast';
  if ((message.from_alias || '').toLowerCase() === 'dashboard') return 'outgoing';
  return 'incoming';
}

/** Render message content, highlighting the search match inline (skips the
 *  `from:` filter prefix since it filters by sender, not by content). */
function renderHighlighted(content: string | undefined, search: string) {
  const text = content || '--';
  const q = search.trim();
  if (!q || q.startsWith('from:')) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return <>{text.slice(0, idx)}<mark className="bg-yellow-500/30 text-yellow-200 rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
}

export default function MessagesPage() {
  const { messages, isLoading } = useMessages(200);
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');
  const [debug, setDebug] = useState(false);
  const [viewMode, setViewMode] = useState<'timeline' | 'grouped'>('timeline');

  const quickFromChips = useMemo(() => {
    const aliases = new Set<string>();
    messages.forEach((message: MessageItem) => {
      const alias = message.from_alias?.trim();
      if (alias && alias.toLowerCase() !== 'dashboard') aliases.add(alias);
    });
    return [...aliases].slice(0, 8);
  }, [messages]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const fromFilter = query.startsWith('from:') ? query.slice(5).trim() : '';

    return [...messages]
      .filter((m: MessageItem) => {
        if (filterType && m.type !== filterType) return false;
        if (fromFilter) {
          return (m.from_alias || '').toLowerCase().includes(fromFilter);
        }
        if (query) {
          return (m.from_alias || '').toLowerCase().includes(query)
            || (m.to_alias || '').toLowerCase().includes(query)
            || (m.content || '').toLowerCase().includes(query);
        }
        return true;
      })
      .sort((a: MessageItem, b: MessageItem) => normalizeDate(a.created_at) - normalizeDate(b.created_at));
  }, [filterType, messages, search]);

  // Group messages by conversation pair
  const conversations = useMemo(() => {
    const groups = new Map<string, { participants: string[]; messages: MessageItem[]; lastTime: number }>();
    filtered.forEach(m => {
      const a = m.from_alias || '?';
      const b = m.to_alias || '?';
      const key = [a, b].sort().join('↔');
      const group = groups.get(key) || { participants: [a, b].sort(), messages: [] as MessageItem[], lastTime: 0 };
      group.messages.push(m);
      group.lastTime = Math.max(group.lastTime, normalizeDate(m.created_at));
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => b.lastTime - a.lastTime);
  }, [filtered]);

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-white lg:ml-0 ml-10">Messages</h1>
        <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full border border-blue-800/30">
          {messages.length}
        </span>
        {filtered.length > 0 && (
          <button
            onClick={() => {
              const md = filtered.map((m: MessageItem) =>
                `**${m.from_alias || '?'}** → ${m.to_alias || '?'} (${m.type || '?'}) — ${m.created_at || ''}\n\n${m.content || '--'}\n\n---`
              ).join('\n\n');
              const blob = new Blob([`# Messages Export\n\n${md}`], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `messages-${new Date().toISOString().slice(0,10)}.md`;
              a.click(); URL.revokeObjectURL(url);
            }}
            className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700/50 px-2.5 py-1 rounded-lg transition-colors"
          >
            Export MD
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search from/to/content or use from:alias"
          className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-blue-500/50 focus:outline-none w-full sm:w-72"
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
        >
          <option value="">All types</option>
          <option value="task">task</option>
          <option value="message">message</option>
          <option value="broadcast">broadcast</option>
          <option value="reply">reply</option>
        </select>
        <div className="flex rounded-lg border border-[#2a2a4a] bg-[#111128] p-0.5">
          {(['timeline', 'grouped'] as const).map(mode => (
            <button key={mode} type="button" onClick={() => setViewMode(mode)}
              className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${viewMode === mode ? 'bg-cyan-500/10 text-cyan-300' : 'text-gray-500 hover:text-gray-200'}`}>
              {mode === 'timeline' ? 'Timeline' : 'Grouped'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setDebug(!debug)}
          className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
            debug ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' : 'text-gray-500 border-gray-700/50 hover:text-gray-300'
          }`}
        >
          {debug ? 'Debug ON' : 'Debug'}
        </button>
      </div>

      {quickFromChips.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {quickFromChips.map(alias => (
            <button
              key={alias}
              type="button"
              onClick={() => setSearch(`from:${alias}`)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                search === `from:${alias}`
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                  : 'border-[#2a2a4a] bg-[#111128] text-gray-400 hover:text-gray-200'
              }`}
            >
              from:{alias}
            </button>
          ))}
          {search.startsWith('from:') && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-500 hover:text-gray-200"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-20 rounded-2xl bg-gray-800/20" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState variant="messages" />
      ) : viewMode === 'grouped' ? (
        <div className="space-y-4">
          {conversations.map((conv, ci) => (
            <div key={ci} className="bg-[#111128] border border-[#2a2a4a] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#2a2a4a] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AliasAvatar alias={conv.participants[0]} size={16} />
                  <span className="text-sm text-gray-200 font-medium">{conv.participants[0]}</span>
                  <span className="text-gray-600 text-xs">↔</span>
                  <AliasAvatar alias={conv.participants[1]} size={16} />
                  <span className="text-sm text-gray-200 font-medium">{conv.participants[1]}</span>
                </div>
                <span className="text-[10px] text-gray-600">{conv.messages.length} messages</span>
              </div>
              <div className="px-4 py-2 space-y-2 max-h-64 overflow-y-auto">
                {conv.messages.map(m => (
                  <div key={m.id} className="flex items-start gap-2 text-xs py-1">
                    {m.from_alias && <AliasAvatar alias={m.from_alias} size={14} />}
                    <span className="shrink-0 font-medium text-gray-200">{m.from_alias}</span>
                    <span className="text-gray-400 flex-1">{m.content?.slice(0, 120) || '--'}</span>
                    <span className="text-[9px] text-gray-600 shrink-0">{timeAgo(m.created_at || '')}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((message: MessageItem, index) => {
            const previous = filtered[index - 1];
            const gapExceeded = previous
              ? normalizeDate(message.created_at) - normalizeDate(previous.created_at) > 5 * 60 * 1000
              : false;
            const variant = bubbleVariant(message);
            // Cluster: same sender + same direction + same to_alias and no
            // time-gap divider → tighter spacing and hide repeated header.
            const samePrev = !!previous
              && !gapExceeded
              && bubbleVariant(previous) === variant
              && (previous.from_alias || '') === (message.from_alias || '')
              && (previous.to_alias || '') === (message.to_alias || '');
            const fromAlias = message.from_alias || '?';

            return (
              <div key={message.id}>
                {gapExceeded && (
                  <div className="my-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-[#2a2a4a]" />
                    <div className="text-[11px] text-gray-600">{formatDividerLabel(message.created_at)}</div>
                    <div className="h-px flex-1 bg-[#2a2a4a]" />
                  </div>
                )}

                {/* Broadcasts span full width — no avatar gutter. */}
                {variant === 'broadcast' ? (
                  <div className={samePrev ? 'mt-1' : 'mt-3'}>
                    <div className="rounded-2xl border border-purple-500/20 bg-purple-500/10 px-4 py-3 shadow-sm w-full">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-md border ${TYPE_COLORS[message.type || ''] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                          {message.type || 'unknown'}
                        </span>
                        <span className="text-sm font-medium text-purple-200">{fromAlias}</span>
                        {message.to_alias && <span className="text-xs text-purple-200/80">to {message.to_alias}</span>}
                        {message.priority === 'high' && <span className="text-xs text-red-400">HIGH</span>}
                        <span className="ml-auto text-xs text-gray-500">{message.created_at ? timeAgo(message.created_at) : '--'}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                        {renderHighlighted(message.content, search)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={`${samePrev ? 'mt-1' : 'mt-3'} flex gap-2 ${variant === 'outgoing' ? 'flex-row-reverse' : 'flex-row'}`}>
                    {/* Avatar gutter — fixed width keeps bubble columns aligned even on streaks */}
                    <div className="w-8 shrink-0 pt-1">
                      {!samePrev && <AliasAvatar alias={fromAlias} size={32} />}
                    </div>
                    <div className={`min-w-0 max-w-3xl rounded-2xl border px-4 py-3 shadow-sm ${
                      variant === 'outgoing'
                        ? 'border-green-500/20 bg-green-500/10'
                        : 'border-blue-500/20 bg-blue-500/10'
                    }`}>
                      {!samePrev && (
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-md border ${TYPE_COLORS[message.type || ''] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                            {message.type || 'unknown'}
                          </span>
                          <span className={`text-sm font-medium ${variant === 'outgoing' ? 'text-green-300' : 'text-blue-300'}`}>
                            {fromAlias}
                          </span>
                          <span className="text-xs text-gray-600">&rarr;</span>
                          <span className="text-sm text-gray-300">{message.to_alias || '--'}</span>
                          {message.priority === 'high' && <span className="text-xs text-red-400">HIGH</span>}
                          <span className="ml-auto text-xs text-gray-500">{message.created_at ? timeAgo(message.created_at) : '--'}</span>
                        </div>
                      )}

                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-200">
                        {renderHighlighted(message.content, search)}
                      </div>

                      {/* When in a streak, surface the timestamp inline-right so users still know cadence */}
                      {samePrev && (
                        <div className="mt-1 text-[10px] text-gray-600 text-right">
                          {message.created_at ? timeAgo(message.created_at) : ''}
                        </div>
                      )}

                      {debug && (
                        <div className="mt-3 border-t border-white/10 pt-3 text-xs text-gray-500 space-y-1">
                          <div>ID: {message.id}</div>
                          {message.task_id && <div>Task ID: {message.task_id}</div>}
                          <div>Created: {message.created_at}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
