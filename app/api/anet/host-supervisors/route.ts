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
}

interface ServerRow {
  hostname: string;
  ip?: string | null;
  agent_count?: number;
  cpu_load_1min?: number | null;
  cpu_cores?: number;
  mem_used_gb?: number | null;
  mem_total_gb?: number | null;
  status?: 'online' | 'offline';
  note?: string;
}

interface HostSupervisorRow extends ServerRow {
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
        ip: s.ip ?? null,
        agent_count: s.agent_count ?? 0,
        cpu_load_1min: s.cpu_load_1min ?? null,
        cpu_cores: s.cpu_cores ?? 0,
        mem_used_gb: s.mem_used_gb ?? null,
        mem_total_gb: s.mem_total_gb ?? null,
        status: s.status,
        note: s.note,
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
      byHost.set(key, { ...existing, daemon: d, has_daemon: true });
    } else {
      byHost.set(key || d.daemon_node_id, {
        hostname,
        ip: d.host_telemetry?.ip_internal ?? null,
        agent_count: 1,
        cpu_cores: d.host_telemetry?.cpu_cores ?? 0,
        mem_total_gb: d.host_telemetry?.mem_gb ?? null,
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
