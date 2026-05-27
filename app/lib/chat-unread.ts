'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useNetworkId } from './network-context';

const STORAGE_PREFIX = 'anet_chat_read_v1:';
const UNREAD_EVENT = 'anet-chat-read-updated';

interface ChatMessage {
  from_alias?: string | null;
  created_at?: string | null;
}

interface ChatTask {
  to_name?: string | null;
  status?: string | null;
  result?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  delivered_at?: string | null;
}

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

function readStoredMap(networkId: string): ReadMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey(networkId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredMap(networkId: string, next: ReadMap) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(networkId), JSON.stringify(next));
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
  const { data: messagesData } = useSWR<{ messages?: ChatMessage[] }>(
    withNetwork('/api/hub/messages?limit=200', networkId),
    fetcher,
    { refreshInterval: 5000, dedupingInterval: 3000 },
  );
  const { data: tasksData } = useSWR<{ tasks?: ChatTask[] }>(
    withNetwork('/api/hub/tasks?limit=200', networkId),
    fetcher,
    { refreshInterval: 5000, dedupingInterval: 3000 },
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
    const latestByAlias = new Map<string, number>();
    for (const message of messagesData?.messages || []) {
      const alias = message.from_alias?.trim();
      if (!alias) continue;
      const at = parseHubTime(message.created_at);
      if (!at) continue;
      latestByAlias.set(alias, Math.max(latestByAlias.get(alias) || 0, at));
    }
    for (const task of tasksData?.tasks || []) {
      const alias = task.to_name?.trim();
      if (!alias) continue;
      const hasReply = Boolean(task.result) || ['replied', 'failed', 'closed', 'expired', 'cancelled'].includes(task.status || '');
      if (!hasReply) continue;
      const at = parseHubTime(task.completed_at) || parseHubTime(task.delivered_at) || parseHubTime(task.created_at);
      if (!at) continue;
      latestByAlias.set(alias, Math.max(latestByAlias.get(alias) || 0, at));
    }

    const next = new Map<string, boolean>();
    for (const [alias, latestAt] of latestByAlias) {
      const readAt = parseHubTime(readMap[alias]);
      if (latestAt > readAt) next.set(alias, true);
    }
    return next;
  }, [messagesData, readMap, tasksData]);

  const hasUnread = useCallback((alias?: string | null) => {
    if (!alias) return false;
    return unreadMap.get(alias) === true;
  }, [unreadMap]);

  const clearUnread = useCallback((alias: string) => {
    markChatRead(alias, networkId);
  }, [networkId]);

  return { unreadMap, hasUnread, clearUnread };
}
