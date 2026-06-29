import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

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

interface HubResponse {
  ok?: boolean;
  error?: string;
  count?: number;
  daemons?: DaemonRow[];
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id');
  const path = networkId
    ? `/api/host-supervisors?network_id=${encodeURIComponent(networkId)}`
    : '/api/host-supervisors';

  try {
    const res = await hubFetch(path);
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
    return Response.json({ ok: true, count, daemons, selected });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), count: 0, daemons: [] },
      { status: 502 },
    );
  }
}
