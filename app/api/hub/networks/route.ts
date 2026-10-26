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
    // #1636 —— 401 原样上抛，不要变成 {ok:true, networks: []}
    if (res.status === 401) return Response.json({ error: 'login required' }, { status: 401 });
    if (res.ok && ct.includes('application/json')) return Response.json(await res.json());
    return Response.json({ ok: true, networks: [] });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
