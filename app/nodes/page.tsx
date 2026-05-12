'use client';

import { useState } from 'react';
import Link from 'next/link';
import { timeAgo } from '../components/utils';
import { useSessions, useHealth } from '../lib/hooks';
import { TaskChatPanel } from '../components/TaskChatPanel';
import { EmptyState } from '../components/EmptyState';
import type { Session } from '../components/types';

const STATUS_COLORS: Record<string, string> = {
  working: 'bg-green-500/10 text-green-300 border-green-500/20',
  idle: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  blocked: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-300 border-red-500/20',
  offline: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

type ViewMode = 'list' | 'grid';
type SessionRow = Session & { online: boolean };

export default function NodesPage() {
  const { sessions, isLoading: loading } = useSessions();
  const { health } = useHealth();
  const sseMap = health?.sse_sessions || {};
  // SSE keys are `network_id:alias` since server v0.7+. Look up with the
  // composite key first, fall back to alias-only for legacy hubs.
  const sseFor = (s: { alias: string; network_id?: string }) =>
    (s.network_id ? sseMap[`${s.network_id}:${s.alias}`] : undefined) ?? sseMap[s.alias];
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({});
  const [taskOpenFor, setTaskOpenFor] = useState<string | null>(null);
  const [sendState, setSendState] = useState<Record<string, { sending?: boolean; error?: string; success?: string }>>({});
  const [chatAlias, setChatAlias] = useState<string | null>(null);

  const filtered: SessionRow[] = sessions
    .map(s => ({ ...s, online: !!sseFor(s) }))
    .filter(s => {
      if (filterStatus === 'online') return s.online;
      if (filterStatus === 'offline') return !s.online;
      if (filterStatus && filterStatus !== s.status) return false;
      return true;
    })
    .filter(s => !search || s.alias.toLowerCase().includes(search.toLowerCase()) || (s.agent || '').toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.status === 'working' ? 1 : 0) - (a.status === 'working' ? 1 : 0));

  const onlineCount = sessions.filter(s => sseFor(s)).length;

  const openSendTask = (alias: string) => {
    setTaskOpenFor(current => current === alias ? null : alias);
    setSendState(prev => ({ ...prev, [alias]: {} }));
  };

  const updateTaskDraft = (alias: string, value: string) => {
    setTaskDrafts(prev => ({ ...prev, [alias]: value }));
  };

  const sendTask = async (alias: string) => {
    const task = taskDrafts[alias]?.trim() || '';
    if (!task) return;

    setSendState(prev => ({ ...prev, [alias]: { sending: true } }));

    try {
      const res = await fetch('/api/hub/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias, task }),
      });
      const data = await res.json();

      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'Send failed');
      }

      setTaskDrafts(prev => ({ ...prev, [alias]: '' }));
      setSendState(prev => ({ ...prev, [alias]: { success: 'Task sent' } }));
      setTaskOpenFor(null);
    } catch (error: unknown) {
      setSendState(prev => ({
        ...prev,
        [alias]: { error: error instanceof Error ? error.message : 'Send failed' },
      }));
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-white lg:ml-0 ml-10">Nodes</h1>
        <span className="text-xs bg-green-900/30 text-green-400 px-2 py-0.5 rounded-full border border-green-800/30">
          {onlineCount} online
        </span>
        <span className="text-xs bg-gray-900/30 text-gray-400 px-2 py-0.5 rounded-full border border-gray-800/30">
          {sessions.length} total
        </span>
      </div>

      {/* Status bar */}
      {sessions.length > 0 && (() => {
        const working = filtered.filter(s => s.online && s.status === 'working').length;
        const idle = filtered.filter(s => s.online && s.status === 'idle').length;
        const offline = filtered.filter(s => !s.online).length;
        const total = filtered.length || 1;
        return (
          <div className="mb-6">
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
              {working > 0 && <div className="bg-green-500" style={{ width: `${(working/total)*100}%` }} />}
              {idle > 0 && <div className="bg-cyan-500" style={{ width: `${(idle/total)*100}%` }} />}
              {offline > 0 && <div className="bg-gray-600" style={{ width: `${(offline/total)*100}%` }} />}
            </div>
            <div className="flex gap-4 mt-1.5 text-[10px] text-gray-500">
              {working > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />{working} working</span>}
              {idle > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-cyan-500 mr-1" />{idle} idle</span>}
              {offline > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-gray-600 mr-1" />{offline} offline</span>}
            </div>
          </div>
        );
      })()}

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search nodes..."
          className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-blue-500/50 focus:outline-none w-48"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none"
        >
          <option value="">All</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="working">Working</option>
          <option value="idle">Idle</option>
          <option value="blocked">Blocked</option>
          <option value="error">Error</option>
        </select>
        <div className="ml-auto flex rounded-lg border border-[#2a2a4a] bg-[#111128] p-1 text-sm">
          {(['list', 'grid'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                viewMode === mode
                  ? 'bg-cyan-500/10 text-cyan-300'
                  : 'text-gray-500 hover:text-gray-200'
              }`}
            >
              {mode === 'list' ? 'List' : 'Grid'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-800/20 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          variant="nodes"
          title="No nodes match your filters"
          sub="Try clearing search or status filters, or wait for an agent to register."
        />
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(s => {
            const statusKey = s.online ? s.status : 'offline';
            const state = sendState[s.alias] || {};
            const progress = typeof s.progress === 'number' ? s.progress : 0;

            return (
              <div
                key={s.alias}
                className={`relative overflow-hidden rounded-xl border border-[#2a2a4a] bg-[#111128] p-4 transition-colors ${!s.online ? 'opacity-60' : ''}`}
              >
                {!s.online && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="rotate-[-20deg] rounded-xl border border-white/10 bg-black/20 px-5 py-2 text-xl font-bold uppercase tracking-[0.35em] text-white/10">
                      Offline
                    </span>
                  </div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/node?alias=${encodeURIComponent(s.alias)}`} className="min-w-0 flex-1 hover:text-cyan-300">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-white">{s.alias}</span>
                      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${STATUS_COLORS[statusKey] || STATUS_COLORS.offline}`}>
                        {statusKey}
                      </span>
                    </div>
                  </Link>
                  <div className="flex gap-1.5 shrink-0">
                    <button type="button" onClick={() => setChatAlias(s.alias)}
                      className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-xs text-green-300 transition-colors hover:bg-green-500/20">
                      Chat
                    </button>
                    <button type="button" onClick={() => openSendTask(s.alias)}
                      className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-500/20">
                      Task
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-2 text-xs text-gray-500">
                  <div className="flex justify-between gap-3">
                    <span>Agent</span>
                    <span className="truncate text-gray-300">{s.agent || '--'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Server</span>
                    <span className="truncate text-gray-300">{s.server || '--'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Updated</span>
                    <span className="text-gray-300">{timeAgo(s.last_seen_at || s.updated_at)}</span>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-[#1a1a2a] bg-[#0a0a15] px-3 py-2 text-xs text-gray-400">
                  {s.task ? s.task : 'No current task'}
                </div>

                {progress > 0 && progress < 100 && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div className="h-1.5 rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}

                {taskOpenFor === s.alias && (
                  <div className="mt-4 space-y-2 rounded-lg border border-[#2a2a4a] bg-[#0a0a15] p-3">
                    <input
                      type="text"
                      value={taskDrafts[s.alias] || ''}
                      onChange={e => updateTaskDraft(s.alias, e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendTask(s.alias)}
                      placeholder={`Send task to ${s.alias}...`}
                      className="w-full rounded-lg border border-[#2a2a4a] bg-[#050510] px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setTaskOpenFor(null)}
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => sendTask(s.alias)}
                        disabled={state.sending || !(taskDrafts[s.alias] || '').trim()}
                        className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-700"
                      >
                        {state.sending ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                )}

                {state.error && <div className="mt-2 text-xs text-red-400">{state.error}</div>}
                {state.success && taskOpenFor !== s.alias && <div className="mt-2 text-xs text-green-400">{state.success}</div>}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:grid sm:grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase">
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Alias</div>
            <div className="col-span-2">Agent</div>
            <div className="col-span-2">Server</div>
            <div className="col-span-2">Current Task</div>
            <div className="col-span-1">Updated</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {filtered.map(s => {
            const statusKey = s.online ? s.status : 'offline';
            const state = sendState[s.alias] || {};

            return (
              <div
                key={s.alias}
                className={`rounded-lg border border-[#2a2a4a] bg-[#111128] px-4 py-3 transition-colors hover:border-[#3a3a5a] ${!s.online ? 'opacity-50' : ''}`}
              >
                <div className="hidden sm:grid sm:grid-cols-12 gap-2 items-center">
                  <div className="col-span-1">
                    <span className={`text-xs px-2 py-0.5 rounded-md border ${STATUS_COLORS[statusKey] || STATUS_COLORS.offline}`}>
                      {statusKey}
                    </span>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <Link href={`/node?alias=${encodeURIComponent(s.alias)}`} className="truncate text-sm font-medium text-white hover:text-cyan-300">
                      {s.alias}
                    </Link>
                  </div>
                  <div className="col-span-2 truncate text-xs text-gray-400">{s.agent || '--'}</div>
                  <div className="col-span-2 truncate text-xs text-gray-400">{s.server || '--'}</div>
                  <div className="col-span-2 truncate text-xs text-gray-500">{s.task || '--'}</div>
                  <div className="col-span-1 text-xs text-gray-500">{timeAgo(s.last_seen_at || s.updated_at)}</div>
                  <div className="col-span-2 flex justify-end gap-1.5">
                    <button type="button" onClick={() => setChatAlias(s.alias)}
                      className="rounded-lg border border-green-500/20 bg-green-500/10 px-2 py-1 text-xs text-green-300 hover:bg-green-500/20">
                      Chat
                    </button>
                    <button type="button" onClick={() => openSendTask(s.alias)}
                      className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/20">
                      Task
                    </button>
                  </div>
                </div>
                <div className="sm:hidden space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/node?alias=${encodeURIComponent(s.alias)}`} className="truncate text-sm font-medium text-white hover:text-cyan-300">
                      {s.alias}
                    </Link>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-md border ${STATUS_COLORS[statusKey] || STATUS_COLORS.offline}`}>
                      {statusKey}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">{s.agent || '--'} · {timeAgo(s.last_seen_at || s.updated_at)}</div>
                  {s.task && <div className="truncate text-xs text-gray-500">{s.task}</div>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setChatAlias(s.alias)}
                      className="flex-1 rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-xs text-green-300 hover:bg-green-500/20">
                      Chat
                    </button>
                    <button type="button" onClick={() => openSendTask(s.alias)}
                      className="flex-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-500/20">
                      Send Task
                    </button>
                  </div>
                </div>

                {taskOpenFor === s.alias && (
                  <div className="mt-3 space-y-2 border-t border-[#2a2a4a] pt-3">
                    <input
                      type="text"
                      value={taskDrafts[s.alias] || ''}
                      onChange={e => updateTaskDraft(s.alias, e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendTask(s.alias)}
                      placeholder={`Send task to ${s.alias}...`}
                      className="w-full rounded-lg border border-[#2a2a4a] bg-[#0a0a15] px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setTaskOpenFor(null)}
                        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => sendTask(s.alias)}
                        disabled={state.sending || !(taskDrafts[s.alias] || '').trim()}
                        className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-gray-700"
                      >
                        {state.sending ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </div>
                )}

                {state.error && <div className="mt-2 text-xs text-red-400">{state.error}</div>}
                {state.success && taskOpenFor !== s.alias && <div className="mt-2 text-xs text-green-400">{state.success}</div>}
              </div>
            );
          })}
        </div>
      )}

      {chatAlias && <TaskChatPanel alias={chatAlias} onClose={() => setChatAlias(null)} />}
    </div>
  );
}
