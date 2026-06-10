'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatsBar } from './components/StatsBar';
import { TopoGraph } from './components/TopoGraph';
import { AgentCard } from './components/AgentCard';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { NodesEmptyState as EmptyState } from './components/EmptyState';
import { CommandCenter, useCommandCenter } from './components/CommandCenter';
import { useSessions, useHealth, useTasks, useStats } from './lib/hooks';
import { useSSE } from './lib/useSSE';
import { useSWRConfig } from 'swr';

export default function Dashboard() {
  // #214 F1: the old "V3 auto-upgrade" guard here checked per-tab
  // sessionStorage and, when empty (every new tab / browser restart /
  // bookmark visit), logged out the *valid* cookie session and bounced
  // to /login. Unauthenticated access is already handled server-side
  // by proxy.ts (no cookie → /login); the sessionStorage blob is just
  // a client cache that pages re-hydrate on demand. A genuinely stale
  // pre-V3 cookie now surfaces as API 401s with the error banner
  // instead of silent session destruction.

  const { sessions, hint: sessHint, error: sessError, isLoading } = useSessions();
  const { health } = useHealth();
  const { tasks } = useTasks({ limit: '500' });
  const { stats } = useStats();
  const [showTopo, setShowTopo] = useState(typeof window !== 'undefined' && window.innerWidth >= 1024);
  const cmd = useCommandCenter();
  const [agentFilter, setAgentFilter] = useState<'all' | 'working' | 'idle' | 'offline'>('all');
  // #84: last node.renamed event — passed to TopoGraph so an open chat
  // popover follows the rename instead of pointing at a dead alias. `ts`
  // makes the effect re-fire even when the same from/to repeats.
  const [renameSignal, setRenameSignal] = useState<{ from: string; to: string; ts: number } | null>(null);
  const { mutate } = useSWRConfig();

  // SSE: instant revalidation on CommHub events
  // Opt-out via NEXT_PUBLIC_DISABLE_SSE=1 — avoids HTTP/1.1 head-of-line blocking on navigation
  const sseEnabled = process.env.NEXT_PUBLIC_DISABLE_SSE !== '1';
  const { connected: sseConnected, supported: sseSupported } = useSSE({
    url: '/api/hub/events',
    enabled: sseEnabled,
    onEvent: (event) => {
      // #84 (RFC-010 §3.4): node.renamed — revalidate the session list so the
      // new alias propagates instantly (TopoGraph + node grid re-render, the
      // avatar hue recomputes as a pure fn of alias) instead of waiting for
      // the next 5s poll. The renamed node's history keeps the old alias
      // server-side, so the task list needs no revalidation here.
      if (event.type === 'node.renamed') {
        mutate('/api/hub/status');
        const d = event.data as { old_alias?: string; new_alias?: string } | undefined;
        if (d?.old_alias && d?.new_alias) {
          setRenameSignal({ from: d.old_alias, to: d.new_alias, ts: Date.now() });
        }
        return;
      }
      if (['new_task', 'new_message', 'new_reply', 'node_status_changed', 'broadcast'].includes(event.type)) {
        mutate('/api/hub/status');
        mutate((key: string) => typeof key === 'string' && key.startsWith('/api/hub/tasks'), undefined, { revalidate: true });
      }
    },
  });

  if (isLoading) return <LoadingSkeleton />;

  const sseSessions = health?.sse_sessions || {};
  // SSE keys are `network_id:alias` since v0.7+ (per-network scoping).
  // Fall back to alias-only for legacy hubs.
  const sseLookup = (s: { alias: string; network_id?: string }) =>
    (s.network_id ? sseSessions[`${s.network_id}:${s.alias}`] : undefined) ?? sseSessions[s.alias];
  // #214 F2: online = SSE-reachable ("can I talk to it right now").
  // The old definition (status !== 'offline' OR sse) inflated the count
  // with stale hub statuses and disagreed with /admin and /nodes, which
  // both count pure SSE — and a "online" card you can't chat with
  // contradicts the M2 tap-to-chat model. One definition everywhere.
  const isOnline = (s: { alias: string; status: string; network_id?: string }) => !!sseLookup(s);
  const online = sessions.filter(isOnline).length;
  const total = sessions.length;
  const working = sessions.filter(s => s.status === 'working').length;
  // Task stats: prefer /api/stats, fallback to manual
  const taskStats: Record<string, number> = {};
  if (stats?.tasks?.by_status?.length) {
    for (const s of stats.tasks.by_status) {
      taskStats[s.status] = s.count;
    }
  } else {
    for (const t of tasks) {
      taskStats[t.status] = (taskStats[t.status] || 0) + 1;
    }
  }

  const sortedSessions = [...sessions].sort((a, b) => {
    const aOnline = isOnline(a) ? 1 : 0;
    const bOnline = isOnline(b) ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    const aWorking = a.status === 'working' ? 1 : 0;
    const bWorking = b.status === 'working' ? 1 : 0;
    return bWorking - aWorking;
  });

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-gray-100 p-4 sm:p-6">
      <StatsBar online={online} working={working} total={total} />

      {/* #217 S5 (Vincent: "极简极简，这些都可以放到设置里面去"): the
          Dispatch button and UserBar row are gone from Overview.
          Dispatch lives in /admin (Send Task panel); sign-out lives in
          Settings and the sidebar; network switching lives in the
          sidebar. */}

      {/* Task summary. #217 S5 (Vincent: "乱七八糟的东西太多"): the
          9-status colored chip wall is now a single quiet line — the
          only two numbers that drive action are running and failed;
          everything else lives on /tasks. */}
      {Object.keys(taskStats).length > 0 && (
        <section className="mb-4 sm:mb-6 flex items-center justify-between rounded-lg border border-[#26262b] bg-[#161618] px-4 py-2.5 text-xs">
          <div className="text-gray-400 tabular-nums">
            <span className={taskStats['running'] ? 'text-green-400' : 'text-gray-500'}>{taskStats['running'] || 0} running</span>
            <span className="text-gray-600"> &middot; </span>
            <span className={taskStats['failed'] ? 'text-red-400' : 'text-gray-500'}>{taskStats['failed'] || 0} failed</span>
          </div>
          <Link href="/tasks" prefetch={false} className="text-cyan-400 hover:text-cyan-300">View all &rarr;</Link>
        </section>
      )}

      {/* #217 S5 (less is more): Quick Navigation stat cards, the nav
          rail, and Recent Activity are deleted. Every route they linked
          to is one tap away in the bottom tab bar (mobile) or sidebar
          (desktop), the headline numbers already live in the KPI cards
          and the task summary line, and recent tasks live on /tasks.
          Restore path: git revert this commit. */}

      {sessError && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded-lg mb-6 text-sm flex items-center justify-between" role="alert">
          <span>{String(sessError)}</span>
          <span className="text-gray-500 text-xs">Check CommHub connection</span>
        </div>
      )}

      {/* #217 M1: topology toggle is lg-only — on a 390px phone the
          graph needed a 70vh cap (R41) just to stay scrollable, i.e.
          it never really worked there. Desktop keeps the full feature;
          mobile Overview loses its last piece of chrome. */}
      {sessions.length > 0 && (
        <div className="hidden lg:flex justify-center mb-4">
          <button
            onClick={() => setShowTopo(!showTopo)}
            className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700/50 px-4 py-1.5 rounded-lg transition-colors hover:border-gray-600 cursor-pointer"
          >
            {showTopo ? 'Hide Topology' : 'Show Topology'}
          </button>
        </div>
      )}

      {showTopo && sessions.length > 0 && (
        // #209 R41: mobile-only soft cap on the rendered TopoGraph.
        // Default behaviour on desktop is unchanged (lg: drops the cap
        // entirely). On phones the SVG card was free to claim ~600+ px
        // of vertical real-estate, which on a 667-844 px viewport meant
        // tapping "Show Topology" pushed the agent grid completely off
        // screen. Capping to 70 vh with overflow-y-auto keeps the graph
        // interactive (the SVG already does its own pan + zoom inside
        // the viewport) while letting the page below stay reachable
        // with a single ordinary scroll past the cap.
        <div className="lg:max-h-none lg:overflow-visible max-h-[70vh] overflow-y-auto rounded-xl border border-transparent lg:border-0">
          <TopoGraph sessions={sessions} sseSessions={sseSessions} renameSignal={renameSignal} />
        </div>
      )}

      {sessions.length === 0 && !sessError ? (
        <EmptyState
          hint={sessHint}
          taskHistoryCount={Object.values(taskStats).reduce((a, b) => a + b, 0)}
        />
      ) : (() => {
        const counts = {
          all: sortedSessions.length,
          working: sortedSessions.filter(s => isOnline(s) && s.status === 'working').length,
          idle: sortedSessions.filter(s => isOnline(s) && s.status !== 'working').length,
          offline: sortedSessions.filter(s => !isOnline(s)).length,
        };
        const filtered = sortedSessions.filter(s => {
          if (agentFilter === 'all') return true;
          if (agentFilter === 'offline') return !isOnline(s);
          if (agentFilter === 'working') return isOnline(s) && s.status === 'working';
          if (agentFilter === 'idle') return isOnline(s) && s.status !== 'working';
          return true;
        });
        // Filter chip color keyed to status (round 34): working=green, idle=cyan,
        // offline=gray, all=neutral. Inline hex dots avoid Tailwind v4 purge.
        const chips: { key: typeof agentFilter; label: string; dot?: string }[] = [
          { key: 'all',     label: 'All' },
          { key: 'working', label: 'Working', dot: '#4ade80' },
          { key: 'idle',    label: 'Idle',    dot: '#22d3ee' },
          { key: 'offline', label: 'Offline', dot: '#6b7280' },
        ];
        return (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1">
              {chips.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setAgentFilter(c.key)}
                  disabled={counts[c.key] === 0 && c.key !== 'all'}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                    agentFilter === c.key
                      ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
                      : 'text-gray-500 hover:text-gray-200 hover:bg-[#1c1c1f] border border-transparent'
                  }`}
                >
                  {c.dot && <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />}
                  {/* #217 D5: counts dropped — the KPI cards directly above
                      already carry 53/100/153; repeating them here doubled
                      every number on the first screen. */}
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
            {/* Round 48: previous breakpoints had `lg:grid-cols-2 xl:grid-cols-3`
                which kept lg (1024-1279px) at only 2 columns even though
                each AgentCard is fine ≥260px wide. With the sidebar (208px),
                main area at lg is ~816px so 3 cols at ~272px each fits.
                xl breakpoint auto-inherits lg=3 cols; 2xl bumps to 4. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4">
              {filtered.map(s => (
                <AgentCard key={s.alias} session={s} hasSse={isOnline(s)} sseCount={sseLookup(s) || 0} onChat={cmd.openTab} />
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="mt-4 text-center text-xs text-gray-600">
                No agents match "{agentFilter}" — <button onClick={() => setAgentFilter('all')} className="underline hover:text-gray-400">Show all</button>
              </div>
            )}
          </>
        );
      })()}

      {/* Round 111 (issue #82): dropped the license badge — "trial (12d
          left)" read like a paywall countdown on an open-source dashboard
          and Vincent flagged it as misleading more than once. The SSE /
          polling dot stays: it's a real connection-status indicator, not
          a sales surface. */}
      <div className="mt-8 text-center text-xs text-gray-600 flex items-center justify-center gap-2 flex-wrap">
        {sseSupported && (
          <>
            <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? 'bg-green-400' : 'bg-gray-600'}`} />
            {sseConnected ? 'SSE live' : 'SWR polling'}
          </>
        )}
      </div>

      {/* Command Center (multi-tab chat) */}
      {cmd.tabs.length > 0 && (
        <CommandCenter
          tabs={cmd.tabs}
          activeTab={cmd.activeTab}
          onOpenTab={cmd.openTab}
          onCloseTab={cmd.closeTab}
          onSetActive={cmd.setActiveTab}
          onClose={cmd.closeAll}
        />
      )}
    </div>
  );
}
