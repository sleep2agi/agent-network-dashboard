import { describe, expect, test } from 'bun:test';
import {
  addChecklistItem, checklistPayload, CHECKLIST_MAX_ITEMS, CHECKLIST_TEXT_MAX,
  moveChecklistItem, newChecklistId, removeChecklistItem, setChecklistDone, validateChecklist,
} from './checklist-model';

const item = (id, text, done = false) => ({ id, text, done });

describe('checklist editing (Hub 整张替换)', () => {
  test('ids are client-generated and unique-looking', () => {
    const a = newChecklistId(), b = newChecklistId();
    expect(a).toMatch(/^ck_[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });

  test('add trims, folds newlines, and rejects empty / long / full lists', () => {
    const added = addChecklistItem([], '  第一行\n第二行  ', 'ck_1');
    expect(added).toEqual([{ id: 'ck_1', text: '第一行 第二行', done: false }]);
    expect(addChecklistItem([], '   ', 'ck_2')).toBeNull();
    expect(addChecklistItem([], 'x'.repeat(CHECKLIST_TEXT_MAX + 1), 'ck_3')).toBeNull();
    const full = Array.from({ length: CHECKLIST_MAX_ITEMS }, (_, i) => item(`c${i}`, `第 ${i} 项`));
    expect(addChecklistItem(full, '再多一个', 'ck_4')).toBeNull();
  });

  test('remove and toggle only touch the target item', () => {
    const list = [item('a', 'A'), item('b', 'B')];
    expect(removeChecklistItem(list, 'a').map(entry => entry.id)).toEqual(['b']);
    expect(setChecklistDone(list, 'b', true)[1].done).toBe(true);
    expect(setChecklistDone(list, 'b', true)[0].done).toBe(false);
  });

  test('move swaps positions and ignores out-of-range moves', () => {
    const list = [item('a', 'A'), item('b', 'B'), item('c', 'C')];
    expect(moveChecklistItem(list, 0, 2).map(entry => entry.id)).toEqual(['b', 'c', 'a']);
    expect(moveChecklistItem(list, 2, 0).map(entry => entry.id)).toEqual(['c', 'a', 'b']);
    expect(moveChecklistItem(list, 1, 1)).toBe(list);
    expect(moveChecklistItem(list, -1, 1)).toBe(list);
    expect(moveChecklistItem(list, 0, 5)).toBe(list);
  });

  test('validation mirrors the Hub: non-empty, ≤500 chars, ≤100 items', () => {
    expect(validateChecklist([])).toBeNull();
    expect(validateChecklist([item('a', 'A')])).toBeNull();
    expect(validateChecklist([item('a', '   ')])).toContain('不能是空的');
    expect(validateChecklist([item('a', 'x'.repeat(CHECKLIST_TEXT_MAX + 1))])).toContain('500');
    expect(validateChecklist([item('', 'A')])).toContain('id');
    const tooMany = Array.from({ length: CHECKLIST_MAX_ITEMS + 1 }, (_, i) => item(`c${i}`, 'x'));
    expect(validateChecklist(tooMany)).toContain('最多');
  });

  test('payload only carries id / text / done, with trimmed text', () => {
    expect(checklistPayload([{ id: 'a', text: '  A  ', done: true }, { id: 'b', text: 'B' }]))
      .toEqual([{ id: 'a', text: 'A', done: true }, { id: 'b', text: 'B', done: false }]);
  });
});
