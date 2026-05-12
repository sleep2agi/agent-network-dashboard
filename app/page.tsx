'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatUptime } from './components/utils';
import { StatsBar } from './components/StatsBar';
import { BroadcastBar } from './components/BroadcastBar';
import { TopoGraph } from './components/TopoGraph';
import { AgentCard } from './components/AgentCard';
import { InboxPanel } from './components/InboxPanel';
import { LoadingSkeleton, EmptyState } from './components/LoadingSkeleton';
import { UserBar } from './components/UserBar';
import { CommandCenter, useCommandCenter } from './components/CommandCenter';
import { DispatchPanel } from './components/DispatchPanel';
import { useSessions, useHealth, useAnetConfig, useTasks, useStats, useLicense } from './lib/hooks';
import { useSSE } from './lib/useSSE';
import { InboxMessage } from './components/types';
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
  const { license: licData } = useLicense();
  const [showTopo, setShowTopo] = useState(typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [showConfig, setShowConfig] = useState(false);
  const cmd = useCommandCenter();
  const [showDispatch, setShowDispatch] = useState(false);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const { mutate } = useSWRConfig();

  // SSE: instant revalidation on CommHub events
  // Opt-out via NEXT_PUBLIC_DISABLE_SSE=1 — avoids HTTP/1.1 head-of-line blocking on navigation
  const sseEnabled = process.env.NEXT_PUBLIC_DISABLE_SSE !== '1';
  const { connected: sseConnected, supported: sseSupported } = useSSE({
    url: '/api/hub/events',
    enabled: sseEnabled,
    onEvent: (event) => {
      if (['new_task', 'new_message', 'new_reply', 'node_status_changed', 'broadcast'].includes(event.type)) {
        mutate('/api/hub/status');
        mutate((key: string) => typeof key === 'string' && key.startsWith('/api/hub/tasks'), undefined, { revalidate: true });
      }
    },
  });

  // Fetch inbox (not in SWR since it accumulates)
  useEffect(() => {
    const fetchInbox = () => {
      fetch('/api/hub/inbox').then(r => r.json()).then(data => {
        if (data.messages?.length) setInbox(prev => {
          const ids = new Set(prev.map(m => m.id));
          const newMsgs = data.messages.filter((m: { id: string }) => !ids.has(m.id));
          return [...newMsgs, ...prev].slice(0, 100);
        });
      }).catch(() => {});
    };
    fetchInbox();
    const interval = setInterval(fetchInbox, 10000);
    return () => clearInterval(interval);
  }, []);

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

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <div className="lg:ml-0 ml-10">
        <StatsBar online={online} working={working} total={total} version={version} uptime={uptime} />
      </div>

      {/* Dispatch + User Bar */}
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => setShowDispatch(true)}
          className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-sm font-medium rounded-xl shadow-lg shadow-cyan-500/10 transition-all active:scale-95 shrink-0">
          ⚡ Dispatch
        </button>
        <div className="flex-1"><UserBar /></div>
      </div>

      {/* anet config (collapsed by default) */}
      <section className="mb-6 rounded-lg border border-[#2a2a4a] bg-[#111128] px-4 py-3 shadow-lg shadow-black/20">
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
        <section className="mb-6 rounded-lg border border-[#2a2a4a] bg-[#111128] px-4 py-3 shadow-lg shadow-black/20">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase text-gray-600">Task Status</div>
            <Link href="/tasks" prefetch={false} className="text-xs text-cyan-400 hover:text-cyan-300">View all &rarr;</Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'running', color: 'bg-green-500/10 text-green-300 border-green-500/20' },
              { key: 'delivered', color: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
              { key: 'acked', color: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20' },
              { key: 'replied', color: 'bg-purple-500/10 text-purple-300 border-purple-500/20' },
              { key: 'failed', color: 'bg-red-500/10 text-red-300 border-red-500/20' },
              { key: 'cancelled', color: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' },
              { key: 'expired', color: 'bg-orange-500/10 text-orange-300 border-orange-500/20' },
              { key: 'closed', color: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
            ].filter(({ key }) => taskStats[key])
              .map(({ key, color }) => (
                <Link key={key} href={`/tasks?status=${key}`} prefetch={false} className={`px-2.5 py-1 rounded-md border text-xs ${color} hover:opacity-80 transition-opacity`}>
                  {key}: {taskStats[key]}
                </Link>
              ))}
          </div>
        </section>
      )}

      {/* Quick Actions */}
      <section className="mb-6 grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { href: '/nodes', label: 'Nodes', value: `${online}/${total}`, color: 'text-green-400 border-green-500/15' },
          { href: '/tasks', label: 'Tasks', value: String(Object.values(taskStats).reduce((a, b) => a + b, 0) || '--'), color: 'text-cyan-400 border-cyan-500/15' },
          { href: '/tasks?status=failed', label: 'Failed', value: String(taskStats['failed'] || 0), color: taskStats['failed'] ? 'text-red-400 border-red-500/20' : 'text-gray-600 border-gray-700/30' },
          { href: '/messages', label: 'Messages', value: '→', color: 'text-blue-400 border-blue-500/15' },
          { href: '/logs', label: 'Logs', value: '→', color: 'text-purple-400 border-purple-500/15' },
          { href: '/admin', label: 'Admin', value: '→', color: 'text-gray-400 border-gray-500/15' },
        ].map(a => (
          <Link key={a.href} href={a.href} prefetch={false} className={`text-center rounded-xl border ${a.color} bg-[#111128] px-3 py-2.5 hover:bg-[#161630] transition-colors`}>
            <div className={`text-lg font-bold tabular-nums ${a.color.split(' ')[0]}`}>{a.value}</div>
            <div className="text-[10px] text-gray-500">{a.label}</div>
          </Link>
        ))}
      </section>

      <BroadcastBar />

      {/* Recent Activity */}
      {tasks.length > 0 && (
        <section className="mb-6 bg-[#111128] border border-[#2a2a4a] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-300">Recent Activity</h2>
            <Link href="/tasks" className="text-xs text-cyan-400 hover:text-cyan-300">All tasks &rarr;</Link>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {tasks.slice(0, 5).map((t: { task_id: string; from_name: string; to_name: string; status: string; content: string; created_at: string }) => (
              <div key={t.task_id} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  t.status === 'replied' ? 'bg-purple-400' : t.status === 'running' ? 'bg-green-400' : t.status === 'failed' ? 'bg-red-400' : 'bg-blue-400'
                }`} />
                <span className="text-blue-400 shrink-0">{t.from_name || '?'}</span>
                <span className="text-gray-600">&rarr;</span>
                <span className="text-cyan-400 shrink-0">{t.to_name || '?'}</span>
                <span className="text-gray-500 truncate flex-1">{t.content?.slice(0, 40) || '--'}</span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${
                  t.status === 'replied' ? 'text-purple-300 border-purple-500/20' : t.status === 'failed' ? 'text-red-300 border-red-500/20' : 'text-gray-500 border-gray-700/30'
                }`}>{t.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

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

      {showTopo && sessions.length > 0 && <TopoGraph sessions={sessions} sseSessions={sseSessions} />}

      {sessions.length === 0 && !sessError ? (
        <EmptyState hint={sessHint} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 sm:gap-4">
          {sortedSessions.map(s => (
            <AgentCard key={s.alias} session={s} hasSse={isOnline(s)} sseCount={sseLookup(s) || 0} onChat={cmd.openTab} />
          ))}
        </div>
      )}

      <InboxPanel messages={inbox} />

      <div className="mt-8 text-center text-xs text-gray-600 flex items-center justify-center gap-2 flex-wrap">
        {sseSupported && (
          <>
            <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? 'bg-green-400' : 'bg-gray-600'}`} />
            {sseConnected ? 'SSE live' : 'SWR polling'}
          </>
        )}
        {licData?.license && (
          <>
            {sseSupported && <>&middot;</>}
            <span className={licData.license.days_left <= 7 ? 'text-red-400' : licData.license.type === 'pro' ? 'text-green-400' : 'text-yellow-400'}>
              {licData.license.type} ({licData.license.days_left}d left)
            </span>
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
