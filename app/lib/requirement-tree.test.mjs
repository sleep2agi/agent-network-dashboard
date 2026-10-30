import { describe, expect, test } from 'bun:test';
import { buildTreeRows } from './requirement-tree';

const row = (id, parent_id = null, seq = 0) => ({ id, parent_id, seq, name: id });

describe('requirement tree over loaded rows', () => {
  test('nests children under their parent and keeps order', () => {
    const rows = [row('a'), row('a1', 'a'), row('a2', 'a'), row('a1x', 'a1'), row('b')];
    const flat = buildTreeRows(rows).map(entry => [entry.row.id, entry.depth, entry.hasChildren]);
    expect(flat).toEqual([['a', 0, true], ['a1', 1, true], ['a1x', 2, false], ['a2', 1, false], ['b', 0, false]]);
  });

  test('a child whose parent is not loaded stays a root', () => {
    const rows = [row('orphan', 'missing'), row('root')];
    expect(buildTreeRows(rows).map(entry => entry.row.id)).toEqual(['orphan', 'root']);
  });

  test('collapsing hides the whole subtree', () => {
    const rows = [row('a'), row('a1', 'a'), row('a1x', 'a1')];
    const collapsed = new Set(['a']);
    expect(buildTreeRows(rows, collapsed).map(entry => entry.row.id)).toEqual(['a']);
    expect(buildTreeRows(rows, new Set(['a1'])).map(entry => entry.row.id)).toEqual(['a', 'a1']);
  });

  test('a cycle in the data still shows every row once', () => {
    const rows = [row('x', 'y'), row('y', 'x')];
    const ids = buildTreeRows(rows).map(entry => entry.row.id);
    expect(new Set(ids).size).toBe(2);
  });
});
