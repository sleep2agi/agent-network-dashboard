import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

const OPS = new Set(['rename', 'merge', 'delete', 'color', 'reparent']);

/**
 * Tag management proxy — APP parity (`POST /api/requirements/tags/ops`).
 *
 * The Hub owns authorisation (owner / admin / task_access=all) and all name,
 * colour and merge rules. This route only whitelists the operation shape and
 * forwards the selected network, so a browser cannot smuggle extra fields.
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
  const op = typeof body.op === 'string' ? body.op : '';
  if (!OPS.has(op)) {
    return Response.json({ ok: false, error: 'invalid_tag_op' }, { status: 400 });
  }

  const payload: Record<string, unknown> = { op };
  if (op === 'rename') {
    payload.from = body.from;
    payload.to = body.to;
  } else if (op === 'merge') {
    payload.from = body.from;
    payload.to = body.to;
  } else if (op === 'delete') {
    payload.tag = body.tag;
  } else if (op === 'color') {
    payload.tag = body.tag;
    payload.color = body.color ?? null;
  } else {
    // reparent: `parent` must be explicit — null is a root move, absent is invalid.
    payload.tag = body.tag;
    payload.parent = body.parent ?? null;
  }

  const networkId = new URL(req.url).searchParams.get('network_id');
  const params = new URLSearchParams();
  if (networkId) params.set('network_id', networkId);

  try {
    const res = await fetch(`${HUB_URL}/api/requirements/tags/ops?${params.toString()}`, {
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
