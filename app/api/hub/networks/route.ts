import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || '';

  try {
    const path = networkId ? `/api/networks/${networkId}` : '/api/networks';
    const res = await hubFetch(path);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return Response.json(await res.json());
    return Response.json({ ok: true, networks: [] });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
