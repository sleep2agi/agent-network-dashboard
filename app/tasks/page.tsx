'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useNetworkId } from '../lib/network-context';
import { TaskDrawer } from '../components/TaskDrawer';
import { EmptyState } from '../components/EmptyState';
import { AliasAvatar } from '../components/AliasAvatar';

interface Task {
  task_id: string;
  from_name: string;
  to_name: string;
  status: string;
  priority: string;
  content: string;
  result: string;
  created_at: string;
  updated_at: string;
  delivered_at: string;
  started_at: string;
  completed_at: string;
  expires_at: string;
}

const STATUS_OPTIONS = [
  '',
  'created',
  'delivered',
  'acked',
  'running',
  'replied',
  'closed',
  'failed',
  'cancelled',
  'expired',
];

const STATUS_COLORS: Record<string, string> = {
  created: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  delivered: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  acked: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
  running: 'bg-green-500/10 text-green-300 border-green-500/20',
  replied: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  closed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  failed: 'bg-red-500/10 text-red-300 border-red-500/20',
  cancelled: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
  expired: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
};

/** Small colored dot per status — visible on every tab (active + inactive)
 *  so users can scan the row at a glance. Hex inlined to avoid Tailwind
 *  purging dynamic `bg-${family}-400` class names. */
const STATUS_DOTS: Record<string, string> = {
  created:   '#9ca3af',
  delivered: '#60a5fa',
  acked:     '#22d3ee',
  running:   '#4ade80',
  replied:   '#a78bfa',
  closed:    '#6b7280',
  failed:    '#f87171',
  cancelled: '#facc15',
  expired:   '#fb923c',
};

function statusBadge(status: string) {
  const color = STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  return `text-xs px-2 py-0.5 rounded-md border ${color}`;
}

function priorityBadge(priority: string) {
  if (priority === 'high') return 'text-red-400';
  if (priority === 'low') return 'text-gray-600';
  return 'text-gray-400';
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '--';
  const diff = Date.now() - new Date(dateStr.replace(' ', 'T') + 'Z').getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function TasksContent() {
  const searchParams = useSearchParams();
  const { networkId } = useNetworkId();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

  const toggleExpand = (taskId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (networkId) params.set('network_id', networkId);
      if (filterStatus) params.set('status', filterStatus);
      if (filterFrom) params.set('from_name', filterFrom);
      if (filterTo) params.set('to_name', filterTo);
      params.set('limit', '100');

      const res = await fetch(`/api/hub/tasks?${params.toString()}`);
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      const data = await res.json();
      setTasks(data.tasks || []);
      setCount(data.count ?? (data.tasks?.length || 0));
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterFrom, filterTo, networkId]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-white lg:ml-0 ml-10">Tasks</h1>
        <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full border border-blue-800/30">
          {count}
        </span>
      </div>

      {/* Status Tabs — color-coded dots per status family so users can
          scan the row at a glance. Active tab gets full chip styling
          (bg + border + text color), inactive tabs only carry the dot
          + neutral label so the active state remains the strong cue.
          On narrow viewports (<sm) the row scrolls horizontally with
          subtle gradient fade-edges (via .anet-tabstrip-wrap pseudo
          elements) hinting more content. */}
      <div className="anet-tabstrip-wrap mb-4">
      <div className="anet-tabstrip flex sm:flex-wrap gap-1 bg-[#111128] rounded-lg border border-[#2a2a4a] p-1 overflow-x-auto sm:overflow-x-visible scrollbar-thin">
        {['', ...STATUS_OPTIONS.filter(Boolean)].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              filterStatus === s
                ? `${STATUS_COLORS[s] || 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'} border`
                : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a2a]/40'
            }`}>
            {s && (
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: STATUS_DOTS[s] || '#6b7280' }}
              />
            )}
            <span>{s || 'All'}</span>
          </button>
        ))}
      </div>
      </div>

      {/* From/To Filters — same visual block as the status tabs above. */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="flex items-center gap-1.5 rounded-lg border border-[#2a2a4a] bg-[#111128] px-2.5 py-1.5 focus-within:border-blue-500/40">
          <span className="text-[10px] uppercase tracking-wide text-gray-600">From</span>
          <input
            type="text"
            value={filterFrom}
            onChange={e => setFilterFrom(e.target.value)}
            placeholder="any node"
            className="w-28 bg-transparent text-sm text-white placeholder-gray-700 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-[#2a2a4a] bg-[#111128] px-2.5 py-1.5 focus-within:border-blue-500/40">
          <span className="text-[10px] uppercase tracking-wide text-gray-600">To</span>
          <input
            type="text"
            value={filterTo}
            onChange={e => setFilterTo(e.target.value)}
            placeholder="any node"
            className="w-28 bg-transparent text-sm text-white placeholder-gray-700 focus:outline-none"
          />
        </div>
        {(filterStatus || filterFrom || filterTo) && (
          <button
            type="button"
            onClick={() => { setFilterStatus(''); setFilterFrom(''); setFilterTo(''); }}
            className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-gray-200 hover:border-gray-600"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Status distribution */}
      {tasks.length > 0 && !filterStatus && (() => {
        const stats: Record<string, number> = {};
        tasks.forEach(t => { stats[t.status] = (stats[t.status] || 0) + 1; });
        const total = tasks.length || 1;
        const bars = [
          { key: 'running', color: 'bg-green-500', text: 'text-green-400' },
          { key: 'delivered', color: 'bg-blue-500', text: 'text-blue-400' },
          { key: 'replied', color: 'bg-purple-500', text: 'text-purple-400' },
          { key: 'failed', color: 'bg-red-500', text: 'text-red-400' },
          { key: 'expired', color: 'bg-orange-500', text: 'text-orange-400' },
        ].filter(b => stats[b.key]);
        if (!bars.length) return null;
        return (
          <div className="mb-6">
            <div className="flex h-2 rounded-full overflow-hidden bg-gray-800">
              {bars.map(b => <div key={b.key} className={b.color} style={{ width: `${(stats[b.key]/total)*100}%` }} />)}
            </div>
            <div className="flex flex-wrap gap-3 mt-1.5 text-[10px] text-gray-500">
              {bars.map(b => <span key={b.key}><span className={`inline-block w-2 h-2 rounded-full ${b.color} mr-1`} />{stats[b.key]} {b.key}</span>)}
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-4 py-2 rounded-lg mb-6 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-20 bg-gray-800/20 rounded-lg border border-gray-800/40" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          variant="tasks"
          sub={(filterStatus || filterFrom || filterTo)
            ? 'No tasks match the current filters. Try clearing them.'
            : 'Tasks will appear here when agents send them via CommHub.'}
        />
      ) : (
        <div className="space-y-2">
          {/* Table header */}
          <div className="hidden sm:grid sm:grid-cols-12 gap-2 px-4 py-2 text-xs text-gray-600 uppercase">
            <div className="col-span-1">Status</div>
            <div className="col-span-2">From</div>
            <div className="col-span-2">To</div>
            <div className="col-span-4">Content</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-2">Time</div>
          </div>

          {tasks.map(t => {
            const isOpen = expanded.has(t.task_id);
            return (
            <div
              key={t.task_id}
              className={`anet-task-row group bg-[#111128] border rounded-lg px-4 py-3 transition-all duration-200 cursor-pointer ${
                isOpen
                  ? 'border-[#3a3a5a] shadow-lg shadow-black/20'
                  : 'border-[#2a2a4a] hover:border-[#3a3a5a] hover:bg-[#15152e]'
              }`}
              onClick={() => toggleExpand(t.task_id)}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleExpand(t.task_id);
                }
              }}
            >
              {/* Desktop row */}
              <div className="hidden sm:grid sm:grid-cols-12 gap-2 items-center">
                <div className="col-span-1">
                  <span className={statusBadge(t.status)}>{t.status}</span>
                </div>
                <div className="col-span-2 flex items-center gap-1.5 min-w-0" title={t.from_name}>
                  {t.from_name && <AliasAvatar alias={t.from_name} size={18} />}
                  <span className="truncate text-sm text-gray-200">{t.from_name || '--'}</span>
                </div>
                <div className="col-span-2 flex items-center gap-1.5 min-w-0" title={t.to_name}>
                  {t.to_name && <AliasAvatar alias={t.to_name} size={18} />}
                  <span className="truncate text-sm text-gray-200">{t.to_name || '--'}</span>
                </div>
                <div className="col-span-4 text-xs text-gray-400 truncate" title={t.content}>
                  {t.content || '--'}
                </div>
                <div className="col-span-1">
                  <span className={`text-xs ${priorityBadge(t.priority)}`}>{t.priority || 'normal'}</span>
                </div>
                <div className="col-span-2 text-xs text-gray-500 flex items-center justify-between gap-2" title={t.created_at}>
                  <span className="truncate">{timeAgo(t.created_at)}</span>
                  <svg
                    aria-hidden
                    className={`shrink-0 text-gray-600 group-hover:text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>

              {/* Mobile layout */}
              <div className="sm:hidden space-y-2">
                <div className="flex items-center justify-between">
                  <span className={statusBadge(t.status)}>{t.status}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${priorityBadge(t.priority)}`}>{t.priority || 'normal'}</span>
                    <svg
                      aria-hidden
                      className={`text-gray-600 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-300 min-w-0">
                  {t.from_name && <AliasAvatar alias={t.from_name} size={16} />}
                  <span className="truncate max-w-[40%]">{t.from_name || '--'}</span>
                  <span className="text-gray-600">&rarr;</span>
                  {t.to_name && <AliasAvatar alias={t.to_name} size={16} />}
                  <span className="truncate max-w-[40%]">{t.to_name || '--'}</span>
                </div>
                <div className="text-xs text-gray-400 line-clamp-1">{t.content || '--'}</div>
                <div className="text-xs text-gray-600">{timeAgo(t.created_at)}</div>
              </div>

              {/* Expanded detail — always mounted; grid-rows 0fr↔1fr trick gives
                  content-aware smooth max-height animation without measuring DOM. */}
              <div
                className={`grid transition-all duration-300 ease-out ${
                  isOpen ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'
                }`}
                aria-hidden={!isOpen}
              >
                <div className="overflow-hidden">
                <div className="pt-3 border-t border-[#2a2a4a] space-y-3">
                  {t.content && (
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Content</div>
                      <div className="text-xs text-gray-300 whitespace-pre-wrap bg-[#0a0a15] rounded-lg px-3 py-2 border border-[#1a1a2a]">{t.content}</div>
                    </div>
                  )}
                  {t.result && (
                    <div>
                      <div className="text-xs text-gray-600 mb-1">Result</div>
                      <div className="text-xs text-gray-300 whitespace-pre-wrap bg-[#0a0a15] rounded-lg px-3 py-2 border border-[#1a1a2a] max-h-48 overflow-y-auto">{t.result}</div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {[
                      ['Created', t.created_at],
                      ['Delivered', t.delivered_at],
                      ['Started', t.started_at],
                      ['Completed', t.completed_at],
                    ].map(([label, val]) => (
                      <div key={label as string}>
                        <span className="text-gray-600">{label}: </span>
                        <span className="text-gray-400">{val ? timeAgo(val as string) : '--'}</span>
                      </div>
                    ))}
                  </div>
                  {t.expires_at && (
                    <div className="text-xs">
                      <span className="text-gray-600">Expires: </span>
                      <span className="text-orange-400">{t.expires_at}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-gray-600 truncate" title={t.task_id}>
                      ID: {t.task_id}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {(t.status === 'failed' || t.status === 'expired') && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await fetch('/api/hub/send', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ alias: t.to_name, task: t.content, priority: t.priority }),
                            });
                            fetchTasks();
                          }}
                          className="text-xs text-orange-400 hover:text-orange-300 px-2 py-0.5 rounded border border-orange-500/20 hover:bg-orange-500/10"
                        >
                          Retry
                        </button>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setDrawerTaskId(t.task_id); }}
                        className="text-xs text-cyan-400 hover:text-cyan-300"
                      >
                        Detail &rarr;
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {drawerTaskId && <TaskDrawer taskId={drawerTaskId} onClose={() => setDrawerTaskId(null)} />}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-6 font-mono">Loading tasks...</div>}>
      <TasksContent />
    </Suspense>
  );
}
