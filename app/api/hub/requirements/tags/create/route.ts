import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Create one tag — APP parity (`POST /api/requirements/tags/create`).
 *
 * `parent_id` is explicit: null (or absent) means a root tag, a string must be
 * an existing tag in the same network. The Hub enforces uniqueness (409),
 * parent existence (404) and the 4-level limit (400).
 */
export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 20) {
    return Response.json({ ok: false, error: 'invalid_tag' }, { status: 400 });
  }
  const parent = body.parent_id;
  if (parent !== null && parent !== undefined && (typeof parent !== 'string' || !parent.trim())) {
    return Response.json({ ok: false, error: 'invalid_tag_parent_id' }, { status: 400 });
  }
  const payload: Record<string, unknown> = { name, parent_id: typeof parent === 'string' ? parent.trim() : null };

  const networkId = new URL(req.url).searchParams.get('network_id');
  const params = new URLSearchParams();
  if (networkId) params.set('network_id', networkId);

  try {
    const res = await fetch(`${HUB_URL}/api/requirements/tags/create?${params.toString()}`, {
      method: 'POST',
      headers: { ...(await hubHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
