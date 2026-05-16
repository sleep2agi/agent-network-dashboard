import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Proxy: GET /api/server/:hostname/health from CommHub.
 *
 * v0.10.0 Hero 1 — per-server detailed health endpoint exposed by
 * commhub-server ≥ 0.8.1-preview.5 (通信牛 T2.2 ship, see #140
 * comment 4466558xxx). Returns:
 *   {
 *     hostname, ip,
 *     cpu_load_1min, cpu_cores, mem_used_gb, mem_total_gb,
 *     disk_used_gb, disk_total_gb,
 *     cpu_history: number[], mem_history: number[],
 *     last_seen_at,
 *   }
 *
 * Forward-compat: when the upstream hub predates the endpoint
 * (currently 0.8.0 is what's deployed locally), 404 is surfaced as
 * `{ unavailable: true }` so the ServersDrawer renders a "pending
 * hub upgrade" hint instead of an error.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ hostname: string }> },
) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { hostname } = await params;
  if (!hostname || !/^[A-Za-z0-9._\-]+$/.test(hostname)) {
    return Response.json({ error: 'invalid hostname' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${HUB_URL}/api/server/${encodeURIComponent(hostname)}/health`,
      { headers: await hubHeaders(), next: { revalidate: 0 } },
    );
    if (!res.ok) {
      if (res.status === 404) return Response.json({ unavailable: true });
      return Response.json({ error: `hub ${res.status}` }, { status: res.status });
    }
    return Response.json(await res.json());
  } catch (e: unknown) {
    return Response.json(
      { error: 'hub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
