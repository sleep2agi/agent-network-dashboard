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
function networkParam(url: string): string {
  const networkId = new URL(url).searchParams.get('network_id');
  return networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { id } = await ctx.params;
  if (!id || !/^req_[A-Za-z0-9_-]+$/.test(id)) {
    return Response.json({ ok: false, error: 'invalid_requirement_id' }, { status: 400 });
  }

  try {
    const res = await fetch(`${HUB_URL}/api/requirements/${encodeURIComponent(id)}${networkParam(req.url)}`, {
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

/**
 * Writes — #1634. Hub owns every rule (owner must be human, node tokens may
 * not delete, checklist ids are server-side); this proxy only forwards the
 * whitelisted fields and passes Hub's error code through untouched so the UI
 * can say *why* instead of failing silently.
 */
const WRITABLE = ['column', 'priority', 'due', 'start', 'tags', 'name'] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { id } = await ctx.params;
  if (!id || !/^req_[A-Za-z0-9_-]+$/.test(id)) {
    return Response.json({ ok: false, error: 'invalid_requirement_id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  for (const key of WRITABLE) {
    if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: false, error: 'empty_patch' }, { status: 400 });
  }

  try {
    const res = await fetch(`${HUB_URL}/api/requirements/${encodeURIComponent(id)}${networkParam(req.url)}`, {
      method: 'PATCH',
      headers: { ...(await hubHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      next: { revalidate: 0 },
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
