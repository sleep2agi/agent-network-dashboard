import { legionFetcher, type PeopleResponse, type DepartmentsResponse } from './legion-data';
import type { LegionAgentRef, LegionPerson } from './legion-layout';

/** Atomic all-page read. An invalid/repeating cursor must not produce a false total. */
export async function loadLegionDirectory(url: string, read: (url: string) => Promise<PeopleResponse> = legionFetcher): Promise<PeopleResponse> {
  const people = new Map<string, LegionPerson>();
  let first: PeopleResponse | undefined;
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const query = new URL(url, 'http://local.invalid');
    query.searchParams.set('offset', String(offset));
    const result = await read(`${query.pathname}${query.search}`);
    if (!result.ok || !Array.isArray(result.people)) throw new Error('编制响应格式无效');
    if (first && result.agent_department_supported !== first.agent_department_supported) throw new Error('编制能力在分页期间变化，请重试');
    first ??= result;
    for (const person of result.people) people.set(person.user_id, person);
    if (!result.has_more) return { ...first, people: [...people.values()], has_more: false, next_offset: null };
    const next = result.next_offset ?? offset + result.people.length;
    if (!Number.isSafeInteger(next) || next <= offset) throw new Error('编制分页未推进，请重试');
    offset = next;
  }
  throw new Error('编制分页超过读取上限，请重试');
}

export interface PlazaAgent extends LegionAgentRef {
  owner: string | null;
  departmentId: string | null;
}
export interface PlazaDepartment {
  id: string;
  name: string;
  parentId: string | null;
  people: LegionPerson[];
  agents: PlazaAgent[];
  unknown?: boolean;
}

function updatedTime(value?: string): number {
  if (!value) return 0;
  const time = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(time) ? time : 0;
}

/** People and Agents have independent placements; match the client's alias projection. */
export function buildPlazaDirectory(data?: PeopleResponse, hierarchy?: DepartmentsResponse | null) {
  const groups = new Map<string, PlazaDepartment>();
  const definitions = new Map((hierarchy?.departments ?? []).map(d => [d.id, d]));
  const members = new Map((hierarchy?.members ?? []).map(m => [m.user_id, m.department_id]));
  const ensure = (departmentId: string | null, fallbackName?: string) => {
    const id = departmentId == null ? 'unassigned' : `dept:${departmentId}`;
    if (!groups.has(id)) {
      const def = departmentId ? definitions.get(departmentId) : undefined;
      groups.set(id, { id, name: def?.name ?? fallbackName ?? (departmentId ? `未知部门 · ${departmentId}` : '未归属'),
        parentId: def?.parent_id && definitions.has(def.parent_id) ? `dept:${def.parent_id}` : null,
        people: [], agents: [], unknown: !!departmentId && !def && !fallbackName });
    }
    return groups.get(id)!;
  };
  for (const d of [...definitions.values()].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))) ensure(d.id);
  const byAlias = new Map<string, PlazaAgent>();
  let rawAgents = 0;
  const addAgent = (agent: LegionAgentRef, owner: LegionPerson | null, ownerDept: string | null) => {
    rawAgents++;
    const placed: PlazaAgent = { ...agent, owner: owner ? owner.display_name || owner.username : null,
      departmentId: data?.agent_department_supported === true ? agent.department_id ?? null : ownerDept };
    const key = agent.alias ? `alias:${agent.alias}` : `node:${agent.node_id}`;
    const old = byAlias.get(key);
    // Match the client/Hub tie rule: equal timestamps retain the first row.
    if (!old || updatedTime(placed.updated_at) > updatedTime(old.updated_at)) byAlias.set(key, placed);
  };
  for (const p of data?.people ?? []) {
    const dept = members.has(p.user_id) ? members.get(p.user_id)! : p.department?.id ?? null;
    ensure(dept, dept === p.department?.id ? p.department.name : undefined).people.push(p);
    for (const a of p.agents) addAgent(a, p, dept);
  }
  for (const a of data?.agents_without_owner ?? []) addAgent(a, null, null);
  for (const agent of byAlias.values()) ensure(agent.departmentId).agents.push(agent);
  for (const g of groups.values()) {
    // Corrupt/cyclic parent data must not hide departments or recurse forever.
    const seen = new Set([g.id]);
    let parent = g.parentId;
    while (parent) {
      if (seen.has(parent)) { g.parentId = null; break; }
      seen.add(parent);
      parent = groups.get(parent)?.parentId ?? null;
    }
    g.agents.sort((a, b) => a.alias.localeCompare(b.alias));
  }
  const platforms: PlazaDepartment[] = [];
  const ordered = new Set<string>();
  const visit = (group: PlazaDepartment) => {
    if (ordered.has(group.id)) return;
    if (group.parentId) { const parent = groups.get(group.parentId); if (parent) visit(parent); }
    ordered.add(group.id);
    platforms.push(group);
  };
  for (const g of groups.values()) visit(g);
  return { platforms, rawAgents, agents: byAlias.size, people: data?.people.length ?? 0,
    legacy: data != null && data.agent_department_supported !== true };
}
