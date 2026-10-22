import { describe, expect, test } from 'bun:test';
import { initialPagingState, requirementsPaging } from './requirements-paging';

const page1 = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const page2 = [{ id: 'd' }, { id: 'e' }];

function loadedFirstPage() {
  return requirementsPaging(initialPagingState(), {
    type: 'loaded', phase: 'replace', incoming: page1, nextCursor: 'c2', hasMore: true,
  });
}

describe('#1636 requirements paging — append must not destroy the loaded page', () => {
  test('replace finish: rows installed, cursor kept, both loading flags off', () => {
    const s = loadedFirstPage();
    expect(s.rows).toEqual(page1);
    expect(s.cursor).toBe('c2');
    expect(s.hasMore).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.loadingMore).toBe(false);
  });

  test('append start keeps every loaded row and only raises loadingMore', () => {
    const s = requirementsPaging(loadedFirstPage(), { type: 'start', phase: 'append' });
    expect(s.rows).toEqual(page1);          // 旧实现这里整表变骨架屏
    expect(s.loading).toBe(false);          // 骨架屏分支不得被追加态触发
    expect(s.loadingMore).toBe(true);
    expect(s.hasMore).toBe(true);
  });

  test('append finish concatenates and clears the button spinner', () => {
    const start = requirementsPaging(loadedFirstPage(), { type: 'start', phase: 'append' });
    const s = requirementsPaging(start, {
      type: 'loaded', phase: 'append', incoming: page2, nextCursor: null, hasMore: false,
    });
    expect(s.rows.map(r => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(s.loadingMore).toBe(false);
    expect(s.hasMore).toBe(false);
    expect(s.cursor).toBeNull();
  });

  test('append failure keeps rows and hasMore so the same page can be retried', () => {
    const start = requirementsPaging(loadedFirstPage(), { type: 'start', phase: 'append' });
    const s = requirementsPaging(start, { type: 'failed', phase: 'append', error: 'hub_502' });
    expect(s.rows).toEqual(page1);
    expect(s.hasMore).toBe(true);
    expect(s.cursor).toBe('c2');
    expect(s.loadingMore).toBe(false);
    expect(s.error).toBe('hub_502');
  });

  test('append 401 keeps rows, asks for login, no silent truncation', () => {
    const start = requirementsPaging(loadedFirstPage(), { type: 'start', phase: 'append' });
    const s = requirementsPaging(start, { type: 'unauthorized', phase: 'append' });
    expect(s.rows).toEqual(page1);
    expect(s.needsLogin).toBe(true);
    expect(s.loadingMore).toBe(false);
  });

  test('a second click while append is in flight is ignored (no duplicated page)', () => {
    const start = requirementsPaging(loadedFirstPage(), { type: 'start', phase: 'append' });
    const again = requirementsPaging(start, { type: 'start', phase: 'append' });
    expect(again).toBe(start);
  });

  test('replace start shows the skeleton path and clears the previous error', () => {
    const failed = requirementsPaging(loadedFirstPage(), { type: 'failed', phase: 'replace', error: 'hub_502' });
    const start = requirementsPaging(failed, { type: 'start', phase: 'replace' });
    expect(start.loading).toBe(true);
    expect(start.loadingMore).toBe(false);
    expect(start.error).toBe('');
  });

  test('replace failure empties the list and keeps the reason', () => {
    const s = requirementsPaging(loadedFirstPage(), { type: 'failed', phase: 'replace', error: 'hub_502' });
    expect(s.rows).toEqual([]);
    expect(s.hasMore).toBe(false);
    expect(s.loading).toBe(false);
    expect(s.error).toBe('hub_502');
  });
});
