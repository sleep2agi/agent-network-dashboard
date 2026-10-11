'use client';

import { useMemo, useState } from 'react';
import { TaskPanel } from '../components/requirement-chrome';
import {
  agentCount,
  agentsDirectlyIn,
  flattenTree,
  placeAgents,
  simulateStructureMove,
} from '../lib/agent-org.mjs';

type Department = {
  id: string;
  name: string;
  parent_id: string | null;
  sort: number;
  leader_user_id?: string | null;
  member_count?: number;
};

type Agent = { nodeId: string; alias: string };

export type AgentOrgData = {
  departments: Department[];
  owners: Array<{ userId: string; username: string; displayName: string; departmentId: string | null; agents: Agent[] }>;
  unowned: Agent[];
  directory: boolean;
  departmentsApi: boolean;
};

type Move = { nodeId: string; departmentId: string | null };
type Placed = {
  nodeId: string;
  alias: string;
  ownerName: string | null;
  departmentId: string | null;
  demo: boolean;
};

function footer(data: AgentOrgData): string {
  if (!data.directory) return '人员通讯录还没有，暂时列不出 Agent 和负责人。';
  if (!data.departmentsApi) return '部门树还没有，这些部门来自通讯录，只有一层。';
  return '部门树和 Agent 的负责人来自 Hub，这里只读。';
}

export function OrgTree({ data }: { data: AgentOrgData }) {
  const [focus, setFocus] = useState<string | null>(data.departments[0]?.id ?? null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [moves, setMoves] = useState<Move[]>([]);
  const [pickAgent, setPickAgent] = useState<string | null>(null);
  const [pickDept, setPickDept] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState('');

  const placed = useMemo(() => placeAgents(data, moves) as Placed[], [data, moves]);
  const needle = query.trim().toLocaleLowerCase();
  const rows = useMemo(() => {
    const tree = flattenTree(data.departments, needle ? undefined : collapsed);
    if (!needle) return tree;
    const hit = new Set<string>();
    for (const row of flattenTree(data.departments)) {
      const name = row.dept.name.toLocaleLowerCase();
      const agents = agentsDirectlyIn(placed, row.dept.id) as Placed[];
      const agentHit = agents.some((agent) => `${agent.alias} ${agent.ownerName || ''}`.toLocaleLowerCase().includes(needle));
      if (name.includes(needle) || agentHit) hit.add(row.dept.id);
    }
    const keep = new Set(hit);
    for (const id of hit) {
      let parent = data.departments.find((dept) => dept.id === id)?.parent_id ?? null;
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        keep.add(parent);
        parent = data.departments.find((dept) => dept.id === parent)?.parent_id ?? null;
      }
    }
    return tree.filter((row) => keep.has(row.dept.id));
  }, [collapsed, data.departments, needle, placed]);

  const focusDept = focus ? data.departments.find((dept) => dept.id === focus) : undefined;
  const title = focus === null ? '未归属' : (focusDept?.name ?? '未归属');
  const agents = (agentsDirectlyIn(placed, focus) as Placed[]).filter((agent) => {
    if (!needle) return true;
    return `${agent.alias} ${agent.ownerName || ''} ${title}`.toLocaleLowerCase().includes(needle);
  });

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4" data-testid="agent-org-tree">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索部门、Agent 或负责人"
          aria-label="搜索组织架构"
          className="h-9 w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:border-[var(--info)] focus:outline-none"
        />
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <TaskPanel className="space-y-1">
          <p className="px-1 pb-2 text-[11px] leading-relaxed text-[var(--fg-dim)]">{footer(data)}</p>
          {rows.length === 0 ? <p className="px-2 py-4 text-sm text-[var(--fg-dim)]">还没有部门</p> : null}
          <ul className="space-y-1">
            {rows.map((row) => {
              const active = focus === row.dept.id;
              const count = agentCount(placed, data.departments, row.dept.id);
              return (
                <li key={row.dept.id}>
                  <div className="flex items-stretch gap-1" style={{ paddingLeft: row.depth * 14 }}>
                    {row.hasChildren ? (
                      <button
                        type="button"
                        aria-label={collapsed.has(row.dept.id) ? `展开 ${row.dept.name}` : `折叠 ${row.dept.name}`}
                        onClick={() => toggle(row.dept.id)}
                        className="w-6 shrink-0 rounded-md text-xs text-[var(--fg-dim)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
                      >
                        {collapsed.has(row.dept.id) ? '▸' : '▾'}
                      </button>
                    ) : <span className="w-6 shrink-0" />}
                    <button
                      type="button"
                      data-testid={`agent-org-dept-${row.dept.id}`}
                      aria-pressed={active}
                      onClick={() => setFocus(row.dept.id)}
                      className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                        active
                          ? 'bg-[var(--bg-elevated)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border)]'
                          : 'text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]'
                      }`}
                    >
                      <span className="truncate">{row.dept.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[var(--fg-dim)]">{count}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {data.directory || agentCount(placed, data.departments, null) > 0 ? (
            <button
              type="button"
              data-testid="agent-org-dept-unassigned"
              aria-pressed={focus === null}
              onClick={() => setFocus(null)}
              className={`mt-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${
                focus === null
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg)] shadow-[inset_0_0_0_1px_var(--border)]'
                  : 'text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]'
              }`}
            >
              <span>未归属</span>
              <span className="text-[11px] tabular-nums text-[var(--fg-dim)]">{agentCount(placed, data.departments, null)}</span>
            </button>
          ) : null}
        </TaskPanel>

        <TaskPanel data-testid="agent-org-detail">
          <h2 className="px-1 text-sm font-medium text-[var(--fg)]">{title}</h2>
          {agents.length === 0 ? (
            <p className="px-1 py-6 text-sm text-[var(--fg-dim)]" data-testid="agent-org-no-agents">这个部门下面没有 Agent</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {agents.map((agent) => (
                <li key={agent.nodeId}>
                  <div data-testid={`agent-org-agent-${agent.nodeId}`} className="flex items-center justify-between gap-3 rounded-[10px] px-1 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{agent.alias}</div>
                      <div className="mt-0.5 text-[11px] text-[var(--fg-dim)]">
                        {agent.demo
                          ? (agent.ownerName ? `仍由 ${agent.ownerName} 负责，没有保存` : '仍然没有负责人，没有保存')
                          : (agent.ownerName ? `负责人 ${agent.ownerName}` : '没有负责人')}
                      </div>
                    </div>
                    {agent.demo ? <span className="shrink-0 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--warning)]">演示</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TaskPanel>
      </div>

      <TaskPanel className="space-y-3" data-testid="agent-org-demo">
        <div>
          <h2 className="text-sm font-medium">调整结构（演示）</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-dim)]">这些调整只在这台浏览器里模拟，不会向 Hub 发请求，也不会写入配置。</p>
        </div>
        {placed.length === 0 ? <p className="text-sm text-[var(--fg-dim)]">通讯录里还没有可调整的 Agent</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs text-[var(--fg-dim)]">
              选择 Agent
              <select
                aria-label="选择 Agent"
                value={pickAgent ?? ''}
                onChange={(event) => setPickAgent(event.target.value || null)}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--fg)]"
              >
                <option value="">未选择</option>
                {placed.map((agent) => <option key={agent.nodeId} value={agent.nodeId}>{agent.alias}</option>)}
              </select>
            </label>
            <label className="block text-xs text-[var(--fg-dim)]">
              移到部门
              <select
                aria-label="移到部门"
                value={pickDept === undefined ? '' : pickDept === null ? '__none__' : pickDept}
                onChange={(event) => {
                  if (!event.target.value) setPickDept(undefined);
                  else if (event.target.value === '__none__') setPickDept(null);
                  else setPickDept(event.target.value);
                }}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--fg)]"
              >
                <option value="">未选择</option>
                <option value="__none__">未归属</option>
                {data.departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
              </select>
            </label>
          </div>
        )}
        {placed.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="agent-org-demo-apply"
              onClick={() => {
                const result = simulateStructureMove({ nodeId: pickAgent, departmentId: pickDept }) as { ok: boolean; nodeId?: string; departmentId?: string | null };
                if (!result.ok || !result.nodeId || result.departmentId === undefined) {
                  setNote('先选一个 Agent 和目标部门');
                  return;
                }
                const nodeId = result.nodeId;
                const departmentId = result.departmentId;
                setMoves((current) => [...current.filter((move) => move.nodeId !== nodeId), { nodeId, departmentId }]);
                setNote('这次没有向 Hub 发请求，也没有写入任何配置。');
              }}
              className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--fg)] hover:border-[var(--border-hover)]"
            >
              模拟调整
            </button>
            {moves.length > 0 ? (
              <button
                type="button"
                onClick={() => { setMoves([]); setNote(''); }}
                className="h-9 rounded-lg px-3 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                清除演示调整
              </button>
            ) : null}
          </div>
        ) : null}
        {note ? <p className="text-xs text-[var(--fg-muted)]" data-testid="agent-org-demo-result">{note}</p> : null}
      </TaskPanel>
    </div>
  );
}
