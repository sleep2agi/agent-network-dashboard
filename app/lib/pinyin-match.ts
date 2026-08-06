'use client';

import { useSyncExternalStore } from 'react';

/* Loop R25: one pinyin matcher for every search surface (chat @-mentions,
 * /nodes, /messages). pinyin-pro stays a LAZY chunk — the dict loads on the
 * first non-empty filter, never on page load. Matching = substring OR full
 * pinyin OR initials, cached per string. Callers pair pinyinMatch() with
 * usePinyinReady() so results upgrade in place once the dict arrives. */

type PinyinFn = (text: string) => [string, string];

let py: PinyinFn | null = null;
let loadStarted = false;
const listeners = new Set<() => void>();
const cache = new Map<string, [string, string]>();

function ensureLoaded() {
  if (py || loadStarted || typeof window === 'undefined') return;
  loadStarted = true;
  import('pinyin-pro')
    .then((m) => {
      py = (text: string) => [
        m.pinyin(text, { toneType: 'none', type: 'array' }).join('').toLowerCase(),
        m.pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase(),
      ];
      listeners.forEach((l) => l());
    })
    .catch(() => { loadStarted = false; });
}

export function pinyinMatch(text: string, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  if (text.toLowerCase().includes(f)) return true;
  ensureLoaded();
  if (!py) return false;
  let entry = cache.get(text);
  if (!entry) { entry = py(text); cache.set(text, entry); }
  return entry[0].includes(f) || entry[1].includes(f);
}

function subscribeReady(callback: () => void) {
  listeners.add(callback);
  return () => void listeners.delete(callback);
}

/** True once the pinyin dict is loaded — subscribe so the component
 *  re-filters when lazy loading completes mid-typing. */
export function usePinyinReady(): boolean {
  return useSyncExternalStore(subscribeReady, () => Boolean(py), () => false);
}
