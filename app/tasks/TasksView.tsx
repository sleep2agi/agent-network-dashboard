'use client';

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
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
  STATUS_DOT_HEX,
  STATUS_BAR_CLASS,
} from '../lib/status';
import {
  buildAliasUserMap,
  buildUserDeptMap,
  collectDeptSubtree,
  deptOptions,
  filterTasksByDept,
  filterUnassignedTasks,
} from '../lib/dept-task-filter';
import type { LegionDepartment, LegionPerson } from '../lib/legion-layout';

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
  // 部门筛选：Hub 的任务接口没有 department_id，这里按「成员名下 Agent」投影。
  // UI 上必须标明口径，数量也只代表这一页任务的命中数，不能冒充部门全量。
  const [filterDept, setFilterDept] = useState(searchParams.get('department') || '');
  // 部门筛选写回 URL：筛选结果能直接分享给别人，刷新也不会丢。
  const setDeptAndUrl = (value: string) => {
    setFilterDept(value);
    try {
      const url = new URL(window.location.href);
      if (value) url.searchParams.set('department', value);
      else url.searchParams.delete('department');
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch { /* pushState 被禁用时只是不写 URL，筛选本身照常 */ }
  };
  const [people, setPeople] = useState<LegionPerson[]>([]);
  const [depts, setDepts] = useState<LegionDepartment[] | null>(null);
  const [deptMembers, setDeptMembers] = useState<Array<{ user_id: string; department_id: string | null }>>([]);

  // #Stage-tasks: selection is seeded from /tasks/[id] URL, then plain
  // client state kept in sync with pushState (shallow — no route remount,
  // switching tasks swaps the right pane in place).
  // 浏览器前进/后退会改 URL 但不重挂组件：把 department 参数同步回 state，
  // 否则会出现「地址栏是 d2、下拉框还停在 d1」。
  const deptParam = searchParams.get('department') || '';
  useEffect(() => {
    setFilterDept(prev => (prev === deptParam ? prev : deptParam));
  }, [deptParam]);

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
      // 非 2xx 是失败，不是空列表：不检查 res.ok 会让 502 显示成「暂无任务」。
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error || detail?.message || `HTTP ${res.status}`);
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

  // 通讯录与部门树：只为了把 alias 落到部门上。失败就让下拉框空着，
  // 不阻塞任务列表本身（任务能读、部门筛选不可用，是可接受的降级）。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/hub/people?limit=200&offset=0', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setPeople(json?.people ?? []);
      } catch { /* 通讯录读不到时部门筛选自然为空 */ }
      try {
        const res = await fetch('/api/hub/departments', { cache: 'no-store' });
        if (res.status === 404) return; // 老 Hub 没这条路由：保持 null，回退扁平部门名
        if (!res.ok) return;
        const json = await res.json();
        if (alive) {
          setDepts(json?.departments ?? null);
          setDeptMembers(json?.members ?? []);
        }
      } catch { /* 同上 */ }
    })();
    return () => { alive = false; };
  }, []);

  const deptAliasUser = useMemo(() => buildAliasUserMap(people), [people]);
  const deptUserDept = useMemo(() => buildUserDeptMap(people, deptMembers), [people, deptMembers]);
  const deptChoices = useMemo(() => deptOptions(depts, people, deptMembers), [depts, people, deptMembers]);
  const deptIds = useMemo(
    () => (filterDept ? collectDeptSubtree(depts, filterDept) : new Set<string>()),
    [filterDept, depts],
  );
  const deptScopedTasks = useMemo(
    () => filterTasksByDept(tasks, deptAliasUser, deptUserDept, deptIds),
    [tasks, deptAliasUser, deptUserDept, deptIds],
  );
  // 「未归属」不是一个部门：所有参与者都落不到部门才算。单独给一个选项，
  // 否则这些任务在任何部门筛选下都人间蒸发。
  const UNASSIGNED = '__unassigned__';
  const unassignedTasks = useMemo(
    () => filterUnassignedTasks(tasks, deptAliasUser, deptUserDept),
    [tasks, deptAliasUser, deptUserDept],
  );

  const tasksScoped = filterDept === UNASSIGNED ? unassignedTasks : deptIds.size > 0 ? deptScopedTasks : tasks;
  const counts: Record<string, number> = {};
  tasksScoped.forEach((t) => {
    counts[t.status] = (counts[t.status] || 0) + 1;
  });
  const total = tasksScoped.length || 1;
  const bars = TASK_STATUSES.map((key) => ({ key, color: STATUS_BAR_CLASS[key] })).filter(
    (b) => counts[b.key],
  );

  return (
    <div
      data-testid="tasks-layout"
      data-selected-id={selectedId ?? ''}
      className="min-h-screen max-w-full overflow-x-hidden bg-[var(--bg)] text-[var(--fg)] flex"
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
        className={`flex flex-col w-full sm:w-[380px] shrink-0 min-h-screen sticky top-0 border-r border-[var(--border)] ${
          selectedId && !isDesktop ? 'hidden' : 'flex'
        }`}
      >
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 mb-3">
            <h1 className="text-xl font-semibold text-[var(--fg)] lg:ml-0 ml-10">Tasks</h1>
            {tasksScoped.length < count && (
              <span
                className="text-xs bg-[var(--bg-elevated)] text-[var(--fg-muted)] px-2 py-0.5 rounded-full tabular-nums"
                title={`Showing ${tasksScoped.length} of ${count} tasks`}
              >
                {tasksScoped.length} / {count}
              </span>
            )}
          </div>

          {tasks.length > 0 && (
            <>
              {/* Status tab strip */}
              <div className="anet-tabstrip-wrap mb-2">
                <div className="anet-tabstrip flex flex-wrap gap-1 rounded-lg bg-[var(--bg-secondary)] p-1 overflow-x-auto scrollbar-thin">
                  {['', ...TASK_STATUSES].map((s) => {
                    const cnt = s === '' ? tasksScoped.length : counts[s] || 0;
                    const isActive = filterStatus === s;
                    return (
                      <button
                        key={s || 'all'}
                        onClick={() => setFilterStatus(s)}
                        disabled={cnt === 0 && s !== '' && !isActive}
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed ${
                          isActive
                            ? 'bg-[var(--bg-elevated)] text-[var(--fg)]'
                            : 'text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]'
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
                            isActive ? 'text-[var(--fg-muted)]' : 'text-[var(--fg-dim)]'
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
                <div className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 focus-within:border-[var(--border-hover)]">
                  <span className="text-[9px] uppercase tracking-wide text-[var(--fg-muted)]">From</span>
                  <input
                    type="text"
                    value={filterFrom}
                    onChange={(e) => setFilterFrom(e.target.value)}
                    placeholder="any"
                    data-testid="tasks-filter-from"
                    className="w-16 bg-transparent text-xs text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 focus-within:border-[var(--border-hover)]">
                  <span className="text-[9px] uppercase tracking-wide text-[var(--fg-muted)]">To</span>
                  <input
                    type="text"
                    value={filterTo}
                    onChange={(e) => setFilterTo(e.target.value)}
                    placeholder="any"
                    data-testid="tasks-filter-to"
                    className="w-16 bg-transparent text-xs text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:outline-none"
                  />
                </div>
                {deptChoices.length > 0 && (
                  <div className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1">
                    <span className="text-[9px] uppercase tracking-wide text-[var(--fg-muted)]">Dept</span>
                    <select
                      value={filterDept}
                      onChange={(e) => setDeptAndUrl(e.target.value)}
                      data-testid="tasks-filter-dept"
                      className="max-w-[7.5rem] bg-transparent text-xs text-[var(--fg)] focus:outline-none"
                    >
                      <option value="">全部</option>
                      {deptChoices.map(d => (
                        <option key={d.id} value={d.id}>{`${'　'.repeat(d.depth)}${d.name}`}</option>
                      ))}
                      {unassignedTasks.length > 0 && (
                        <option value={UNASSIGNED}>未归属（{unassignedTasks.length}）</option>
                      )}
                    </select>
                  </div>
                )}
                {(filterStatus || filterFrom || filterTo || filterDept) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterStatus('');
                      setFilterFrom('');
                      setFilterTo('');
                      setDeptAndUrl('');
                    }}
                    className="rounded px-2 py-0.5 text-[10px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
                  >
                    Clear
                  </button>
                )}
              </div>

              {filterDept && (
                <p className="mb-2 text-[10px] leading-snug text-[var(--fg-dim)]" data-testid="tasks-dept-scope">
                  {filterDept === UNASSIGNED
                    ? `「未归属」= 参与者都不在通讯录或没有部门；命中数为当前这 ${tasks.length} 条任务里的投影结果。`
                    : `按「成员名下 Agent」归属部门筛选，命中数为当前这 ${tasks.length} 条任务里的投影结果，不是部门全量。`}
                </p>
              )}

              {/* Status distribution bar (only when no status filter) */}
              {!filterStatus && bars.length > 0 && (
                <div className="flex h-1 rounded-full overflow-hidden bg-[var(--border)]">
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
                <div key={i} className="h-14 rounded bg-[var(--bg-elevated)]" />
              ))}
            </div>
          ) : error && tasks.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm">
              <p className="font-medium text-[var(--danger)]">读不到任务列表</p>
              <p className="mt-1 text-xs text-[var(--fg-muted)]">{error}</p>
              <button
                type="button"
                onClick={() => { setLoading(true); setError(''); void fetchTasks(); }}
                className="mt-3 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)]"
              >
                重试
              </button>
            </div>
          ) : tasksScoped.length === 0 ? (
            <div className="px-3 py-6">
              {/* #1636 —— 有筛选时的空态必须给**动作**，不能只说「去清一下筛选」。
                  文案承诺了动作却没有入口，等于让用户自己猜怎么清。 */}
              <EmptyState
                variant="tasks"
                sub={
                  filterDept === UNASSIGNED
                    ? '这批任务里的参与者都能落到部门，没有未归属的任务。'
                    : filterDept
                      ? '这个部门在当前这批任务里没有记录。部门筛选是通讯录投影，换一页或清空筛选再看。'
                    : filterStatus || filterFrom || filterTo
                      ? '当前筛选没有匹配的任务。'
                      : '当 Agent 通过 CommHub 派活时，任务会出现在这里。'
                }
                cta={
                  filterStatus || filterFrom || filterTo || filterDept
                    ? {
                        label: '清空筛选',
                        onClick: () => {
                          setFilterStatus('');
                          setFilterFrom('');
                          setFilterTo('');
                          // 部门走 setDeptAndUrl：它有 URL 回写 + 一个
                          // 「URL→state」的 effect，只改 state 会被 effect 立刻改回来。
                          setDeptAndUrl('');
                        },
                      }
                    : undefined
                }
              />
            </div>
          ) : (
            <TaskList tasks={tasksScoped} selectedId={selectedId} onSelect={selectTask} />
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
