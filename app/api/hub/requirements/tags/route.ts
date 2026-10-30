import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Tag catalogue proxy — APP parity (`GET /api/requirements/tags`).
 *
 * Read-only: tags, optional usage counts, colours and the tag tree. Old Hubs
 * answer with `{ok, tags}` only, which the UI degrades to plain text tags.
 * Management (`tags/ops`) is deliberately not proxied yet.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  const networkId = searchParams.get('network_id');
  if (networkId) params.set('network_id', networkId);

  try {
    const res = await fetch(`${HUB_URL}/api/requirements/tags?${params.toString()}`, {
      headers: await hubHeaders(),
      next: { revalidate: 0 },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return Response.json({ ok: false, error: 'hub_not_json', status: res.status }, { status: 502 });
    }
    if (res.status === 404) {
      // Old Hub without the catalogue: an empty, explicitly-unsupported body so
      // the UI falls back to plain text tags without a console 404 on every page.
      return Response.json({ ok: true, tags: [], counts: {}, colors: {}, nodes: [], can_manage: false, unsupported: true });
    }
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
