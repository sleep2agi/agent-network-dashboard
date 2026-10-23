'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useNetworkId } from './network-context';
import { isMuted, useMuteVersion } from './chat-mute';
import { currentUserAlias, mergeMessageFeeds } from './chat-unread-feed';
import { useSSE } from './useSSE';

const STORAGE_PREFIX = 'anet_chat_read_v1:';
const UNREAD_EVENT = 'anet-chat-read-updated';

interface ChatMessage {
  from_alias?: string | null;
  to_alias?: string | null;
  created_at?: string | null;
}

/** Senders/recipients that mean "the dashboard user" in hub data. The chat
 *  panel uses the same set to decide which bubbles are "You". */
const USERISH = new Set(['', 'dashboard', 'admin', 'api', 'hub']);
const isUserish = (v?: string | null) => USERISH.has((v || '').trim().toLowerCase());

interface ReadMap {
  [alias: string]: string;
}

function storageKey(networkId: string) {
  return `${STORAGE_PREFIX}${networkId || 'global'}`;
}

function parseHubTime(value?: string | null): number {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const ts = Date.parse(withZone);
  return Number.isFinite(ts) ? ts : 0;
}

// Loop R8 (Vincent: 未读数字角标): last-read moved sessionStorage →
// localStorage so read state survives refresh/new tabs/restart (微信预期).
// One-time migration pulls any old session value forward.
const BASELINE_KEY = '__baseline';

function readStoredMap(networkId: string): ReadMap {
  if (typeof window === 'undefined') return {};
  try {
    let raw = window.localStorage.getItem(storageKey(networkId));
    if (!raw) {
      raw = window.sessionStorage.getItem(storageKey(networkId));
      if (raw) window.localStorage.setItem(storageKey(networkId), raw);
    }
    const parsed = raw ? JSON.parse(raw) : {};
    const map: ReadMap = parsed && typeof parsed === 'object' ? parsed : {};
    // R8 first-visit floor, written SYNCHRONOUSLY on first read: an async
    // (useEffect) baseline lost the race against the first SWR render and
    // let a badge storm flash — and stick, since nothing re-triggered the
    // count. Ensuring it here means no compute can ever see a missing
    // baseline. No event dispatch: every hook instance does the same
    // idempotent write.
    if (!map[BASELINE_KEY]) {
      map[BASELINE_KEY] = new Date().toISOString();
      window.localStorage.setItem(storageKey(networkId), JSON.stringify(map));
    }
    return map;
  } catch {
    return {};
  }
}

function writeStoredMap(networkId: string, next: ReadMap) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(networkId), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(UNREAD_EVENT, { detail: { networkId } }));
  } catch {}
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status === 401) {
    window.location.assign('/login');
    throw new Error('unauthorized');
  }
  return res.json();
};

function withNetwork(url: string, networkId: string): string {
  if (!networkId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}network_id=${encodeURIComponent(networkId)}`;
}

export function markChatRead(alias: string, networkId: string) {
  if (!alias) return;
  const current = readStoredMap(networkId);
  writeStoredMap(networkId, {
    ...current,
    [alias]: new Date().toISOString(),
  });
}

export function useChatUnread() {
  const { networkId } = useNetworkId();
  // Messages are the ONLY count source: the hub mirrors every task reply as
  // a message to the originator (verified live: replied task + same-second
  // message, both present), so counting tasks too double-counted every
  // reply (E2E showed 4 where 2 was right).
  const { mutate } = useSWRConfig();
  // SSE first, poll as the floor. The badge used to wait up to 5s for the
  // next poll; the hub already pushes an event the moment anything lands, so
  // an event revalidates immediately and the interval only has to cover the
  // case where SSE is unavailable or dropped. Deliberately NOT reading
  // inbox_count off the event: a rule that every future event type must
  // remember to carry the field is a rule that runs on memory. Re-reading
  // the authoritative feed cannot drift.
  const sseEnabled = process.env.NEXT_PUBLIC_DISABLE_SSE !== '1';
  const wideKey = withNetwork('/api/hub/messages?limit=200', networkId);
  // Scoped to the user's own inbox so a busy fleet cannot crowd their mail
  // out of the row window. Merged with (not substituted for) the wide feed —
  // see mergeMessageFeeds for why narrowing alone would drop rows.
  const me = typeof window === 'undefined' ? null : currentUserAlias();
  const inboxKey = me
    ? withNetwork(`/api/hub/messages?limit=200&alias=${encodeURIComponent(me)}`, networkId)
    : null;

  const { connected: sseConnected } = useSSE({
    url: '/api/hub/events',
    enabled: sseEnabled,
    onEvent: (event) => {
      if (!['new_task', 'new_message', 'new_reply', 'broadcast', 'chained_reply'].includes(event.type)) return;
      mutate(wideKey);
      if (inboxKey) mutate(inboxKey);
    },
  });

  // 20s once events are flowing, 5s when they are not — the old cadence is
  // the fallback, never the primary path.
  const refreshInterval = sseConnected ? 20000 : 5000;
  const { data: messagesData } = useSWR<{ messages?: ChatMessage[] }>(
    wideKey,
    fetcher,
    { refreshInterval, dedupingInterval: 3000 },
  );
  const { data: inboxData } = useSWR<{ messages?: ChatMessage[]; pending_count?: number }>(
    inboxKey,
    fetcher,
    { refreshInterval, dedupingInterval: 3000 },
  );
  const [readVersion, setReadVersion] = useState(0);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== storageKey(networkId)) return;
      setReadVersion((v) => (typeof v === 'number' ? v + 1 : 1));
    };
    const onUnreadUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ networkId?: string }>).detail;
      if (detail?.networkId !== undefined && detail.networkId !== networkId) return;
      setReadVersion((v) => (typeof v === 'number' ? v + 1 : 1));
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(UNREAD_EVENT, onUnreadUpdate);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(UNREAD_EVENT, onUnreadUpdate);
    };
  }, [networkId, setReadVersion]);

  const readMap = useMemo(() => {
    void readVersion;
    return readStoredMap(networkId);
  }, [networkId, readVersion]);

  const unreadMap = useMemo(() => {
    // R8: count EVERY unread item per alias (Vincent: "有几条消息显示数字"),
    // not just a latest-activity boolean. A message from the alias counts;
    // a task's REPLY counts once when it lands after last-read. Self-sent
    // items never count (they're keyed by the counterpart alias).
    const counts = new Map<string, number>();
    // R28 (微信排序): recency tiebreak for Overview/Nodes — but ONLY for
    // conversations the user has actually OPENED (read-map entry). On this
    // fleet agents constantly report to 'admin'; counting those yanked
    // never-opened agents to the front on every report (measured: 2 cards
    // jumped 39→1 / 60→3 in one 6s window). WeChat's list holds YOUR
    // conversations — same rule here keeps the grid calm.
    const lastActivity = new Map<string, number>();
    const opened = new Set(Object.keys(readMap).filter((k) => k !== BASELINE_KEY));
    const baseline = parseHubTime(readMap[BASELINE_KEY]);
    const bump = (alias: string, at: number) => {
      if (opened.has(alias) && at > (lastActivity.get(alias) || 0)) lastActivity.set(alias, at);
      const readAt = Math.max(parseHubTime(readMap[alias]), baseline);
      if (at > readAt) counts.set(alias, (counts.get(alias) || 0) + 1);
    };
    // Scope: only the USER'S conversation — a badge on X means "X has
    // something FOR YOU". Fleet chatter (X's messages to other agents)
    // must NOT inflate it.
    for (const message of mergeMessageFeeds(messagesData?.messages, inboxData?.messages)) {
      const alias = message.from_alias?.trim();
      if (!alias || isUserish(alias)) continue;          // own sends never count
      if (!isUserish(message.to_alias)) continue;        // must be addressed to the user
      const at = parseHubTime(message.created_at);
      if (at) bump(alias, at);
    }
    return { counts, lastActivity };
  }, [messagesData, inboxData, readMap]);

  const hasUnread = useCallback((alias?: string | null) => {
    if (!alias) return false;
    return (unreadMap.counts.get(alias) || 0) > 0;
  }, [unreadMap]);

  const unreadCount = useCallback((alias?: string | null) => {
    if (!alias) return 0;
    return unreadMap.counts.get(alias) || 0;
  }, [unreadMap]);

  const lastActivityAt = useCallback((alias?: string | null) => {
    if (!alias) return 0;
    return unreadMap.lastActivity.get(alias) || 0;
  }, [unreadMap]);

  // R34: muted conversations are excluded from the global count (WeChat
  // semantics); hasMutedUnread lets entry badges fall back to a dot.
  const muteVersion = useMuteVersion();
  const { totalUnread, hasMutedUnread } = useMemo(() => {
    void muteVersion;
    let t = 0;
    let mutedAny = false;
    for (const [alias, n] of unreadMap.counts) {
      if (isMuted(alias)) { if (n > 0) mutedAny = true; continue; }
      t += n;
    }
    return { totalUnread: t, hasMutedUnread: mutedAny };
  }, [unreadMap, muteVersion]);

  const clearUnread = useCallback((alias: string) => {
    markChatRead(alias, networkId);
  }, [networkId]);

  return { unreadMap, hasUnread, unreadCount, lastActivityAt, totalUnread, hasMutedUnread, clearUnread };
}

/** WeChat badge label: 1-99 as-is, above → "99+"; 0/negative → '' (hide). */
export function badgeLabel(n: number): string {
  if (n <= 0) return '';
  return n > 99 ? '99+' : String(n);
}
