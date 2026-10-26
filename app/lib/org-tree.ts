/**
 * `/org` 的树形分组 —— 与军团图同一份 Hub 数据（#1636）。
 *
 * 为什么单独抽出来：页面上一版的「部门」只是把 `person.department.name`
 * 去重后按人数排序，既没有父子关系，也没有负责人；而客户端用的是
 * `GET /api/networks/{id}/departments`（parent_id / leader_user_id / 成员表）。
 * 分组、层级、含下级的合计这些算错不会报错，只会安静地显示一棵错的树，
 * 所以做成纯函数，行为由 org-tree.test.mjs 钉住。
 *
 * 两种输入共用同一套输出：
 *   - 有 departments → 真部门树；
 *   - 没有（老 Hub 404）→ 按 department.name 合成一层，`fallback: true`。
 */

export interface OrgPersonLike {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  department: { id: string; name: string } | null;
  agents: { node_id: string; alias: string }[];
}

/**
 * 组织列表的搜索过滤（纯函数）。
 *
 * 为什么单独抽：`buildOrgGroups` 只负责建树，搜索必须在建树前把人员筛掉 ——
 * 之前页面把 `q` 传给了 `buildOrgGroups` 的 `hideEmpty`，人根本没被过滤，
 * 「搜成员42 仍然显示 100 人」的 bug 就是这么来的。抽出来才有单测钉住。
 */
export function filterOrgPeople<T extends OrgPersonLike>(people: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return people;
  return people.filter(p =>
    `${p.display_name ?? ''} ${p.username} ${(p.agents ?? []).map(a => a.alias).join(' ')}`
      .toLowerCase()
      .includes(q),
  );
}

export interface OrgDeptInput {
  id: string;
  name: string;
  parent_id?: string | null;
  leader_user_id?: string | null;
  sort?: number;
}

export interface OrgMemberInput {
  user_id: string;
  department_id: string | null;
}

export interface OrgGroup {
  /** `dept:<id>`；合成分组恒为 `dept:none`。 */
  id: string;
  name: string;
  /** 1 = 顶层部门。 */
  depth: number;
  leader?: string;
  /** 直属成员。 */
  people: OrgPersonLike[];
  /** 含下级部门的人数 / Agent 数。 */
  totalPeople: number;
  totalAgents: number;
  children: OrgGroup[];
}

export interface OrgTree {
  groups: OrgGroup[];
  depth: number;
  fallback: boolean;
  /** 部门 id 在通讯录里找不到的人（不丢人，单独一组）。 */
  unassigned: OrgPersonLike[];
}

export const UNASSIGNED_GROUP = '未分组';

function personName(p: OrgPersonLike): string {
  return p.display_name || p.username;
}

function sortPeople(list: OrgPersonLike[]): OrgPersonLike[] {
  return [...list].sort(
    (a, b) => personName(a).localeCompare(personName(b), 'zh-Hans-CN') || a.user_id.localeCompare(b.user_id),
  );
}

function makeGroup(id: string, name: string, depth: number): OrgGroup {
  return { id, name, depth, people: [], totalPeople: 0, totalAgents: 0, children: [] };
}

function measure(group: OrgGroup): void {
  group.totalPeople = group.people.length;
  group.totalAgents = group.people.reduce((n, p) => n + p.agents.length, 0);
  for (const child of group.children) {
    measure(child);
    group.totalPeople += child.totalPeople;
    group.totalAgents += child.totalAgents;
  }
}

export interface BuildOrgOptions {
  /** 搜索时隐藏空部门：搜索是找人的，不该满屏空壳。 */
  hideEmpty?: boolean;
}

export function buildOrgGroups(
  input: {
    people: OrgPersonLike[];
    departments?: OrgDeptInput[];
    members?: OrgMemberInput[];
  },
  options: BuildOrgOptions = {},
): OrgTree {
  const people = sortPeople(input.people);
  const depts = input.departments ?? [];

  if (depts.length === 0) {
    // ── 回退：一层扁平分组 ──
    const byId = new Map<string, OrgGroup>();
    for (const person of people) {
      const id = person.department ? `dept:${person.department.id}` : 'dept:none';
      const name = person.department?.name ?? UNASSIGNED_GROUP;
      const group = byId.get(id) ?? makeGroup(id, name, 1);
      group.people.push(person);
      byId.set(id, group);
    }
    const groups = [...byId.values()].sort((a, b) => {
      const rank = (g: OrgGroup) => (g.id === 'dept:none' ? 1 : 0);
      return rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    for (const group of groups) measure(group);
    return { groups, depth: 1, fallback: true, unassigned: [] };
  }

  // ── 真部门树 ──
  const peopleById = new Map(people.map(p => [p.user_id, p]));
  const placement = new Map<string, string | null>();
  for (const person of people) placement.set(person.user_id, person.department?.id ?? null);
  for (const m of input.members ?? []) {
    if (peopleById.has(m.user_id)) placement.set(m.user_id, m.department_id ?? null);
  }

  const byId = new Map<string, OrgGroup>();
  const leaderOf = new Map<string, string | undefined>();
  const sortOf = new Map<string, number>();
  for (const d of depts) {
    byId.set(d.id, makeGroup(`dept:${d.id}`, d.name, 1));
    sortOf.set(d.id, d.sort ?? 0);
    const leader = d.leader_user_id ? peopleById.get(d.leader_user_id) : undefined;
    if (leader) leaderOf.set(d.id, personName(leader));
  }

  const roots: OrgGroup[] = [];
  const parentOfGroup = new Map<string, string>();
  for (const d of depts) {
    const group = byId.get(d.id)!;
    const parent = d.parent_id ? byId.get(d.parent_id) : undefined;
    if (parent) {
      parent.children.push(group);
      parentOfGroup.set(group.id, parent.id);
    } else {
      roots.push(group);
    }
    // 负责人按「直属」挂：子部门的负责人不该覆盖父部门。
    const leader = leaderOf.get(d.id);
    if (leader) group.leader = leader;
  }

  // 深度 + 子部门排序
  let maxDepth = 1;
  const assignDepth = (group: OrgGroup, depth: number) => {
    group.depth = depth;
    maxDepth = Math.max(maxDepth, depth);
    group.children.sort((a, b) => {
      const da = sortOf.get(a.id.slice(5)) ?? 0;
      const db = sortOf.get(b.id.slice(5)) ?? 0;
      return da - db || a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    for (const child of group.children) assignDepth(child, depth + 1);
  };
  roots.sort((a, b) => {
    const da = sortOf.get(a.id.slice(5)) ?? 0;
    const db = sortOf.get(b.id.slice(5)) ?? 0;
    return da - db || a.name.localeCompare(b.name, 'zh-Hans-CN');
  });
  for (const root of roots) assignDepth(root, 1);

  // 人按落位挂到部门；部门 id 不存在的人进「未分组」，不丢。
  const unassigned: OrgPersonLike[] = [];
  for (const person of people) {
    const deptId = placement.get(person.user_id);
    const group = deptId ? byId.get(deptId) : undefined;
    if (group) group.people.push(person);
    else unassigned.push(person);
  }
  for (const group of byId.values()) group.people = sortPeople(group.people);

  let groups = roots;
  if (unassigned.length > 0) {
    const group = makeGroup('dept:none', UNASSIGNED_GROUP, 1);
    group.people = sortPeople(unassigned);
    groups = [...roots, group];
  }
  for (const group of groups) measure(group);

  if (options.hideEmpty) {
    const prune = (group: OrgGroup): OrgGroup | null => {
      group.children = group.children.map(prune).filter((g): g is OrgGroup => g !== null);
      if (group.people.length === 0 && group.children.length === 0) return null;
      return group;
    };
    groups = groups.map(prune).filter((g): g is OrgGroup => g !== null);
  }

  return { groups, depth: maxDepth, fallback: false, unassigned };
}
