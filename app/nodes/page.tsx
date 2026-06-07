'use client';

import { useState } from 'react';
import { timeAgo } from '../components/utils';
import { useSessions, useHealth } from '../lib/hooks';
import { TaskChatPanel } from '../components/TaskChatPanel';
import { EmptyState, NodesEmptyState } from '../components/EmptyState';
import { AliasAvatar } from '../components/AliasAvatar';
import type { Session } from '../components/types';
import { SESSION_STATUS_CHIP_CLASS as STATUS_COLORS } from '../lib/status';
import { useChatUnread } from '../lib/chat-unread';

/** Round 81: shorten long server hostnames (Alibaba `iZ…oyZ` style)
 *  for table display. Returns the original string unchanged when ≤12
 *  chars. Full value should stay in `title=` for hover + screen-readers. */
function shortServer(server: string | null | undefined): string {
  if (!server) return '—';
  return server.length > 12 ? `${server.slice(0, 8)}…` : server;
}

type ViewMode = 'list' | 'grid';
type SessionRow = Session & { online: boolean };

export default function NodesPage() {
  const { sessions, isLoading: loading } = useSessions();
  const { health } = useHealth();
  const { hasUnread } = useChatUnread();
  const sseMap = health?.sse_sessions || {};
  // SSE keys are `network_id:alias` since server v0.7+. Look up with the
  // composite key first, fall back to alias-only for legacy hubs.
  const sseFor = (s: { alias: string; network_id?: string }) =>
    (s.network_id ? sseMap[`${s.network_id}:${s.alias}`] : undefined) ?? sseMap[s.alias];
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
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

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
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

      {/* Round 74: hide the filter+view chrome when there are no nodes
          anywhere — these controls have nothing to act on, and they only
          push the onboarding CTA further down. When at least one session
          exists, the chrome is back even if the current filter happens
          to hide everything (so users can clear filters). */}
      {sessions.length > 0 && (
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search nodes..."
          className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-base sm:text-sm text-white placeholder-gray-600 focus:border-blue-500/50 focus:outline-none w-full sm:w-48"
        />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:border-blue-500/50 focus:outline-none"
        >
          <option value="">All</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="working">Working</option>
          <option value="idle">Idle</option>
          <option value="blocked">Blocked</option>
          <option value="error">Error</option>
        </select>
        {/* Round 80: List/Grid toggle hidden on mobile — Grid uses
            grid-cols-1 below `md` and List degrades to the same single
            column, so the toggle has no visual effect under sm and only
            steals a row of vertical space. */}
        <div className="hidden sm:flex ml-auto rounded-lg border border-[#2a2a4a] bg-[#111128] p-1 text-sm">
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
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-800/20 rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        sessions.length === 0 ? (
          /* Round 73: first-run case — no agents anywhere. Use the same
             onboarding empty state as the Overview (NodesEmptyState
             includes the `npx … init` quickstart command). Previously this
             was the "No nodes match your filters" copy, which was wrong
             for new users who have no filters applied. */
          <NodesEmptyState />
        ) : (
          <EmptyState
            variant="nodes"
            title="No nodes match your filters"
            sub="Try clearing search or status filters, or wait for an agent to register."
          />
        )
      ) : viewMode === 'grid' ? (
        <div className="grid min-w-0 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(s => {
            const statusKey = s.online ? s.status : 'offline';
            const progress = typeof s.progress === 'number' ? s.progress : 0;
            const unread = hasUnread(s.alias);

            return (
              <div
                key={s.alias}
                role="button"
                tabIndex={0}
                onClick={() => setChatAlias(s.alias)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChatAlias(s.alias); } }}
                className={`relative min-w-0 max-w-full overflow-hidden rounded-xl border border-[#2a2a4a] bg-[#111128] p-4 transition-colors hover:border-cyan-500/40 cursor-pointer ${!s.online ? 'opacity-60' : ''}`}
              >
                {!s.online && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="rotate-[-20deg] rounded-xl border border-white/10 bg-black/20 px-5 py-2 text-xl font-bold uppercase tracking-[0.35em] text-white/10">
                      Offline
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    <AliasAvatar alias={s.alias} size={36} />
                    {unread && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#111128] bg-red-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-white">{s.alias}</span>
                      {unread && <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-300">New</span>}
                      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_COLORS[statusKey] || STATUS_COLORS.offline}`}>
                        {statusKey}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-500">
                      {(s.agent || '—')}<span className="text-gray-700 mx-1.5">·</span><span title={s.server || ''}>{shortServer(s.server)}</span>
                    </div>
                  </div>
                  <span className="hidden shrink-0 rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-2 py-1 text-[10px] text-cyan-300/70 sm:inline">Tap to chat</span>
                </div>

                <div className="mt-3 rounded-lg border border-[#1a1a2a] bg-[#0a0a15] px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] uppercase tracking-wide text-gray-600">Current task</span>
                    <span className="text-[10px] text-gray-600">{timeAgo(s.last_seen_at || s.updated_at)}</span>
                  </div>
                  <div className={`mt-1 line-clamp-2 ${s.task ? 'text-gray-300' : 'text-gray-600 italic'}`}>
                    {s.task || 'No current task'}
                  </div>
                </div>

                {progress > 0 && progress < 100 && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
                    <div className="h-1.5 rounded-full bg-cyan-400 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                )}

              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1 sm:space-y-2">
          {/* Round 94: AGENT + SERVER merged into one `agent · server`
              cell. Round mobile-command: node row itself opens chat, so
              the old Chat / Send Task action column is gone. */}
          <div className="hidden sm:grid sm:grid-cols-10 gap-2 px-4 py-2 text-xs text-gray-600 uppercase">
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Alias</div>
            <div className="col-span-2">Agent · Server</div>
            <div className="col-span-4">Current Task</div>
            <div className="col-span-1">Updated</div>
          </div>
          {filtered.map(s => {
            const statusKey = s.online ? s.status : 'offline';
            const unread = hasUnread(s.alias);

            return (
              <div
                key={s.alias}
                role="button"
                tabIndex={0}
                onClick={() => setChatAlias(s.alias)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChatAlias(s.alias); } }}
                className={`rounded-lg border border-[#2a2a4a] bg-[#111128] px-3 py-2 sm:px-4 sm:py-3 transition-colors hover:border-cyan-500/40 cursor-pointer ${!s.online ? 'opacity-50' : ''}`}
              >
                <div className="hidden sm:grid sm:grid-cols-10 gap-2 items-center">
                  <div className="col-span-1">
                    <span className={`text-xs px-2 py-0.5 rounded-md border ${STATUS_COLORS[statusKey] || STATUS_COLORS.offline}`}>
                      {statusKey}
                    </span>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="relative shrink-0">
                        <AliasAvatar alias={s.alias} size={20} />
                        {unread && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[#111128] bg-red-500" />}
                      </div>
                      <span className="truncate text-sm font-medium text-white">{s.alias}</span>
                      {unread && <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300">New</span>}
                    </div>
                  </div>
                  <div className="col-span-2 truncate text-xs text-gray-400" title={s.server || ''}>
                    <span className="truncate">{s.agent || '--'}<span className="text-gray-700 mx-1.5">·</span>{shortServer(s.server)}</span>
                  </div>
                  <div className="col-span-4 truncate text-xs text-gray-500" title={s.task || ''}>{s.task || '--'}</div>
                  <div className="col-span-1 text-xs text-gray-500">{timeAgo(s.last_seen_at || s.updated_at)}</div>
                </div>
                {/* R7 of #190: mobile node row was ~340px tall × ~150
                    rows = the 51k page. Wins this round, in priority
                    order: (1) drop the per-row "Tap anywhere to chat"
                    hint — useful once, redundant 149 times; the cyan
                    border on hover/focus still teaches it. (2) tighten
                    space-y-2 → space-y-1 so the avatar/task gap is
                    4px tighter on every row. */}
                <div className="sm:hidden space-y-1">
                  <div className="flex items-center gap-2.5">
                    <div className="relative shrink-0">
                      <AliasAvatar alias={s.alias} size={28} />
                      {unread && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#111128] bg-red-500" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="truncate text-sm font-medium text-white">{s.alias}</div>
                        {unread && <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300">New</span>}
                      </div>
                      <div className="truncate text-[10px] text-gray-500">{s.agent || '—'} · {timeAgo(s.last_seen_at || s.updated_at)}</div>
                    </div>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-md border ${STATUS_COLORS[statusKey] || STATUS_COLORS.offline}`}>
                      {statusKey}
                    </span>
                  </div>
                  {s.task && <div className="truncate text-xs text-gray-500">{s.task}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {chatAlias && <TaskChatPanel alias={chatAlias} onClose={() => setChatAlias(null)} />}
    </div>
  );
}
