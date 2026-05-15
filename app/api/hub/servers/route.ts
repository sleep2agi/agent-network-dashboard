import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

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
 */
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
    return Response.json(await res.json());
  } catch (e: unknown) {
    return Response.json({ error: 'hub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
