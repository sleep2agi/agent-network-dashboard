import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

/** Read the same user-visible project catalog as the requirement list. */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  // A user token can see several networks. Scope selection is separate from
  // authentication; Hub still checks this user's access to the named network.
  const networkId = new URL(req.url).searchParams.get('network_id');
  const params = new URLSearchParams();
  if (networkId) params.set('network_id', networkId);

  try {
    const token = await getV3UserToken();
    const res = await fetch(`${HUB_URL}/api/requirements/projects?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!(res.headers.get('content-type') || '').includes('application/json')) {
      // Older Hubs can return an HTML 404. Preserve the meaningful status.
      return Response.json({ ok: false, error: 'hub_not_json' }, { status: res.ok ? 502 : res.status });
    }
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ ok: false, error: 'CommHub unreachable' }, { status: 502 });
  }
}
