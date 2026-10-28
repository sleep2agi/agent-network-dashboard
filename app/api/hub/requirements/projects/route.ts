import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

/** Read the same user-visible project catalog as the requirement list. */
export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const token = await getV3UserToken();
    const res = await fetch(`${HUB_URL}/api/requirements/projects`, {
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
