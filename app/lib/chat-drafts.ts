'use client';

import { useSyncExternalStore } from 'react';
import { CHAT_DRAFT_PREFIX, chatPrivateScope } from './chat-outbox';

// Loop R10 (微信草稿闭环): draft storage shared between the chat panel
// (write/restore) and conversation-list surfaces (the "[草稿]" mark).
// Same-tab reactivity via a custom event, cross-tab via the storage event.
const DRAFT_EVENT = 'anet-chat-draft-updated';

function draftKey(scope: string, alias: string) { return `${CHAT_DRAFT_PREFIX}${scope}:${encodeURIComponent(alias)}`; }

export function readDraft(alias?: string | null, networkId?: string | null): string {
  if (typeof window === 'undefined' || !alias) return '';
  try {
    const scope = chatPrivateScope(networkId);
    return scope ? window.localStorage.getItem(draftKey(scope, alias)) || '' : '';
  } catch {
    return '';
  }
}

/** Empty/whitespace text deletes the draft — sending or clearing the box
 *  leaves no stale key behind. */
export function writeDraft(alias: string, text: string, networkId?: string | null) {
  if (typeof window === 'undefined' || !alias) return;
  try {
    const scope = chatPrivateScope(networkId);
    if (!scope) return;
    const key = draftKey(scope, alias);
    if (text.trim()) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent(DRAFT_EVENT, { detail: { alias } }));
  } catch {}
}

function subscribe(callback: () => void) {
  window.addEventListener(DRAFT_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(DRAFT_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

export function useHasDraft(alias?: string | null): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (alias ? Boolean(readDraft(alias)) : false),
    () => false,
  );
}
