import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';
import { dedupeByHostname, parseHubTime, type HubServerRow } from '@/app/lib/serverDedupe';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Proxy: GET /api/servers from CommHub. Aggregates host telemetry across
 * sessions and returns one card per server (hostname, ip, cpu/mem load,
 * agent_count, status). Per issue #119; lands in v0.8.1-preview.2 of the
 * commhub-server (通信牛). The dashboard <ServersDrawer> mounts in
 * AppShell and refreshes every 5s when expanded.
 *
 * v0.10.0 Hero 1+2 — normalization layer. commhub-server@0.8.1-preview.5
 * (LOCAL hub upgraded 2026-05-16 per 通信龙 d627eca7) returns:
 *   raw array `[{hostname, ip, agent_count, cpu_load_1min, cpu_cores,
 *                mem_avail_gb, mem_used_gb, last_seen}, ...]`
 * — without the `{servers: [...]}` envelope the dashboard's ServersDrawer
 * expects. Also uses `mem_avail_gb` instead of `mem_total_gb`. This
 * proxy normalizes both:
 *   1. Wraps raw array in `{servers: [...]}` envelope. If hub later
 *      switches to that shape natively, the pass-through still works.
 *   2. Computes `mem_total_gb = mem_used_gb + mem_avail_gb` when the
 *      hub reports avail instead of total (older shape).
 *   3. Marks server `status: 'online'|'offline'` from last_seen freshness
 *      (within 60s = online). Hub doesn't carry an explicit status
 *      field in 0.8.1-preview.5.
 */

function freshnessStatus(lastSeen: string | null | undefined): 'online' | 'offline' {
  const t = parseHubTime(lastSeen);
  if (Number.isNaN(t)) return 'offline';
  // 90s freshness window — wider than the agent-node 30s report
  // cadence to absorb network latency + clock drift between client
  // and hub. A truly offline agent flips status within ~2 missed
  // reports.
  return Date.now() - t < 90_000 ? 'online' : 'offline';
}

function normalizeServer(row: HubServerRow) {
  const memTotal = row.mem_total_gb ??
    (row.mem_used_gb != null && row.mem_avail_gb != null
      ? row.mem_used_gb + row.mem_avail_gb
      : null);
  return {
    hostname: row.hostname,
    ip: row.ip ?? null,
    agent_count: row.agent_count ?? 0,
    cpu_load_1min: row.cpu_load_1min ?? null,
    cpu_cores: row.cpu_cores ?? 0,
    mem_used_gb: row.mem_used_gb ?? null,
    mem_total_gb: memTotal,
    disk_used_gb: row.disk_used_gb ?? null,
    disk_total_gb: row.disk_total_gb ?? null,
    cpu_history: row.cpu_history,
    mem_history: row.mem_history,
    agents: row.agents,
    status: row.status ?? freshnessStatus(row.last_seen),
    note: row.note,
  };
}

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const res = await fetch(`${HUB_URL}/api/servers`, {
      headers: await hubHeaders(),
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      // 404 means the upstream hub predates v0.8.1-preview.2 — surface a
      // 'feature unavailable' shape so the drawer can render a friendly
      // empty state instead of an angry error.
      if (res.status === 404) return Response.json({ servers: [], unavailable: true });
      return Response.json({ error: `hub ${res.status}` }, { status: res.status });
    }
    const raw = await res.json();
    // Accept both shapes: bare array (0.8.1-preview.5) or {servers: [...]}
    // wrapper (future hub revisions).
    const rows: HubServerRow[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.servers)
        ? raw.servers
        : [];
    return Response.json({
      servers: dedupeByHostname(rows).map(normalizeServer),
      unavailable: raw?.unavailable === true,
    });
  } catch (e: unknown) {
    return Response.json({ error: 'hub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
