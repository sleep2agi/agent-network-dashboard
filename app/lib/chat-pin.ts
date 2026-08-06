'use client';

import { useSyncExternalStore } from 'react';

/* Loop R41 (微信置顶): pinned conversations sort above everything on the
 * Overview/Nodes lists. Same storage/reactivity pattern as chat-mute. */

const STORE_KEY = 'anet_chat_pin_v1';
const PIN_EVENT = 'anet-chat-pin-updated';

function readSet(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function isPinned(alias?: string | null): boolean {
  if (!alias) return false;
  return readSet().has(alias);
}

export function togglePin(alias: string) {
  if (typeof window === 'undefined' || !alias) return;
  try {
    const s = readSet();
    if (s.has(alias)) s.delete(alias);
    else s.add(alias);
    window.localStorage.setItem(STORE_KEY, JSON.stringify([...s]));
    window.dispatchEvent(new Event(PIN_EVENT));
  } catch {}
}

let version = 0;
function subscribe(callback: () => void) {
  const bump = () => { version++; callback(); };
  window.addEventListener(PIN_EVENT, bump);
  window.addEventListener('storage', bump);
  return () => {
    window.removeEventListener(PIN_EVENT, bump);
    window.removeEventListener('storage', bump);
  };
}

export function usePinned(alias?: string | null): boolean {
  return useSyncExternalStore(subscribe, () => (alias ? isPinned(alias) : false), () => false);
}

export function usePinVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
