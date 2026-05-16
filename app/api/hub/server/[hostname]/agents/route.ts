import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Proxy: GET /api/server/:hostname/agents from CommHub.
 *
 * v0.10.0 Hero 2 — per-server agent rollup endpoint exposed by
 * commhub-server ≥ 0.8.1-preview.5 with the process_telemetry field
 * shipped in agent-node ≥ 2.3.11-preview.1 (通信SDK马 T2.1+T2.2+T2.3
 * dispatch chain). Returns per-agent stats:
 *   {
 *     agents: [
 *       {
 *         alias, runtime, status, last_seen_at,
 *         process_rss_bytes, process_cpu_pct,
 *         process_uptime_seconds, process_in_flight_count,
 *         progress,
 *       },
 *       ...
 *     ],
 *   }
 *
 * Forward-compat: when the upstream hub predates the endpoint, 404
 * surfaces as `{ agents: [], unavailable: true }` so the consumer
 * UI renders the "agent rollup pending hub ≥ 0.8.2-preview" hint.
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
      `${HUB_URL}/api/server/${encodeURIComponent(hostname)}/agents`,
      { headers: await hubHeaders(), next: { revalidate: 0 } },
    );
    if (!res.ok) {
      if (res.status === 404) return Response.json({ agents: [], unavailable: true });
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
