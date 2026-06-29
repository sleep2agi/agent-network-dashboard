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

// RFC-027 PR2 — alias → lifecycle_state map sourced from /api/nodes
// (commhub-server preview.12+). /api/status reads from `sessions` which
// doesn't carry lifecycle_state; /api/nodes does. Cheap secondary
// fetch, same SWR cadence as useSessions; merged client-side by alias.
// Absent alias → caller defaults to 'active'.
interface NodesResp { nodes?: Array<{ alias?: string; node_id?: string; lifecycle_state?: string | null }>; }
export function useNodeLifecycle() {
  const { networkId } = useNetworkId();
  const { data, error } = useSWR<NodesResp>(
    withNetwork('/api/hub/nodes', networkId),
    fetcher,
    SWR_OPTIONS,
  );
  const lifecycleByAlias: Record<string, string> = {};
  const nodeIdByAlias: Record<string, string> = {};
  for (const n of data?.nodes ?? []) {
    if (n.alias && typeof n.lifecycle_state === 'string') lifecycleByAlias[n.alias] = n.lifecycle_state;
    if (n.alias && typeof n.node_id === 'string') nodeIdByAlias[n.alias] = n.node_id;
  }
  return { lifecycleByAlias, nodeIdByAlias, error };
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
