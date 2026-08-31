import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * PR4 #338 — proxy GET /api/host-supervisors (RFC-026 §9.2 / list_host_supervisors
 * REST mirror; landed in commhub-server@0.9.0-preview.8).
 *
 * Returns the same shape the hub does (count + daemons[]), with `selected` hint
 * the picker uses for its 3-state UI:
 *   - count=0 → onboarding (no daemon yet, show install instructions)
 *   - count=1 → auto-pick (preselect the only daemon)
 *   - count≥2 → user picker (show all daemons, surface telemetry to help choose)
 *
 * Honest degrade: if the hub doesn't have list_host_supervisors yet (preview.7
 * or older), return ok:false with a flagged status — the client renders an
 * "upgrade hub" hint rather than a fake empty list.
 */

interface DaemonRow {
  // Hub returns daemon_node_id, not node_id (PR2 v2 §9.2 mirror chose
  // that name to make the foreign-key intent explicit). Locked at the
  // contract layer; client passes it back to create_node as daemon_node_id.
  daemon_node_id: string;
  alias: string;
  hostname?: string | null;
  online?: boolean;
  last_seen_at?: string | null;
  runtimes_supported?: string[];
  allowed_secret_keys?: string[];
  host_telemetry?: {
    alert_level?: 'green' | 'yellow' | 'red' | 'gray';
    cpu_cores?: number | null;
    mem_gb?: number | null;
    ip_internal?: string | null;
  };
  // #1545 —— daemon 自报的「我现在能不能建节点」。hub 在 server.ts 的
  // /api/host-supervisors 里带出，本路由是**整体透传**（见文件末尾的
  // Response.json），所以这三格其实早就到浏览器了，缺的只是类型和渲染。
  //
  // 🔴 三态，不是两态：`undefined`（从没报过）**不等于** `false`（报了说不能）。
  //    渲染见 app/lib/daemon-capability.ts，那里三态各有一句不同的话。
  can_create_nodes?: boolean;
  create_nodes_blocked_reason?: string;
  /** 该能力值是在**这份 report 发出前 N 毫秒**测得的。
   *  绝对年龄 = (now - last_seen_at) + 本值。 */
  create_capability_observed_ms_ago?: number;
}

interface ServerRow {
  hostname: string;
  status?: 'online' | 'offline';
}

interface HostSupervisorRow {
  hostname: string;
  status?: 'online' | 'offline';
  daemon: DaemonRow | null;
  has_daemon: boolean;
}

interface HubResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  daemons?: DaemonRow[];
}

async function loadServers(): Promise<ServerRow[]> {
  try {
    const res = await hubFetch('/api/servers');
    if (!res.ok) return [];
    const raw = await res.json().catch(() => ({}));
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.servers) ? raw.servers : [];
    return rows
      .filter((s: unknown): s is ServerRow => Boolean(s) && typeof s === 'object' && typeof (s as ServerRow).hostname === 'string')
      .map((s: ServerRow) => ({
        hostname: s.hostname,
        status: s.status,
      }));
  } catch {
    return [];
  }
}

function normalizeHost(hostname: string | null | undefined) {
  return (hostname || '').trim().toLowerCase();
}

function mergeHosts(servers: ServerRow[], daemons: DaemonRow[]): HostSupervisorRow[] {
  const byHost = new Map<string, HostSupervisorRow>();
  for (const s of servers) {
    const key = normalizeHost(s.hostname);
    if (!key) continue;
    byHost.set(key, { ...s, daemon: null, has_daemon: false });
  }
  for (const d of daemons) {
    const hostname = d.hostname || d.alias || d.daemon_node_id;
    const key = normalizeHost(hostname);
    const existing = key ? byHost.get(key) : undefined;
    if (existing) {
      byHost.set(key, { hostname: existing.hostname, status: existing.status, daemon: d, has_daemon: true });
    } else {
      byHost.set(key || d.daemon_node_id, {
        hostname,
        status: d.online === false ? 'offline' : 'online',
        daemon: d,
        has_daemon: true,
      });
    }
  }
  return [...byHost.values()].sort((a, b) => {
    if (a.has_daemon !== b.has_daemon) return a.has_daemon ? -1 : 1;
    return a.hostname.localeCompare(b.hostname);
  });
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  // #338 GA-blocker (2026-07-04, 通信龙 catch): hub /api/host-supervisors
  // (post-#380) requires an explicit network_id for admin utok callers —
  // admin membership spans networks, so hub refuses to guess ("400
  // missing_network_id"). The create-node wizard's picker forwards the
  // NetworkProvider context value verbatim, and on first-load (before
  // sessionStorage rehydrates) that value is the empty string → the
  // picker sends the query without network_id → hub 400 → wizard stuck
  // at step 1 for every admin. Fall back to resolveDefaultNetworkId
  // here rather than propagate the 400 to the picker UI; empty context
  // is a first-load reality, not a user error. #381 hub-side single-
  // network fallback covers the same case for non-admin utoks — this
  // fixes the admin path symmetrically.
  let networkId = searchParams.get('network_id');
  if (!networkId) {
    networkId = await resolveDefaultNetworkId();
  }
  const path = networkId
    ? `/api/host-supervisors?network_id=${encodeURIComponent(networkId)}`
    : '/api/host-supervisors';

  try {
    const [res, servers] = await Promise.all([hubFetch(path), loadServers()]);
    if (res.status === 404 || res.status === 501) {
      return Response.json(
        {
          ok: false,
          unconfirmed: true,
          error: `hub /api/host-supervisors not available (${res.status}) — upgrade commhub-server to >=0.9.0-preview.8`,
          count: 0,
          daemons: [],
        },
        { status: 501 },
      );
    }
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `hub ${res.status}`, count: 0, daemons: [] },
        { status: 502 },
      );
    }
    const data = (await res.json().catch(() => ({}))) as HubResponse;
    const daemons = Array.isArray(data?.daemons) ? data.daemons : [];
    const count = typeof data?.count === 'number' ? data.count : daemons.length;
    const selected = count === 1 ? daemons[0]?.daemon_node_id || null : null;
    return Response.json({ ok: true, count, daemons, hosts: mergeHosts(servers, daemons), selected });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), count: 0, daemons: [] },
      { status: 502 },
    );
  }
}
