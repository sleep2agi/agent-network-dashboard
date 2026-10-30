'use client';

import { useSyncExternalStore } from 'react';

/**
 * Who am I, for “my” filters.
 *
 * The Hub user id is already in the dashboard’s own session snapshot
 * (`anet_v3_auth.user.user_id`, the same id the APP gets from `/api/auth/me`).
 * If a session has no id — password-only login, legacy storage — callers must
 * hide the personal filter rather than guess from a name.
 */
export function readCurrentUserId(session?: Storage): string | null {
  const store = session ?? (typeof window === 'undefined' ? undefined : window.sessionStorage);
  if (!store) return null;
  try {
    const auth = JSON.parse(store.getItem('anet_v3_auth') || 'null');
    const id = auth?.user?.user_id;
    return typeof id === 'string' && id.trim() ? id : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** Server render has no storage: the personal filter simply starts hidden. */
export function useCurrentUserId(): string | null {
  return useSyncExternalStore(subscribe, () => readCurrentUserId(), () => null);
}

/** The owner filter value the Hub accepts for a person. */
export function ownerRefFor(userId: string): string {
  return `user:${userId}`;
}
