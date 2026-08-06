'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { useNetworkId } from '../lib/network-context';
import { EmptyState } from '../components/EmptyState';
import { TaskList, type TaskListItem } from '../components/TaskList';
import { TaskDetail } from '../components/TaskDetail';
import {
  TASK_STATUSES,
  STATUS_CHIP_CLASS,
  STATUS_DOT_HEX,
  STATUS_BAR_CLASS,
} from '../lib/status';

// #Stage-tasks (dashboard 类飞书 two-column, 07-31):
//
// /tasks moves from one-big-table + inline-expand + drawer to a
// list-plus-detail layout with a shareable URL /tasks/[id]. Mirrors
// /nodes NodesView (see app/nodes/NodesView.tsx for the pattern).
//
// Deliberately: the old expand-in-place row and the TaskDrawer side
// sheet are gone from the /tasks page. The right pane replaces both
// affordances so we don't leave the layout showing "one thing twice"
// (通信龙 07-31 catch from /nodes: rail added alongside the table left
// 199 nodes rendered in two places at once). Detail negative
// assertions in the tests must be paired with a positive assertion so
// "detail integrated into pane" and "detail feature gone" can't be
// confused for each other.
//
// TaskDrawer.tsx itself is not deleted — no other file imports it,
// but the boundary of this PR is app/tasks/**, and dead-code sweeps
// are a separate concern.

const MD_QUERY = '(min-width: 768px)';
function subscribeMd(cb: () => void) {
  const mql = window.matchMedia(MD_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeMd,
    () => window.matchMedia(MD_QUERY).matches,
    () => true,
  );
}

// Task IDs on the CommHub side are opaque strings — usually hex, but
// treat them as arbitrary to match the alias precedent. Decode once
// defensively (same shape as /nodes NodesView.decodeAliasSegment).
export function decodeIdSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function TasksViewInner({ initialSelectedId = null }: { initialSelectedId?: string | null }) {
  const searchParams = useSearchParams();
  const { networkId } = useNetworkId();
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || '');
  // 07-31 通信龙 dispatch (临时开放此文件): let ChatPane's "查看任务"
  // button prefill the from/to filters via URL. Before this, the /tasks
  // link on ChatPane header carried `?alias=` which was silently ignored
  // (both filters init'd to '' regardless of URL) — user tapped, saw the
  // full unfiltered list, thought "that's all the tasks for this alias".
  // See feedback_verify_both_directions_with_real_data — this is a
  // silent-half-broken feature that already shipped in preview.51 and
  // needs both prefill directions.
  const [filterFrom, setFilterFrom] = useState(searchParams.get('from_name') || '');
  const [filterTo, setFilterTo] = useState(searchParams.get('to_name') || '');

  // #Stage-tasks: selection is seeded from /tasks/[id] URL, then plain
  // client state kept in sync with pushState (shallow — no route remount,
  // switching tasks swaps the right pane in place).
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const isDesktop = useIsDesktop();

  const selectTask = (task_id: string) => {
    setSelectedId(task_id);
    try {
      window.history.pushState({}, '', `/tasks/${encodeURIComponent(task_id)}`);
    } catch {}
  };
  const closeDetail = () => {
    setSelectedId(null);
    try {
      window.history.pushState({}, '', '/tasks');
    } catch {}
  };

  // Back/forward — mirror URL into state.
  useEffect(() => {
    const onPop = () => {
      const m = window.location.pathname.match(/^\/tasks\/([^/]+)\/?$/);
      setSelectedId(m ? decodeIdSegment(m[1]) : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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

  const counts: Record<string, number> = {};
  tasks.forEach((t) => {
    counts[t.status] = (counts[t.status] || 0) + 1;
  });
  const total = tasks.length || 1;
  const bars = TASK_STATUSES.map((key) => ({ key, color: STATUS_BAR_CLASS[key] })).filter(
    (b) => counts[b.key],
  );

  return (
    <div
      data-testid="tasks-layout"
      data-selected-id={selectedId ?? ''}
      className="min-h-screen max-w-full overflow-x-hidden bg-[#0b0b0d] text-gray-100 flex"
    >
      {/* Rail — desktop always visible; on mobile it holds the whole
          page (detail becomes a full-screen overlay). No "toggle
          rail" button on tasks: there is no dense one-column table
          to fall back to (unlike /nodes where Vincent's 看全局 view
          exists). Removing the old table is the whole point of this
          refactor — 通信龙 07-31 catch from /nodes: don't leave the
          layout showing "one thing twice". */}
      <aside
        data-testid="task-list-column"
        className={`flex flex-col w-full sm:w-[380px] shrink-0 min-h-screen sticky top-0 border-r border-[#1c1c1f] ${
          selectedId && !isDesktop ? 'hidden' : 'flex'
        }`}
      >
        <div className="px-4 py-3 border-b border-[#1c1c1f]">
          <div className="flex items-center gap-3 mb-3">
            <h1 className="text-xl font-bold text-white lg:ml-0 ml-10">Tasks</h1>
            {tasks.length < count && (
              <span
                className="text-xs bg-blue-900/30 text-blue-400 px-2 py-0.5 rounded-full border border-blue-800/30 tabular-nums"
                title={`Showing ${tasks.length} of ${count} tasks`}
              >
                {tasks.length} / {count}
              </span>
            )}
          </div>

          {tasks.length > 0 && (
            <>
              {/* Status tab strip */}
              <div className="anet-tabstrip-wrap mb-2">
                <div className="anet-tabstrip flex flex-wrap gap-1 bg-[#161618] rounded-lg border border-[#26262b] p-1 overflow-x-auto scrollbar-thin">
                  {['', ...TASK_STATUSES].map((s) => {
                    const cnt = s === '' ? tasks.length : counts[s] || 0;
                    const isActive = filterStatus === s;
                    return (
                      <button
                        key={s || 'all'}
                        onClick={() => setFilterStatus(s)}
                        disabled={cnt === 0 && s !== '' && !isActive}
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed ${
                          isActive
                            ? `${STATUS_CHIP_CLASS[s] || 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'} border`
                            : 'text-gray-500 hover:text-gray-300 hover:bg-[#1c1c1f]/40'
                        }`}
                      >
                        {s && (
                          <span
                            aria-hidden
                            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: STATUS_DOT_HEX[s] || '#6b7280' }}
                          />
                        )}
                        <span>{s || 'All'}</span>
                        <span
                          className={`text-[10px] tabular-nums ${
                            isActive ? 'opacity-80' : 'text-gray-600'
                          }`}
                        >
                          {cnt}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* From/To filters */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <div className="flex items-center gap-1 rounded border border-[#26262b] bg-[#161618] px-2 py-1 focus-within:border-blue-500/40">
                  <span className="text-[9px] uppercase tracking-wide text-gray-600">From</span>
                  <input
                    type="text"
                    value={filterFrom}
                    onChange={(e) => setFilterFrom(e.target.value)}
                    placeholder="any"
                    data-testid="tasks-filter-from"
                    className="w-16 bg-transparent text-xs text-white placeholder-gray-700 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1 rounded border border-[#26262b] bg-[#161618] px-2 py-1 focus-within:border-blue-500/40">
                  <span className="text-[9px] uppercase tracking-wide text-gray-600">To</span>
                  <input
                    type="text"
                    value={filterTo}
                    onChange={(e) => setFilterTo(e.target.value)}
                    placeholder="any"
                    data-testid="tasks-filter-to"
                    className="w-16 bg-transparent text-xs text-white placeholder-gray-700 focus:outline-none"
                  />
                </div>
                {(filterStatus || filterFrom || filterTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStatus('');
                      setFilterFrom('');
                      setFilterTo('');
                    }}
                    className="rounded border border-gray-700 px-2 py-0.5 text-[10px] text-gray-500 hover:text-gray-200 hover:border-gray-600"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Status distribution bar (only when no status filter) */}
              {!filterStatus && bars.length > 0 && (
                <div className="flex h-1 rounded-full overflow-hidden bg-gray-800">
                  {bars.map((b) => (
                    <div
                      key={b.key}
                      className={b.color}
                      style={{ width: `${(counts[b.key] / total) * 100}%` }}
                      title={`${b.key}: ${counts[b.key]}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-800/40 text-red-300 px-3 py-1.5 rounded mt-2 text-xs">
              {error}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="animate-pulse space-y-1 px-3 py-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="h-14 bg-gray-800/40 rounded" />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="px-3 py-6">
              <EmptyState
                variant="tasks"
                sub={
                  filterStatus || filterFrom || filterTo
                    ? 'No tasks match the current filters. Try clearing them.'
                    : 'Tasks will appear here when agents send them via CommHub.'
                }
              />
            </div>
          ) : (
            <TaskList tasks={tasks} selectedId={selectedId} onSelect={selectTask} />
          )}
        </div>
      </aside>

      {/* Detail — desktop: right pane inside the flex row. Mobile: full-screen
          overlay that hides the list column above. Both variants get onClose:
          on desktop it returns the right pane to the empty state (preserves
          the "← Tasks" return affordance the old full-page detail had);
          on mobile it dismisses the overlay. Either way the URL drops back
          to /tasks. 通信龙 07-31 constraint: 返回入口别丢. */}
      {selectedId && isDesktop && (
        <section
          data-testid="task-detail-column"
          className="flex-1 min-w-0 min-h-screen"
        >
          <TaskDetail taskId={selectedId} onClose={closeDetail} onRetried={fetchTasks} />
        </section>
      )}
      {selectedId && !isDesktop && (
        <section
          data-testid="task-detail-mobile"
          className="fixed inset-0 z-40 bg-[#0b0b0d]"
        >
          <TaskDetail taskId={selectedId} onClose={closeDetail} onRetried={fetchTasks} />
        </section>
      )}
      {!selectedId && isDesktop && (
        <section
          data-testid="task-detail-empty"
          className="flex-1 min-w-0 min-h-screen flex items-center justify-center text-sm text-gray-600"
        >
          请从左侧列表选择一条任务查看详情
        </section>
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary in Next 14+ app-router. Same
// shape the old page.tsx had (wrapper → Inner). Fallback matches the
// loaded layout width so the burger button doesn't crash into "Loa…".
export function TasksView({ initialSelectedId = null }: { initialSelectedId?: string | null }) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0b0b0d] text-gray-100 p-4 sm:p-6">
          <div className="lg:ml-0 ml-10 text-gray-500 text-sm">Loading tasks…</div>
        </div>
      }
    >
      <TasksViewInner initialSelectedId={initialSelectedId} />
    </Suspense>
  );
}
