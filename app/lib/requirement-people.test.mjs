import { describe, expect, test } from 'bun:test';
import { peopleOptions, readRequirementPeople, responsibilityPatch, responsibilityValue, validResponsibility } from './requirement-people';

describe('responsibility roles follow the REST and APP contracts', () => {
  test('unassigned requires both fields; one missing role is not unassigned', () => {
    expect(responsibilityPatch('none')).toEqual({ owner: 'none', agent_owner: 'none' });
    expect(responsibilityValue('none', '')).toBe('owner:none');
    expect(responsibilityValue('', 'none')).toBe('agent:none');
    expect(responsibilityValue('none', 'node:assigned')).toBe('combined');
  });
  test('changing one picker identity clears the other role; same ID across roles is distinct', () => {
    expect(responsibilityPatch('user:same')).toEqual({ owner: 'user:same', agent_owner: '' });
    expect(responsibilityPatch('node:same')).toEqual({ owner: '', agent_owner: 'node:same' });
    expect(validResponsibility('node:same', '')).toBe(false);
    expect(validResponsibility('', 'user:same')).toBe(false);
    expect(validResponsibility('user:', '')).toBe(false);
    expect(responsibilityValue('user:same', 'node:same')).toBe('combined');
  });
  test('unknown exact IDs remain identities; non-identity picker values cannot be serialized', () => {
    expect(responsibilityValue('user:未知🛰️', '')).toBe('user:未知🛰️');
    expect(() => responsibilityPatch('combined')).toThrow();
    expect(() => responsibilityPatch('invalid')).toThrow();
  });
  test('duplicate display names remain distinguishable and original names are searchable', () => {
    const choices = peopleOptions([
      { kind: 'user', id: 'a', name: 'original', display_name: '同名' },
      { kind: 'user', id: 'b', name: 'second', display_name: '同名' },
      { kind: 'node', id: 'a', name: '同名', unavailable: true },
    ]);
    expect(new Set(choices.map(p => p.value)).size).toBe(3);
    expect(new Set(choices.map(p => p.label)).size).toBe(3);
    expect(choices.find(p => p.value === 'user:a').search).toContain('original');
    expect(choices.find(p => p.value === 'node:a').label).toContain('已不可用');
  });
  test('MCP grouped data, a partial catalogue and malformed identities fail, rather than becoming empty success', () => {
    for (const data of [
      { ok: true, people: [{ user_id: 'a', agents: [] }] },
      { ok: true, people: [], has_more: true },
      { ok: true, people: [{ kind: 'node', id: '', name: 'bad' }] },
    ]) expect(() => readRequirementPeople(data)).toThrow();
    expect(readRequirementPeople({ ok: true, people: [] })).toEqual([]);
  });
});
