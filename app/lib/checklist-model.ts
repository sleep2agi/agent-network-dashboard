/**
 * Checklist editing — mirrors the APP's checklist helpers and the Hub rules
 * (`checklist` is replaced as a whole: ≤100 items, each 1–500 characters,
 * ids are client-generated and kept by the Hub).
 */

export interface ChecklistItem {
  id: string;
  text: string;
  done?: boolean;
}

export const CHECKLIST_MAX_ITEMS = 100;
export const CHECKLIST_TEXT_MAX = 500;

export function newChecklistId(rand: () => number = Math.random): string {
  return `ck_${Array.from({ length: 16 }, () => Math.floor(rand() * 16).toString(16)).join('')}`;
}

/** One-line text; empty, too long, or a full list returns null. */
export function addChecklistItem(
  list: readonly ChecklistItem[],
  text: string,
  id: string = newChecklistId(),
): ChecklistItem[] | null {
  const value = text.replace(/[\r\n]+/g, ' ').trim();
  if (!value || value.length > CHECKLIST_TEXT_MAX || list.length >= CHECKLIST_MAX_ITEMS) return null;
  return [...list, { id, text: value, done: false }];
}

export function removeChecklistItem(list: readonly ChecklistItem[], id: string): ChecklistItem[] {
  return list.filter(item => item.id !== id);
}

/** Move one row up/down; out-of-range or a no-op returns the same array. */
export function moveChecklistItem(
  list: readonly ChecklistItem[],
  from: number,
  to: number,
): readonly ChecklistItem[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function setChecklistDone(list: readonly ChecklistItem[], id: string, done: boolean): ChecklistItem[] {
  return list.map(item => (item.id === id ? { ...item, done } : item));
}

/** Client-side pre-check before sending the whole array. */
export function validateChecklist(list: readonly ChecklistItem[]): string | null {
  if (list.length > CHECKLIST_MAX_ITEMS) return `检查项最多 ${CHECKLIST_MAX_ITEMS} 个`;
  for (const item of list) {
    const text = item.text.trim();
    if (!text) return '检查项不能是空的';
    if (text.length > CHECKLIST_TEXT_MAX) return `单个检查项不能超过 ${CHECKLIST_TEXT_MAX} 个字符`;
    if (!item.id) return '检查项缺少 id，刷新后再试';
  }
  return null;
}

/** What the Hub accepts: only the three documented fields, trimmed. */
export function checklistPayload(list: readonly ChecklistItem[]): Array<{ id: string; text: string; done: boolean }> {
  return list.map(item => ({ id: item.id, text: item.text.trim(), done: item.done === true }));
}
