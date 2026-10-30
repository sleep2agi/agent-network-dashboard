export interface RequirementPersonChoice {
  id: string;
  kind: 'user' | 'node';
  name: string;
  display_name?: string;
  unavailable?: boolean;
}

export interface PersonOption {
  value: string;
  kind: 'user' | 'node';
  label: string;
  search: string;
}

/** Reject a grouped MCP response instead of treating it as an empty directory. */
export function readRequirementPeople(data: unknown): RequirementPersonChoice[] {
  if (!data || typeof data !== 'object' || !('ok' in data) || data.ok !== true
      || !('people' in data) || !Array.isArray(data.people)
      || ('has_more' in data && data.has_more === true)) throw new Error('invalid_people_catalog');
  const people: RequirementPersonChoice[] = [];
  for (const row of data.people) {
    if (!row || (row.kind !== 'user' && row.kind !== 'node') || typeof row.id !== 'string' || !row.id
        || typeof row.name !== 'string'
        || (row.display_name !== undefined && typeof row.display_name !== 'string')
        || (row.unavailable !== undefined && typeof row.unavailable !== 'boolean')) throw new Error('invalid_people_catalog');
    people.push(row);
  }
  return people;
}

export function peopleOptions(people: readonly RequirementPersonChoice[]): PersonOption[] {
  const refs = new Map(people.map(p => [`${p.kind}:${p.id}`, p]));
  const name = (p: RequirementPersonChoice) => p.display_name?.trim() || p.name || p.id;
  const counts = new Map<string, number>();
  for (const p of refs.values()) {
    const key = `${p.kind}:${name(p)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...refs].map(([value, p]) => ({
    value, kind: p.kind,
    label: `${name(p)}${(counts.get(`${p.kind}:${name(p)}`) || 0) > 1 ? ` · ${p.id}` : ''}${p.unavailable ? '（已不可用）' : ''}`,
    search: `${name(p)} ${p.name} ${value}`.toLocaleLowerCase(),
  })).sort((a, b) => a.label.localeCompare(b.label, 'zh') || a.value.localeCompare(b.value));
}

export function validResponsibility(owner: string, agent: string): boolean {
  return (!owner || owner === 'none' || /^user:.+$/u.test(owner))
    && (!agent || agent === 'none' || /^node:.+$/u.test(agent));
}

export function responsibilityValue(owner: string, agent: string): string {
  if (!owner && !agent) return '';
  if (!validResponsibility(owner, agent)) return 'invalid';
  if (owner === 'none' && agent === 'none') return 'none';
  if (owner && agent) return 'combined';
  if (owner) return owner === 'none' ? 'owner:none' : owner;
  return agent === 'none' ? 'agent:none' : agent;
}

/** One picker choice replaces both role conditions; unassigned means BOTH null. */
export function responsibilityPatch(value: string): { owner: string; agent_owner: string } {
  if (value === '') return { owner: '', agent_owner: '' };
  if (value === 'none') return { owner: 'none', agent_owner: 'none' };
  if (value === 'owner:none') return { owner: 'none', agent_owner: '' };
  if (value === 'agent:none') return { owner: '', agent_owner: 'none' };
  if (/^user:.+$/u.test(value)) return { owner: value, agent_owner: '' };
  if (/^node:.+$/u.test(value)) return { owner: '', agent_owner: value };
  throw new Error('invalid_responsibility_choice');
}
