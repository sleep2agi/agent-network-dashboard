/**
 * 按部门筛任务 —— 纯函数，测在 dept-task-filter.test.mjs。
 *
 * 背景：客户端有「点部门看这个部门的任务」，但 Hub 的任务接口目前只支持
 * status / from_name / to_name，没有 department_id。所以 Dashboard 这边
 * 只能做**投影**：拿通讯录里「人 → 名下 Agent alias」的映射，把任务的
 * from/to 落到部门上，再在客户端过滤。
 *
 * 这有几个必须诚实对待的边界（也是写在这里的原因）：
 *   1. 投影口径 ≠ 服务端过滤。任务列表只取了一页（limit），部门过滤后
 *      的数量不是该部门的总数，UI 必须写清楚，不能冒充「部门全量」。
 *   2. 不认识的 alias（人已离职 / Agent 不在通讯录里）一律不算任何部门，
 *      宁可显示「未归属」，也不要猜。
 *   3. 部门筛选要包含子部门：筛「平台组」应该带上「平台组 / 前端组」。
 */

import type { LegionDepartment, LegionPerson } from './legion-layout';

/** 任务的参与者字段：真 Hub 给 from_name/to_name，个别兼容路径只给
 *  from_alias/to_alias，四个都认，避免「任务看得见但部门筛不出来」。 */
export type TaskLike = {
  from_name?: string | null;
  to_name?: string | null;
  from_alias?: string | null;
  to_alias?: string | null;
};

/** 人 → 名下 Agent alias 的反查表：alias → user_id。 */
export function buildAliasUserMap(people: LegionPerson[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const person of people) {
    for (const agent of person.agents ?? []) {
      if (agent?.alias) map.set(agent.alias, person.user_id);
    }
  }
  return map;
}

/** 人 → 部门 id。优先用 members 落位表（与客户端 org 同源），
 *  没有落位表时退回 person.department.id。 */
export function buildUserDeptMap(
  people: LegionPerson[],
  members?: Array<{ user_id: string; department_id: string | null }> | null,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const person of people) {
    const fromMembers = members?.find(m => m.user_id === person.user_id);
    const deptId = fromMembers ? fromMembers.department_id : person.department?.id ?? null;
    if (deptId) map.set(person.user_id, deptId);
  }
  return map;
}

/** 某个部门 + 所有子孙部门的 id 集合。departments 为空时只返回自己。 */
export function collectDeptSubtree(
  departments: LegionDepartment[] | null | undefined,
  rootId: string,
): Set<string> {
  const set = new Set<string>([rootId]);
  if (!departments?.length) return set;
  const children = new Map<string, string[]>();
  for (const d of departments) {
    const parent = d.parent_id ?? null;
    if (!parent) continue;
    const arr = children.get(parent) ?? [];
    arr.push(d.id);
    children.set(parent, arr);
  }
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of children.get(cur) ?? []) {
      if (!set.has(child)) {
        set.add(child);
        stack.push(child);
      }
    }
  }
  return set;
}

/** 任务的 from/to 只要有一个落在目标部门集合里就算命中。 */
export function taskInDept<T extends TaskLike>(
  task: T,
  aliasUser: Map<string, string>,
  userDept: Map<string, string>,
  deptIds: Set<string>,
): boolean {
  for (const alias of [task.from_name, task.to_name, task.from_alias, task.to_alias]) {
    if (!alias) continue;
    const user = aliasUser.get(alias);
    if (!user) continue;
    const dept = userDept.get(user);
    if (dept && deptIds.has(dept)) return true;
  }
  return false;
}

export function filterTasksByDept<T extends TaskLike>(
  tasks: T[],
  aliasUser: Map<string, string>,
  userDept: Map<string, string>,
  deptIds: Set<string>,
): T[] {
  if (deptIds.size === 0) return tasks;
  return tasks.filter(t => taskInDept(t, aliasUser, userDept, deptIds));
}

/** 给下拉框用的部门选项：按名称排序，附带「直属人数」。 */
export function deptOptions(
  departments: LegionDepartment[] | null | undefined,
  people: LegionPerson[],
  members?: Array<{ user_id: string; department_id: string | null }> | null,
): Array<{ id: string; name: string; depth: number }> {
  if (!departments?.length) {
    // 老 Hub 没有部门树：用通讯录里的部门名合成一层。
    const names = new Map<string, string>();
    for (const person of people) {
      if (person.department?.id) names.set(person.department.id, person.department.name);
    }
    return [...names.entries()]
      .map(([id, name]) => ({ id, name, depth: 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  const depthOf = new Map<string, number>();
  const byId = new Map(departments.map(d => [d.id, d]));
  const depth = (id: string): number => {
    if (depthOf.has(id)) return depthOf.get(id)!;
    let d = 0;
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur?.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      d += 1;
      cur = byId.get(cur.parent_id);
    }
    depthOf.set(id, d);
    return d;
  };

  return departments
    .map(d => ({ id: d.id, name: d.name, depth: depth(d.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}
