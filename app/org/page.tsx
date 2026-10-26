'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmptyState } from '../components/EmptyState';
import { buildOrgGroups, type OrgGroup, type OrgDeptInput, type OrgMemberInput } from '../lib/org-tree';
import { buildAliasUserMap, buildUserDeptMap, collectDeptSubtree, taskInDept } from '../lib/dept-task-filter';

/**
 * Organization — #1635 / #1636（只读）。
 *
 * 数据有两条来源，和军团图完全一致：
 *   - `/api/hub/people`：人、部门名、名下 Agent（MCP requirements_people 的投影）；
 *   - `/api/hub/departments`：真实部门树（parent_id / leader / 成员落位）。
 * 老 Hub 没有第二条 → 404，页面回退成扁平分组并在顶部说明原因，
 * **不用空状态掩盖「这版 Hub 不支持」**。
 *
 * 分组逻辑在 app/lib/org-tree.ts（纯函数，org-tree.test.mjs 钉住），
 * 这里只负责画。没有编辑入口：部门与成员归属是人管的事，客户端才是编辑端。
 */

interface DirectoryAgent { node_id: string; alias: string }
interface DirectoryPerson {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  department: { id: string; name: string } | null;
  agents: DirectoryAgent[];
}
interface DirectoryResponse {
  ok: boolean;
  network_id: string;
  total: number;
  people: DirectoryPerson[];
  agents_without_owner?: DirectoryAgent[];
  has_more: boolean;
  next_offset: number | null;
}

const PAGE = 50;

function GroupSection({ group, depth, counts, focusName }: { group: OrgGroup; depth: number; counts: Map<string, number>; focusName?: string }) {
  const focused = !!focusName && group.name === focusName;
  // 有真实部门树时按 id 命中；老 Hub 回退成扁平分组（id 是合成的）时按部门名命中。
  const taskCount = counts.get(group.id.replace(/^dept:/, '')) ?? counts.get(group.name);
  return (
    <li>
      <div
        className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-[var(--border)] px-3 py-2 transition-colors sm:px-4 ${
          focused ? 'bg-[var(--accent)]/10' : ''
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        data-org-group={group.name}
        ref={el => { if (focused && el) el.scrollIntoView({ block: 'center' }); }}
      >
        <span className="text-[13px] font-medium text-[var(--fg)]">{group.name}</span>
        {group.leader && (
          <span className="rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
            负责人 {group.leader}
          </span>
        )}
        <span className="text-[11px] text-[var(--fg-muted)]">
          {group.totalPeople} 人 · {group.totalAgents} Agent
        </span>
        {taskCount ? (
          <Link
            href={`/tasks?department=${encodeURIComponent(group.id.replace(/^dept:/, ''))}`}
            data-testid="org-dept-task-link"
            title="到任务页按这个部门筛选：数字是当前这批任务里的通讯录投影命中数，不是部门全量"
            className="rounded-full bg-[var(--accent)]/12 px-1.5 py-0.5 text-[10px] text-[var(--fg)] hover:bg-[var(--accent)]/25"
          >
            {taskCount} 条任务 →
          </Link>
        ) : null}
      </div>

      {group.people.length > 0 && (
        <ul>
          {group.people.map(person => (
            <li
              key={person.user_id}
              className="px-3 py-2.5 sm:px-4"
              style={{ paddingLeft: `${12 + depth * 16 + 12}px` }}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm text-[var(--fg)]">{person.display_name || person.username}</span>
                <span className="text-[11px] text-[var(--fg-muted)]">@{person.username}</span>
                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]">
                  {person.role}
                </span>
                <span className="ml-auto text-[11px] text-[var(--fg-muted)]">{person.agents.length} 个 Agent</span>
              </div>
              {person.agents.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {person.agents.map(agent => (
                    <Link
                      key={agent.node_id}
                      href={`/nodes/${encodeURIComponent(agent.alias)}`}
                      className="rounded-md bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
                    >
                      {agent.alias}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {group.children.length > 0 && (
        <ul className="border-l border-[var(--border)]" style={{ marginLeft: `${20 + depth * 16}px` }}>
          {group.children.map(child => (
            <GroupSection key={child.id} group={child} depth={depth + 1} counts={counts} focusName={focusName} />
          ))}
        </ul>
      )}
    </li>
  );
}

function OrgContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q') || '';
  // 从军团图跳过来时定向到某个部门：/org?focus=<部门名>
  const focusName = searchParams.get('focus') || '';

  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [org, setOrg] = useState<{ departments?: OrgDeptInput[]; members?: OrgMemberInput[] } | null>(null);
  const [orgChecked, setOrgChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [offset, setOffset] = useState(0);
  const [qInput, setQInput] = useState(q);

  const load = useCallback(async (nextOffset = 0, merge = false) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('limit', String(PAGE));
      params.set('offset', String(nextOffset));
      const res = await fetch(`/api/hub/people?${params.toString()}`, { cache: 'no-store' });
      if (res.status === 401) { setNeedsLogin(true); setData(null); return; }
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json?.error || `hub_${res.status}`); return; }
      setNeedsLogin(false);
      setOffset(nextOffset);
      setData(prev => (merge && prev && nextOffset > 0
        ? { ...json, people: [...prev.people, ...json.people] }
        : json));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => { load(0, false); }, [load]);

  // 部门树单独拉：404 = 这版 Hub 没有这条路由（能力缺失），不是错误。
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/hub/departments', { cache: 'no-store' });
        if (!alive) return;
        if (res.status === 404) { setOrg(null); setOrgChecked(true); return; }
        if (res.status === 401) { setNeedsLogin(true); setOrgChecked(true); return; }
        const json = await res.json().catch(() => null);
        if (!alive) return;
        setOrg(res.ok && json?.ok ? json : null);
      } catch {
        if (alive) setOrg(null);
      } finally {
        if (alive) setOrgChecked(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const setQuery = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set('q', value); else next.delete('q');
    router.replace(next.toString() ? `/org?${next.toString()}` : '/org', { scroll: false });
  };

  const withoutOwner = data?.agents_without_owner ?? [];
  const people = data?.people ?? [];

  // 任务数徽标：只取一页任务（limit 100），和 /tasks 的部门筛选同口径 ——
  // 是「当前这批任务里的命中数」，不是部门全量，标题里写明。
  const [tasksForCount, setTasksForCount] = useState<Array<{ from_name?: string; to_name?: string; from_alias?: string; to_alias?: string }>>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch('/api/hub/tasks?limit=100', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then(json => { if (alive && json?.tasks) setTasksForCount(json.tasks); })
        .catch(() => { /* 任务读不到就不显示徽标，不影响组织树 */ });
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const deptTaskCounts = useMemo(() => {
    const aliasUser = buildAliasUserMap(people);
    const userDept = buildUserDeptMap(people, org?.members ?? null);
    const counts = new Map<string, number>();
    for (const dept of org?.departments ?? []) {
      const subtree = collectDeptSubtree(org?.departments, dept.id);
      const n = tasksForCount.filter(t => taskInDept(t, aliasUser, userDept, subtree)).length;
      if (n > 0) counts.set(dept.id, n);
    }
    // 扁平回退：没有部门树时 group.id 是合成的，只能按部门名对上号。
    if (!org?.departments?.length) {
      const aliasDeptName = new Map<string, string>();
      for (const person of people) {
        const name = person.department?.name;
        if (!name) continue;
        for (const agent of person.agents ?? []) aliasDeptName.set(agent.alias, name);
      }
      const byName = new Map<string, number>();
      for (const t of tasksForCount) {
        const names = new Set([aliasDeptName.get(t.from_name ?? ''), aliasDeptName.get(t.from_alias ?? ''), aliasDeptName.get(t.to_name ?? ''), aliasDeptName.get(t.to_alias ?? '')]);
        names.delete(undefined);
        for (const name of names) if (name) byName.set(name, (byName.get(name) ?? 0) + 1);
      }
      return byName;
    }
    return counts;
  }, [people, org, tasksForCount]);
  const tree = useMemo(
    () => buildOrgGroups(
      { people, departments: org?.departments, members: org?.members },
      { hideEmpty: q.trim().length > 0 },
    ),
    [people, org, q],
  );
  const deptCount = useMemo(() => {
    const count = (groups: OrgGroup[]): number =>
      groups.reduce((n, g) => n + 1 + count(g.children), 0);
    return count(tree.groups);
  }, [tree]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--fg)]">Organization</h1>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              人、部门与他们名下的 Agent（只读）。
            </p>
            {orgChecked && org === null && (
              <p className="mt-1 text-[11px] text-[var(--fg-dim)]">
                当前 Hub 没有部门树接口，按通讯录的部门名分组（升级 Hub 后自动变为真实层级）。
              </p>
            )}
            {orgChecked && org !== null && (
              <p className="mt-1 text-[11px] text-[var(--fg-dim)]">
                部门树来自 Hub，共 {deptCount} 个部门、{tree.depth} 层。
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/legion"
              className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
            >
              军团图
            </Link>
            <button
              type="button"
              onClick={() => load(offset, true)}
              className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="rounded-lg bg-[var(--bg-secondary)] px-2.5 py-1.5">
            <input
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setQuery(qInput); }}
              onBlur={() => { if (qInput !== q) setQuery(qInput); }}
              placeholder="人 / 部门 / Agent 别名"
              className="w-44 bg-transparent text-sm text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:outline-none sm:w-64"
            />
          </div>
          {q && (
            <button
              type="button"
              onClick={() => { setQInput(''); setQuery(''); }}
              className="rounded-md px-2.5 py-1.5 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
            >
              Clear
            </button>
          )}
          {data && <span className="text-[11px] text-[var(--fg-muted)]">{data.total} 人 · {deptCount} 个部门</span>}
        </div>

        {needsLogin && (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            会话已过期，<Link href="/login" className="underline">重新登录</Link> 后再看组织架构。
          </div>
        )}
        {error && !needsLogin && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            读取失败：{error}
            <button type="button" onClick={() => load(0, false)} className="ml-3 underline">重试</button>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-[var(--bg-secondary)]" />
            ))}
          </div>
        ) : people.length === 0 && !error && !needsLogin ? (
          <EmptyState
            variant="nodes"
            title={q ? '没有匹配的成员' : '通讯录是空的'}
            sub={q ? '换一个关键词试试。' : '成员加入网络后会自动出现在这里。'}
          />
        ) : (
          <>
            <ul className="overflow-hidden rounded-xl bg-[var(--bg-secondary)]">
              {tree.groups.map(group => (
                <GroupSection key={group.id} group={group} depth={0} counts={deptTaskCounts} focusName={focusName} />
              ))}
            </ul>

            {data?.has_more && (
              <button
                type="button"
                disabled={loading}
                onClick={() => load(offset + PAGE, true)}
                className="mx-auto mt-4 block rounded-md px-4 py-2 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)] disabled:opacity-50"
              >
                {loading ? '加载中…' : '加载更多'}
              </button>
            )}

            {offset === 0 && withoutOwner.length > 0 && (
              <div className="mt-6 rounded-xl bg-[var(--bg-secondary)] p-4">
                <h2 className="mb-2 text-xs text-[var(--fg-muted)]">无 owner 的 Agent</h2>
                <div className="flex flex-wrap gap-1.5">
                  {withoutOwner.map(agent => (
                    <Link
                      key={agent.node_id}
                      href={`/nodes/${encodeURIComponent(agent.alias)}`}
                      className="rounded-md bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
                    >
                      {agent.alias}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function OrgPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]" />}>
      <OrgContent />
    </Suspense>
  );
}
