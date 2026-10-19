import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * One requirement — #1633. Hub only resolves `req_…` ids on this path;
 * a short number (#N) 404s, so the page always links by id.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { id } = await ctx.params;
  if (!id || !/^req_[A-Za-z0-9_-]+$/.test(id)) {
    return Response.json({ ok: false, error: 'invalid_requirement_id' }, { status: 400 });
  }

  try {
    const res = await fetch(`${HUB_URL}/api/requirements/${encodeURIComponent(id)}`, {
      headers: await hubHeaders(),
      next: { revalidate: 0 },
    });
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
