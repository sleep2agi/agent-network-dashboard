import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Requirements (需求) list proxy — #1633.
 *
 * The dashboard has always been about dispatch tasks (/api/tasks); the
 * requirement board people actually work from had no route here at all.
 * Hub side is a plain REST read, so this stays a thin proxy: filters in,
 * `{ok, requirements[], has_more, next_cursor}` out, no reshaping.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  for (const key of ['network_id', 'status', 'tag', 'project_id', 'owner', 'agent_owner', 'q', 'include_archived', 'overdue', 'limit', 'cursor', 'view', 'parent_id']) {
    const value = searchParams.get(key);
    if (value) params.set(key, value);
  }
  if (!params.has('limit')) params.set('limit', '100');
  if (!params.has('view')) params.set('view', 'summary');

  try {
    const res = await fetch(`${HUB_URL}/api/requirements?${params.toString()}`, {
      headers: await hubHeaders(),
      next: { revalidate: 0 },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return Response.json(
        { ok: false, error: 'hub_not_json', status: res.status },
        { status: 502 },
      );
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


const CREATE_FIELDS = ['name', 'priority', 'column', 'project_id', 'tags', 'description'] as const;

/**
 * Create one requirement — APP parity. Hub owns validation (name length,
 * priority/column enums, project membership); this proxy only forwards the
 * whitelisted fields, the selected network and the signed-in identity.
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
  if (!name || name.length > 80) {
    return Response.json({ ok: false, error: 'invalid_name', field: 'name' }, { status: 400 });
  }
  const payload: Record<string, unknown> = { name };
  for (const key of CREATE_FIELDS) {
    if (key !== 'name' && Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key];
  }
  if ('priority' in payload && !['high', 'normal', 'low', 'lowest'].includes(String(payload.priority))) {
    return Response.json({ ok: false, error: 'invalid_priority', field: 'priority' }, { status: 400 });
  }
  if ('column' in payload && !['pool', 'doing', 'done', 'abandoned'].includes(String(payload.column))) {
    return Response.json({ ok: false, error: 'invalid_column', field: 'column' }, { status: 400 });
  }
  if ('tags' in payload && (!Array.isArray(payload.tags) || payload.tags.some(tag => typeof tag !== 'string' || !tag.trim()))) {
    return Response.json({ ok: false, error: 'invalid_tags', field: 'tags' }, { status: 400 });
  }

  const networkId = new URL(req.url).searchParams.get('network_id');
  const params = new URLSearchParams();
  if (networkId) params.set('network_id', networkId);

  try {
    const res = await fetch(`${HUB_URL}/api/requirements?${params.toString()}`, {
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
