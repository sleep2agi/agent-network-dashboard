import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Proxy: GET /api/server-logs from CommHub. Newest-first ring buffer of
 * the hub's stdout/stderr lines. Admin-only on the hub side.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const limit = searchParams.get('limit') || '200';
  const since = searchParams.get('since') || '';

  try {
    const params = new URLSearchParams({ limit });
    if (since) params.set('since', since);
    const res = await fetch(
      `${HUB_URL}/api/server-logs?${params.toString()}`,
      { headers: await hubHeaders(), next: { revalidate: 0 } },
    );
    if (!res.ok) {
      return Response.json({ error: `hub ${res.status}` }, { status: res.status });
    }
    return Response.json(await res.json());
  } catch (e: unknown) {
    return Response.json({ error: 'hub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
