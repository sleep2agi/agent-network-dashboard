import useSWR from 'swr';
import { Session, Health, AnetConfig } from '../components/types';
import { useNetworkId } from './network-context';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status === 401) {
    window.location.assign('/login');
    throw new Error('unauthorized');
  }
  return res.json();
};

const SWR_OPTIONS = { refreshInterval: 5000, dedupingInterval: 3000 };

/** Append network_id to URL if set */
function withNetwork(url: string, networkId: string): string {
  if (!networkId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}network_id=${encodeURIComponent(networkId)}`;
}

export function useSessions() {
  const { networkId } = useNetworkId();
  const { data, error, isLoading } = useSWR<{ sessions: Session[]; _hint?: { global_count?: number; filtered_network?: string } }>(
    withNetwork('/api/hub/status', networkId),
    fetcher,
    SWR_OPTIONS,
  );
  return { sessions: data?.sessions || [], hint: data?._hint, error, isLoading };
}

export function useHealth() {
  const { data, error } = useSWR<Health>('/api/hub/health', fetcher, SWR_OPTIONS);
  return { health: data || null, error };
}

export function useAnetConfig() {
  const { data } = useSWR<AnetConfig>('/api/anet/config', fetcher, { refreshInterval: 30000 });
  return { config: data || null };
}

export function useTasks(params?: Record<string, string>) {
  const { networkId } = useNetworkId();
  const query = new URLSearchParams({ limit: '100', ...params }).toString();
  const { data, error, isLoading } = useSWR(
    withNetwork(`/api/hub/tasks?${query}`, networkId),
    fetcher,
    SWR_OPTIONS,
  );
  return {
    tasks: data?.tasks || [],
    count: data?.count ?? 0,
    source: data?.source,
    error,
    isLoading,
  };
}

export function useStats() {
  const { networkId } = useNetworkId();
  const { data, error } = useSWR(withNetwork('/api/hub/stats', networkId), fetcher, SWR_OPTIONS);
  return { stats: data?.ok ? data : null, error };
}

export function useMessages(limit = 100) {
  const { networkId } = useNetworkId();
  // keepPreviousData: /messages grows `limit` when the user asks for older
  // history (#217 M5) — without it the key change would blank the list and
  // flash the skeleton while the bigger page is in flight.
  const { data, error, isLoading } = useSWR(
    withNetwork(`/api/hub/messages?limit=${limit}`, networkId),
    fetcher,
    { ...SWR_OPTIONS, keepPreviousData: true },
  );
  return { messages: data?.messages || [], error, isLoading };
}

export function useNodeSession(alias: string) {
  const { data, error, isLoading } = useSWR(
    alias ? `/api/hub/session?alias=${encodeURIComponent(alias)}` : null,
    fetcher,
    SWR_OPTIONS,
  );
  return {
    session: data?.session || null,
    inbox: data?.inbox || [],
    sse: data?.sse || 0,
    error,
    isLoading,
  };
}
