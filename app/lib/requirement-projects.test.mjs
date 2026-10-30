import { describe, expect, test } from 'bun:test';
import { projectNetworkMismatch, projectOptions } from './requirement-projects';

describe('project paths preserve exact IDs and visible ancestry', () => {
  test('child-before-parent input becomes a parent-first path without mutating data', () => {
    const input = [
      { id: 'child', name: 'Web', parent_id: 'parent', sort: 0 },
      { id: 'later', name: 'Other', sort: 2 },
      { id: 'parent', name: 'ANet', sort: 1 },
    ];
    const original = JSON.stringify(input);
    expect(projectOptions(input)).toEqual([
      { id: 'parent', label: 'ANet', archived: false },
      { id: 'child', label: 'ANet / Web', archived: false },
      { id: 'later', label: 'Other', archived: false },
    ]);
    expect(JSON.stringify(input)).toBe(original);
  });

  test('missing parents are not invented; archived identity remains distinguishable', () => {
    expect(projectOptions([
      { id: 'orphan', name: '可见子项目', parent_id: 'hidden' },
      { id: 'archived', name: '历史', archived: true },
    ])).toEqual(expect.arrayContaining([
      { id: 'orphan', label: '可见子项目', archived: false },
      { id: 'archived', label: '历史', archived: true },
    ]));
  });

  test('cycles and self-parenting terminate with each ID once', () => {
    const options = projectOptions([
      { id: 'a', name: 'A', parent_id: 'b' },
      { id: 'b', name: 'B', parent_id: 'a' },
      { id: 'self', name: 'Self', parent_id: 'self' },
    ]);
    expect(options).toHaveLength(3);
    expect(new Set(options.map(p => p.id)).size).toBe(3);
  });

  test('network echo: missing means older Hub (no error), equal passes, different is a mismatch', () => {
    expect(projectNetworkMismatch({ ok: true }, 'net_a')).toBeNull();
    expect(projectNetworkMismatch({ network_id: undefined }, 'net_a')).toBeNull();
    expect(projectNetworkMismatch({ network_id: '' }, 'net_a')).toBeNull();
    expect(projectNetworkMismatch({ network_id: 'net_a' }, 'net_a')).toBeNull();
    expect(projectNetworkMismatch({ network_id: 'net_b' }, 'net_a')).toBe('net_b');
    expect(projectNetworkMismatch({ network_id: 'net_b' }, '')).toBeNull();
  });
});
