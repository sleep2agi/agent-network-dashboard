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
    // 404 表示这版 Hub 没有 /api/networks：显式标 unavailable，不要伪装成
    // 「这个用户没有任何网络」——Sidebar 会改用 /api/status 反推网络列表。
    if (res.status === 404) return Response.json({ ok: true, networks: [], unavailable: true });
    return Response.json(
      { ok: false, error: `CommHub /api/networks ${res.status}` },
      { status: res.status },
    );
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
