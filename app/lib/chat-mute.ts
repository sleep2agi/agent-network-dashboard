'use client';

import { useSyncExternalStore } from 'react';

/* Loop R34 (微信消息免打扰, 克制版): per-conversation mute. Muted
 * conversations keep their red badge but show a DOT instead of the count,
 * and their unreads are excluded from the global total (WeChat semantics).
 * Same storage/reactivity pattern as chat-drafts. */

const STORE_KEY = 'anet_chat_mute_v1';
const MUTE_EVENT = 'anet-chat-mute-updated';

function readSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function isMuted(alias?: string | null): boolean {
  if (!alias) return false;
  return readSet().has(alias);
}

export function toggleMute(alias: string) {
  if (typeof window === 'undefined' || !alias) return;
  try {
    const s = readSet();
    if (s.has(alias)) s.delete(alias);
    else s.add(alias);
    window.localStorage.setItem(STORE_KEY, JSON.stringify([...s]));
    window.dispatchEvent(new Event(MUTE_EVENT));
  } catch {}
}

let version = 0;
function subscribe(callback: () => void) {
  const bump = () => { version++; callback(); };
  window.addEventListener(MUTE_EVENT, bump);
  window.addEventListener('storage', bump);
  return () => {
    window.removeEventListener(MUTE_EVENT, bump);
    window.removeEventListener('storage', bump);
  };
}

export function useMuted(alias?: string | null): boolean {
  return useSyncExternalStore(subscribe, () => (alias ? isMuted(alias) : false), () => false);
}

/** Monotonic version for callers that use plain isMuted() inside render
 *  loops (map callbacks can't call hooks). */
export function useMuteVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
