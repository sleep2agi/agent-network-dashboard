import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Requirement activity timeline (动态) — #1633.
 *
 * Hub's shape here is NOT /api/requirements/<id>/events (that 404s).
 * The working endpoint is a query param on the collection route.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const requirementId = searchParams.get('requirement_id') || '';
  if (!/^req_[A-Za-z0-9_-]+$/.test(requirementId)) {
    return Response.json({ ok: false, error: 'invalid_requirement_id' }, { status: 400 });
  }
  const limit = searchParams.get('limit') || '100';

  try {
    const res = await fetch(
      `${HUB_URL}/api/requirements/events?requirement_id=${encodeURIComponent(requirementId)}&limit=${encodeURIComponent(limit)}`,
      { headers: await hubHeaders(), next: { revalidate: 0 } },
    );
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return Response.json({ ok: false, error: 'hub_not_json', status: res.status }, { status: 502 });
    }
    return Response.json(await res.json(), { status: res.status });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
