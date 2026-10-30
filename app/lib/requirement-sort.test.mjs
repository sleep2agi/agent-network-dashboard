import { describe, expect, test } from 'bun:test';
import { parseSort, sortRequirements, SORT_KEYS } from './requirement-sort';

const row = (over = {}) => ({
  id: 'r1', seq: 1, name: 'A', priority: 'normal', due: null,
  updatedAt: null, ...over,
});

describe('requirement sorting (loaded rows only)', () => {
  test('no key keeps Hub order; unknown keys fall back to default', () => {
    const rows = [row({ id: 'b', seq: 2 }), row({ id: 'a', seq: 1 })];
    expect(sortRequirements(rows, { key: '', dir: 'asc' }).map(item => item.id)).toEqual(['b', 'a']);
    expect(parseSort(new URLSearchParams('sort=bogus&dir=desc'))).toEqual({ key: '', dir: 'desc' });
    expect(parseSort(new URLSearchParams('sort=priority'))).toEqual({ key: 'priority', dir: 'asc' });
    expect(SORT_KEYS.map(option => option.key)).toContain('updated');
  });

  test('priority order high → normal → low → lowest, reversed by dir, stable by seq', () => {
    const rows = [
      row({ id: 'l', seq: 3, priority: 'low' }),
      row({ id: 'h', seq: 2, priority: 'high' }),
      row({ id: 'n', seq: 1, priority: 'normal' }),
      row({ id: 'l2', seq: 4, priority: 'low' }),
      row({ id: 'x', seq: 5, priority: 'lowest' }),
    ];
    expect(sortRequirements(rows, { key: 'priority', dir: 'asc' }).map(item => item.id)).toEqual(['h', 'n', 'l', 'l2', 'x']);
    expect(sortRequirements(rows, { key: 'priority', dir: 'desc' }).map(item => item.id)).toEqual(['x', 'l', 'l2', 'n', 'h']);
  });

  test('missing due dates sort last in ascending order', () => {
    const rows = [
      row({ id: 'none', seq: 1, due: null }),
      row({ id: 'later', seq: 2, due: '2026-12-01' }),
      row({ id: 'sooner', seq: 3, due: '2026-11-01' }),
    ];
    expect(sortRequirements(rows, { key: 'due', dir: 'asc' }).map(item => item.id)).toEqual(['sooner', 'later', 'none']);
    expect(sortRequirements(rows, { key: 'due', dir: 'desc' }).map(item => item.id)).toEqual(['later', 'sooner', 'none']);
  });

  test('recently updated sorts by timestamp with missing values last ascending', () => {
    const rows = [
      row({ id: 'old', seq: 1, updatedAt: '2026-10-01T00:00:00Z' }),
      row({ id: 'new', seq: 2, updatedAt: '2026-10-30T00:00:00Z' }),
      row({ id: 'missing', seq: 3, updatedAt: null }),
    ];
    expect(sortRequirements(rows, { key: 'updated', dir: 'desc' }).map(item => item.id)).toEqual(['new', 'old', 'missing']);
    expect(sortRequirements(rows, { key: 'updated', dir: 'asc' }).map(item => item.id)).toEqual(['old', 'new', 'missing']);
  });

  test('title sort is locale-aware and ties fall back to seq', () => {
    const rows = [row({ id: 'b', seq: 2, name: '文档' }), row({ id: 'a', seq: 1, name: '平台' })];
    expect(sortRequirements(rows, { key: 'title', dir: 'asc' }).map(item => item.id)).toEqual(['a', 'b']);
  });
});
