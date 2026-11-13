import { useEffect } from 'react';
import { hydrateHubAvatars } from './avatars';
import useSWR from 'swr';
import { Session, Health, AnetConfig } from '../components/types';
import { useNetworkId } from './network-context';
import { chromeDeferMs, useDeferredKey } from './chrome-defer';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (res.status === 401) {
    window.location.assign('/login');
    throw new Error('unauthorized');
  }
  // 非 2xx 不能当成数据：代理层失败时返回的是 {error} 而不是列表，
  // 旧行为会让页面把「读失败」渲染成「没有数据」。
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw Object.assign(
      new Error(detail?.error || detail?.message || `HTTP ${res.status}`),
      { status: res.status },
    );
  }
  return res.json();
};

const SWR_OPTIONS = { refreshInterval: 5000, dedupingInterval: 3000 };

/** Append network_id to URL if set */
// 未就绪时返回 null（SWR 的 null key 不发请求）。
// 为什么必须这样：`withNetwork(url, '')` 会**返回无作用域 URL 并发起请求**，
// 网络解析完再按 scoped URL 发一次 —— 首屏因此白打一轮（实测 /api/hub/messages
// 在 4.1s 与 6.2s 各来一次）。network-context 里早就写明了这个用法，只是这些
// 调用点没接 `ready`。
function scopedOrNull(url: string, networkId: string, ready: boolean): string | null {
  if (!ready || !networkId) return null;
  return withNetwork(url, networkId);
}

function withNetwork(url: string, networkId: string): string {
  if (!networkId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}network_id=${encodeURIComponent(networkId)}`;
}

export function useSessions(options?: {
  lite?: boolean;
  initial?: Session[] | null;
  /** 覆盖默认 5s 轮询。只给"数据变化很慢"的页面用（如版本分布），别给需要实时性的页。 */
  refreshInterval?: number;
}) {
  const { networkId, ready } = useNetworkId();
  // initial：服务端已按 cookie 取好的首帧数据（.441）。SWR 会先渲染它，随后照常刷新。
  // 不传时为 undefined ⇒ 与以前完全一致。
  const fallback = options?.initial && options.initial.length
    ? { sessions: options.initial }
    : undefined;
  const { data, error, isLoading, mutate } = useSWR<{ sessions: Session[]; _hint?: { global_count?: number; filtered_network?: string } }>(
    scopedOrNull(options?.lite ? '/api/hub/status?lite=1' : '/api/hub/status', networkId, ready),
    fetcher,
        {
      ...SWR_OPTIONS,
      ...(options?.refreshInterval ? { refreshInterval: options.refreshInterval } : {}),
      // 有 SSR 注入的首帧数据时不再立刻重验证：那份数据就是本次请求刚取的，
      // 立刻再拉一次等于把同一份 258 KB 付两遍（实测 /nodes 6s 内 status 3 次 ≈ 772 KB）。
      ...(fallback ? { fallbackData: fallback, revalidateOnMount: false } : {}),
    },
  );
  return { sessions: data?.sessions || [], hint: data?._hint, error, isLoading, mutate };
}

// RFC-027 PR2 — alias → lifecycle_state map sourced from /api/nodes
// (commhub-server preview.12+). /api/status reads from `sessions` which
// doesn't carry lifecycle_state; /api/nodes does. Cheap secondary
// fetch, same SWR cadence as useSessions; merged client-side by alias.
// Absent alias → caller defaults to 'active'.
interface NodeAttrsSnapshot {
  display_name: string | null;
  /** 节点权限模式（normal / readonly / restricted），未上报为 null。 */
  permission_mode: string | null;
  /** 当前登录是否可以修改权限（来自 viewer_can.permission_mode）。 */
  can_edit_permission: boolean;
  team: string | null;
  tags: string[];
  attrs_revision: number;
}
interface NodesResp { nodes?: Array<{
  alias?: string;
  node_id?: string;
  lifecycle_state?: string | null;
  // #492 goal-item-3: node display attributes (hub PR #497). Legacy
  // rows read as null/[]/0 respectively — no guard needed by callers.
  display_name?: string | null;
  team?: string | null;
  tags?: string[];
  attrs_revision?: number;
  // avatar 接线单: cross-device custom avatar (hub #462 projection)
  avatar_url?: string | null;
  // 节点权限（RFC-041）：normal / readonly / restricted；viewer_can 表示当前登录能否改。
  permission_mode?: string | null;
  viewer_can?: { permission_mode?: boolean } | null;
  /** 节点归属主机（/servers 按主机分组用；lite 投影已保留） */
  server?: string | null;
  hostname?: string | null;
  /** 会话状态（lite 投影保留 status/agent） */
  status?: string | null;
  agent?: string | null;
}>; }
export function useNodeLifecycle() {
  const { networkId, ready } = useNetworkId();
  const { data, error, mutate } = useSWR<NodesResp>(
    // lite=1：全量 394 KB（402 节点），本 hook 只用 alias/node_id/lifecycle_state/avatar/attrs。
    scopedOrNull('/api/hub/nodes?lite=1', networkId, ready),
    fetcher,
    SWR_OPTIONS,
  );
  // avatar 接线单: every consumer of this hook keeps the avatar layer-1
  // store fresh. Effect (not render): hydrate dispatches an event that
  // re-renders avatar consumers — doing that mid-render would warn.
  useEffect(() => { hydrateHubAvatars(data?.nodes); }, [data]);
  // 按主机分组：/servers 用它列出「这台机器上有哪些节点」（客户端 DaemonManagement 的等价能力）
  const nodesByServer: Record<string, Array<{ alias: string; status?: string | null; lifecycle_state?: string | null }>> = {};
  for (const n of data?.nodes ?? []) {
    if (!n.alias) continue;
    const host = (typeof n.server === 'string' && n.server) || (typeof n.hostname === 'string' && n.hostname) || '';
    if (!host) continue;
    (nodesByServer[host] ||= []).push({ alias: n.alias, status: n.status ?? null, lifecycle_state: n.lifecycle_state ?? null });
  }
  const lifecycleByAlias: Record<string, string> = {};
  const nodeIdByAlias: Record<string, string> = {};
  const attrsByAlias: Record<string, NodeAttrsSnapshot> = {};
  for (const n of data?.nodes ?? []) {
    if (n.alias && typeof n.lifecycle_state === 'string') lifecycleByAlias[n.alias] = n.lifecycle_state;
    if (n.alias && typeof n.node_id === 'string') nodeIdByAlias[n.alias] = n.node_id;
    if (n.alias) {
      attrsByAlias[n.alias] = {
        display_name: typeof n.display_name === 'string' ? n.display_name : null,
        permission_mode: typeof n.permission_mode === 'string' ? n.permission_mode : null,
        can_edit_permission: n.viewer_can?.permission_mode === true,
        team: typeof n.team === 'string' ? n.team : null,
        tags: Array.isArray(n.tags) ? n.tags : [],
        attrs_revision: typeof n.attrs_revision === 'number' ? n.attrs_revision : 0,
      };
    }
  }
  return { lifecycleByAlias, nodeIdByAlias, attrsByAlias, nodesByServer, error, refreshNodes: mutate };
}
export type { NodeAttrsSnapshot };

export function useHealth() {
  const { data, error } = useSWR<Health>('/api/hub/health', fetcher, SWR_OPTIONS);
  return { health: data || null, error };
}

export function useAnetConfig() {
  const { data } = useSWR<AnetConfig>('/api/anet/config', fetcher, { refreshInterval: 30000 });
  return { config: data || null };
}

export function useTasks(params?: Record<string, string>, enabled = true) {
  const { networkId, ready } = useNetworkId();
  const query = new URLSearchParams({ limit: '100', ...params }).toString();
  // enabled=false → null key，SWR 不发请求。
  // 用途：首页只在 /api/stats 没有 by_status 时才需要任务列表兜底，
  // 而 tasks?limit=500 生产实测 665,867 B（约 666 KB）。
  const { data, error, isLoading } = useSWR(
    enabled ? scopedOrNull(`/api/hub/tasks?${query}`, networkId, ready) : null,
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
  const { networkId, ready } = useNetworkId();
  const { data, error } = useSWR(scopedOrNull('/api/hub/stats', networkId, ready), fetcher, SWR_OPTIONS);
  return { stats: data?.ok ? data : null, error };
}

/**
 * 任务状态计数（服务端统计，只回数字）。
 * 用于 /api/stats 没有 tasks.by_status 的环境：避免为了 5 个数字下载 500 条任务
 *（生产实测 665,867 B）。enabled=false 时不发请求。
 */
export function useTaskStats(enabled: boolean) {
  const { networkId, ready } = useNetworkId();
  const { data } = useSWR<{ ok: boolean; total: number; byStatus: Record<string, number> }>(
    enabled ? scopedOrNull('/api/hub/task-stats', networkId, ready) : null,
    fetcher,
    SWR_OPTIONS,
  );
  return { taskStats: data?.byStatus ?? null, taskTotal: data?.total ?? null };
}

export function useMessages(limit = 100) {
  const { networkId, ready } = useNetworkId();
  // keepPreviousData: /messages grows `limit` when the user asks for older
  // history (#217 M5) — without it the key change would blank the list and
  // flash the skeleton while the bigger page is in flight.
  const { data, error, isLoading, mutate } = useSWR(
    // `.542`：仅在 ?deferChrome=1 时延后（默认 0，行为不变）
    useDeferredKey(scopedOrNull(`/api/hub/messages?limit=${limit}`, networkId, ready), chromeDeferMs()),
    fetcher,
    { ...SWR_OPTIONS, keepPreviousData: true },
  );
  return { messages: data?.messages || [], error, isLoading, mutate };
}
