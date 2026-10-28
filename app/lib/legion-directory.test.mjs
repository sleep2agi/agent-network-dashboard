import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlazaDirectory, loadLegionDirectory } from './legion-directory.ts';

const person = { user_id: 'p', username: 'person', display_name: '成员', role: 'member', department: { id: 'a', name: '人员部门' }, agents: [] };
const hierarchy = { departments: [{ id: 'a', name: '人员部门' }, { id: 'b', name: 'Agent部门', parent_id: 'a' }, { id: 'empty', name: '空部门' }] };
const data = agents => ({ ok: true, total: 1, people: [{ ...person, agents }], agents_without_owner: [], agent_department_supported: true, has_more: false });

describe('Agent department contract', () => {
  it('separates person/Agent axes; modern missing/null both stay unassigned', () => {
    const input = data([{ node_id: 'n1', alias: '一', department_id: 'b' }, { node_id: 'n2', alias: '二' }, { node_id: 'n3', alias: '三', department_id: null }]);
    input.agents_without_owner = [{ node_id: 'n4', alias: '无负责人', department_id: 'b' }];
    const result = buildPlazaDirectory(input, hierarchy);
    assert.equal(result.people, 1); assert.equal(result.agents, 4);
    assert.equal(result.platforms.find(p => p.id === 'dept:a').people.length, 1);
    assert.equal(result.platforms.find(p => p.id === 'dept:a').agents.length, 0);
    assert.equal(result.platforms.find(p => p.id === 'dept:b').agents.length, 2);
    assert.equal(result.platforms.find(p => p.id === 'unassigned').agents.length, 2);
    assert.equal(result.platforms.find(p => p.id === 'dept:empty').agents.length, 0);
    assert.equal(result.platforms.find(p => p.id === 'dept:b').parentId, 'dept:a');
  });
  it('only absent capability uses owner placement, and explicit membership null is authoritative', () => {
    const input = data([{ node_id: 'n', alias: 'legacy' }]);
    delete input.agent_department_supported;
    assert.equal(buildPlazaDirectory(input, hierarchy).platforms.find(p => p.id === 'dept:a').agents.length, 1);
    const result = buildPlazaDirectory(input, { ...hierarchy, members: [{ user_id: 'p', department_id: null }] });
    assert.equal(result.platforms.find(p => p.id === 'unassigned').agents.length, 1);
    assert.equal(result.legacy, true);
  });
  it('deduplicates exact aliases by timestamp, not prefix or response order', () => {
    const input = data([{ node_id: 'old', alias: '通信', department_id: 'a', updated_at: '2026-01-01 00:00:00' },
      { node_id: 'new', alias: '通信', department_id: 'b', updated_at: '2026-01-02T00:00:00Z' },
      { node_id: 'other', alias: '通信欧', department_id: 'a' }]);
    const result = buildPlazaDirectory(input, hierarchy);
    assert.equal(result.rawAgents, 3); assert.equal(result.agents, 2);
    assert.equal(result.platforms.find(p => p.id === 'dept:b').agents[0].node_id, 'new');
    input.people[0].agents.reverse();
    assert.deepEqual(buildPlazaDirectory(input, hierarchy), result);
  });
  it('retains unknown placements and terminates cyclic department parents', () => {
    const input = data([{ node_id: 'n', alias: 'unknown', department_id: 'deleted' }]);
    const result = buildPlazaDirectory(input, { departments: [{ id: 'a', name: 'A', parent_id: 'b' }, { id: 'b', name: 'B', parent_id: 'a' }] });
    assert.equal(result.platforms.length, 3);
    assert.equal(result.platforms.find(p => p.id === 'dept:deleted').unknown, true);
    assert.equal(result.platforms.find(p => p.id === 'dept:deleted').agents[0].node_id, 'n');
    assert.ok(result.platforms.some(p => ['dept:a', 'dept:b'].includes(p.id) && p.parentId === null));
  });
  it('keeps the first row on equal update timestamps, matching the client projection', () => {
    const input = data([{ node_id: 'first', alias: 'same', department_id: 'a', updated_at: '2026-01-01T00:00:00Z' },
      { node_id: 'last', alias: 'same', department_id: 'b', updated_at: '2026-01-01T00:00:00Z' }]);
    assert.equal(buildPlazaDirectory(input, hierarchy).platforms.find(p => p.id === 'dept:a').agents[0].node_id, 'first');
  });
});

describe('directory pagination', () => {
  it('keeps first-page orphans and capability while following all offsets in the same network', async () => {
    const seen = [];
    const result = await loadLegionDirectory('/api/hub/people?network_id=net%20A&limit=100', async url => {
      const q = new URL(url, 'https://fixture.invalid').searchParams; seen.push([q.get('offset'), q.get('network_id')]);
      return q.get('offset') === '0'
        ? { ...data([]), people: [person], has_more: true, next_offset: 1, agents_without_owner: [{ node_id: 'o', alias: '孤立' }] }
        : { ...data([]), people: [{ ...person, user_id: 'p2' }], agents_without_owner: undefined };
    });
    assert.deepEqual(seen, [['0', 'net A'], ['1', 'net A']]);
    assert.equal(result.people.length, 2); assert.equal(result.agents_without_owner.length, 1);
    assert.equal(result.agent_department_supported, true); assert.equal(result.has_more, false);
  });
  it('rejects repeated cursor, page failure and capability change without returning partial counts', async () => {
    await assert.rejects(loadLegionDirectory('/people', async () => ({ ...data([]), has_more: true, next_offset: 0 })), /分页未推进/);
    let page = 0;
    await assert.rejects(loadLegionDirectory('/people', async () => { if (page++) throw new Error('forbidden'); return { ...data([]), has_more: true, next_offset: 1 }; }), /forbidden/);
    page = 0;
    await assert.rejects(loadLegionDirectory('/people', async () => ({ ...data([]), agent_department_supported: page++ === 0, has_more: true, next_offset: page })), /能力/);
  });
});
