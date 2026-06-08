'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatUptime, previewContent } from './components/utils';
import { StatsBar } from './components/StatsBar';
import { TopoGraph } from './components/TopoGraph';
import { AgentCard } from './components/AgentCard';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { NodesEmptyState as EmptyState } from './components/EmptyState';
import { AliasAvatar } from './components/AliasAvatar';
import { STATUS_DOT_HEX, STATUS_CHIP_CLASS } from './lib/status';
import { UserBar } from './components/UserBar';
import { CommandCenter, useCommandCenter } from './components/CommandCenter';
import { DispatchPanel } from './components/DispatchPanel';
import { useSessions, useHealth, useAnetConfig, useTasks, useStats } from './lib/hooks';
import { useSSE } from './lib/useSSE';
import { useSWRConfig } from 'swr';

export default function Dashboard() {
  // Auto-upgrade: if no V3 auth in session, force re-login to get user token
  useEffect(() => {
    const hasV3 = sessionStorage.getItem('anet_v3_auth');
    if (!hasV3) {
      // Try silent re-auth: logout old cookie + redirect to login
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      window.location.assign('/login');
    }
  }, []);

  const { sessions, hint: sessHint, error: sessError, isLoading } = useSessions();
  const { health } = useHealth();
  const { config: anetConfig } = useAnetConfig();
  const { tasks } = useTasks({ limit: '500' });
  const { stats } = useStats();
  const [showTopo, setShowTopo] = useState(typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [showConfig, setShowConfig] = useState(false);
  const cmd = useCommandCenter();
  const [showDispatch, setShowDispatch] = useState(false);
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
  // Online = status is not 'offline' (not just SSE-connected)
  const isOnline = (s: { alias: string; status: string; network_id?: string }) => s.status !== 'offline' || !!sseLookup(s);
  const online = sessions.filter(isOnline).length;
  const total = sessions.length;
  const working = sessions.filter(s => s.status === 'working').length;
  const uptime = health ? formatUptime(health.uptime) : '--';
  const version = health?.version || '--';
  const configHealthy = Boolean(anetConfig?.hub && anetConfig.tokenConfigured);
  const configSourceLabel =
    anetConfig?.source === 'file' ? 'Local config'
    : anetConfig?.source === 'runtime-env' ? 'Runtime env'
    : 'Config missing';

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

  /** Round 70: when the fleet is empty, the Overview reorders to lead with
   *  the "Spin up your first agent" CTA and hides the Quick Navigation /
   *  Nav rail / Broadcast bar that would otherwise occupy prime real estate
   *  with zeros and dead-end links. Computed once, used as a gate below. */
  const fleetEmpty = sessions.length === 0 && !sessError;

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <div className="lg:ml-0 ml-10">
        <StatsBar online={online} working={working} total={total} version={version} uptime={uptime} />
      </div>

      {/* Dispatch + User Bar — Dispatch hidden when fleet empty (nothing to
          dispatch to); UserBar still useful (account/sign-out menu). */}
      <div className="flex items-center gap-3 mb-4">
        {!fleetEmpty && (
          <button onClick={() => setShowDispatch(true)}
            className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-cyan-500/10 transition-all active:scale-95 shrink-0">
            ⚡ Dispatch
          </button>
        )}
        <div className="flex-1"><UserBar /></div>
      </div>

      {/* anet config (collapsed by default).
          #209 R28 (mobile vertical rhythm — goal "大幅提升移动端体验"):
          this + Task Status + Nav rail + Recent Activity all drop their
          24 px (mb-6) section gap to 16 px (mb-4) on phones, restoring
          mb-6 from sm: up. Overview on mobile stacks 5-7 sections above
          the agent grid; tightening 4 of those gaps reclaims ~32 px of
          scroll. No content removed, no feature changed — desktop is
          identical. */}
      <section className="mb-4 sm:mb-6 rounded-lg border border-[#2a2a4a] bg-[#111128] px-4 py-3 shadow-lg shadow-black/20">
        <button onClick={() => setShowConfig(!showConfig)} className="w-full flex items-center justify-between text-left">
          <div className="flex items-center gap-2 text-xs">
            <span className="uppercase text-gray-600">Config</span>
            <span className={`w-2 h-2 rounded-full ${configHealthy ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-gray-500">{configSourceLabel}</span>
          </div>
          <svg className={`w-4 h-4 text-gray-600 transition-transform ${showConfig ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showConfig && (
          <div className="mt-3 pt-3 border-t border-[#2a2a4a]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-gray-100 truncate text-sm" title={anetConfig?.hub || undefined}>
                  Hub: <span className={anetConfig?.hub ? 'text-cyan-300' : 'text-red-300'}>{anetConfig?.hub?.trim() || 'not configured'}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`px-2.5 py-1 rounded-md border ${anetConfig?.tokenConfigured ? 'bg-blue-500/5 text-blue-300 border-blue-500/20' : 'bg-gray-500/5 text-gray-400 border-gray-500/20'}`}>
                  Token: {anetConfig?.tokenPreview || 'not configured'}
                </span>
              </div>
            </div>
            {anetConfig?.error && <div className="mt-2 text-xs text-gray-600">{anetConfig.error}</div>}
          </div>
        )}
      </section>

      {/* Task Status Stats */}
      {Object.keys(taskStats).length > 0 && (
        <section className="mb-4 sm:mb-6 rounded-lg border border-[#2a2a4a] bg-[#111128] px-4 py-3 shadow-lg shadow-black/20">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase text-gray-600">Task Status</div>
            <Link href="/tasks" prefetch={false} className="text-xs text-cyan-400 hover:text-cyan-300">View all &rarr;</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Round 69: order is "hot first" — active flow before terminal
                states — intentionally different from the lifecycle order on
                /tasks. Colors come from shared STATUS_CHIP_CLASS so a
                palette tweak in app/lib/status.ts updates here too.
                'created' added in r69 (was missing — enum-coverage bug). */}
            {(['running', 'delivered', 'acked', 'replied', 'created', 'failed', 'cancelled', 'expired', 'closed'] as const)
              .filter((key) => taskStats[key])
              .map((key) => (
                <Link key={key} href={`/tasks?status=${key}`} prefetch={false} className={`px-2.5 py-1 rounded-md border text-xs ${STATUS_CHIP_CLASS[key]} hover:opacity-80 transition-opacity`}>
                  {key}: {taskStats[key]}
                </Link>
              ))}
          </div>
        </section>
      )}

      {/* Quick Actions — split into two distinct intents:
          (1) Top: live stat cards (carry data, drill-in on click)
          (2) Bottom: pure nav rail (no number, icon + label)
          Round 24 — wrap both in a labelled block so the rhythm reads as
          "here are the main jumps" instead of two disconnected strips.
          Round 70 — entire Quick Nav + Nav rail + Broadcast + Recent
          Activity block is hidden when the fleet is empty so the
          onboarding CTA gets the page above the fold. */}
      {!fleetEmpty && <>
      <div className="text-[10px] uppercase tracking-[0.12em] text-gray-600 mb-2">Quick navigation</div>
      <section className="mb-3 grid grid-cols-3 gap-2 sm:gap-3">
        {(() => {
          // Build breakdown popover content per card. Pure data — pure CSS
          // popover (no JS state) wires the hover-show transition below.
          const idleCount = sessions.filter(s => isOnline(s) && s.status !== 'working').length;
          const offlineCount = total - online;
          const orderedStatuses = ['running', 'replied', 'failed', 'cancelled', 'expired', 'closed', 'created', 'delivered', 'acked'];
          const failedRecent = tasks.filter((t: { status: string }) => t.status === 'failed').length;

          const cards = [
            {
              href: '/nodes', label: 'Nodes',
              value: `${online}/${total}`,
              sub: `${total > 0 ? Math.round((online / total) * 100) : 0}% online`,
              color: 'text-green-400 border-green-500/20',
              popover: total === 0 ? null : [
                { k: 'working', v: working, dot: '', color: '#4ade80' },
                { k: 'idle', v: idleCount, dot: '', color: '#22d3ee' },
                { k: 'offline', v: offlineCount, dot: '', color: '#9ca3af' },
              ],
            },
            {
              href: '/tasks', label: 'Tasks',
              value: String(Object.values(taskStats).reduce((a, b) => a + b, 0) || 0),
              sub: 'all-time',
              color: 'text-cyan-400 border-cyan-500/20',
              popover: Object.keys(taskStats).length === 0 ? null
                : orderedStatuses
                    .filter(s => taskStats[s])
                    .map(s => {
                      // Inline hex avoids Tailwind purging dynamic
                      // `bg-${color}-400` class names.
                      const hex = ({
                        running:   '#4ade80', replied:   '#a78bfa', failed:    '#f87171',
                        cancelled: '#facc15', expired:   '#fb923c', closed:    '#9ca3af',
                        created:   '#9ca3af', delivered: '#60a5fa', acked:     '#22d3ee',
                      } as Record<string, string>)[s] || '#9ca3af';
                      return { k: s, v: taskStats[s], dot: '', color: hex };
                    }),
            },
            {
              href: '/tasks?status=failed', label: 'Failed',
              value: String(taskStats['failed'] || 0),
              sub: taskStats['failed'] ? 'needs review' : 'none',
              color: taskStats['failed'] ? 'text-red-400 border-red-500/25' : 'text-gray-500 border-gray-700/30',
              popover: !failedRecent ? [{ k: 'no failures yet', v: '', dot: '', color: '#4b5563' }]
                : [{ k: `${failedRecent} in current view`, v: '', dot: '', color: '#f87171' }],
            },
          ];

          return cards.map(a => (
            <Link
              key={a.href}
              href={a.href}
              prefetch={false}
              className={`anet-stat-link group relative rounded-xl border ${a.color} bg-[#111128] px-3 py-3 transition-all hover:-translate-y-px`}
            >
              <div className="flex items-baseline justify-between">
                <div className={`text-xl font-semibold tabular-nums ${a.color.split(' ')[0]}`}>{a.value}</div>
                <div className="hidden sm:block text-[10px] text-gray-600 group-hover:text-gray-400 transition-colors">View →</div>
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">{a.label}</div>
              <div className="text-[10px] text-gray-600 mt-px">{a.sub}</div>

              {/* Hover popover — CSS-only, restrained. Hidden on touch
                  (no :hover) so mobile is unaffected. Positioned just
                  below the card so it doesn't fight nav rail. */}
              {a.popover && a.popover.length > 0 && (
                <div className="anet-stat-popover hidden md:block pointer-events-none absolute left-2 right-2 top-full mt-1 z-20 rounded-lg border border-[#2a2a4a] bg-[#0d0d1a] shadow-lg shadow-black/30 px-3 py-2 opacity-0 translate-y-[-2px] group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 delay-100">
                  <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Breakdown</div>
                  <ul className="space-y-1">
                    {a.popover.map(row => (
                      <li key={row.k} className="flex items-center gap-2 text-[11px]">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: row.color }}
                          aria-hidden
                        />
                        <span className="text-gray-400 capitalize">{row.k}</span>
                        {row.v !== '' && <span className="ml-auto text-gray-300 tabular-nums font-medium">{row.v}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Link>
          ));
        })()}
      </section>

      {/* Nav rail — pure navigation, icon + label, no data */}
      <section className="mb-4 sm:mb-6 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { href: '/messages', label: 'Messages', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z' },
          { href: '/logs', label: 'Audit log', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8' },
          { href: '/admin', label: 'Admin', icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2' },
        ].map(a => (
          <Link key={a.href} href={a.href} prefetch={false}
            className="anet-nav-tile flex items-center justify-center gap-2 rounded-xl border border-[#2a2a4a] bg-[#111128] px-3 py-2.5 text-[12px] text-gray-400 hover:text-gray-200 transition-colors">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d={a.icon} />
            </svg>
            <span>{a.label}</span>
          </Link>
        ))}
      </section>

      {/* Recent Activity */}
      {tasks.length > 0 && (
        <section className="mb-4 sm:mb-6 bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300">Recent Activity</h2>
            <Link href="/tasks" className="text-xs text-cyan-400 hover:text-cyan-300">All tasks &rarr;</Link>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {tasks.slice(0, 5).map((t: { task_id: string; from_name: string; to_name: string; status: string; content: string; created_at: string }) => (
              <div key={t.task_id} className="flex items-center gap-2 text-xs">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_DOT_HEX[t.status] || '#6b7280' }}
                />
                {t.from_name && <AliasAvatar alias={t.from_name} size={14} />}
                <span className="text-gray-300 shrink-0 max-w-[20%] truncate">{t.from_name || '?'}</span>
                <span className="text-gray-600">&rarr;</span>
                {t.to_name && <AliasAvatar alias={t.to_name} size={14} />}
                <span className="text-gray-300 shrink-0 max-w-[20%] truncate">{t.to_name || '?'}</span>
                <span className="text-gray-500 truncate flex-1" title={t.content || ''}>{previewContent(t.content).slice(0, 60)}</span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${
                  STATUS_CHIP_CLASS[t.status] || 'text-gray-500 border-gray-700/30'
                }`}>{t.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      </>}

      {sessError && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-3 rounded-lg mb-6 text-sm flex items-center justify-between" role="alert">
          <span>{String(sessError)}</span>
          <span className="text-gray-500 text-xs">Check CommHub connection</span>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="flex justify-center mb-4">
          <button
            onClick={() => setShowTopo(!showTopo)}
            className="text-xs text-gray-500 hover:text-gray-300 border border-gray-700/50 px-4 py-1.5 rounded-lg transition-colors hover:border-gray-600 cursor-pointer"
          >
            {showTopo ? 'Hide Topology' : 'Show Topology'}
          </button>
        </div>
      )}

      {/* Mobile hint when topo hidden */}
      {!showTopo && sessions.length > 0 && (
        <div className="lg:hidden text-center text-xs text-gray-600 mb-4">
          Topology hidden on mobile for better readability
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
                      : 'text-gray-500 hover:text-gray-200 hover:bg-[#1a1a2a] border border-transparent'
                  }`}
                >
                  {c.dot && <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.dot }} />}
                  <span>{c.label}</span>
                  <span className={`text-[10px] tabular-nums ${agentFilter === c.key ? 'text-cyan-400' : 'text-gray-600'}`}>{counts[c.key]}</span>
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

      {/* Dispatch Panel */}
      {showDispatch && <DispatchPanel sessions={sessions} onClose={() => setShowDispatch(false)} />}

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
