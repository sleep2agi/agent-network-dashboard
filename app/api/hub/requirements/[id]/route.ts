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
/** `owner` must be a human and `agent_owner` a node; Hub enforces this too. */
// issues：Hub 只接受 GitHub issue URL、上限 8 条；这里只放行字段，校验仍在 Hub（客户端另有一份同规则的前置校验）。
const WRITABLE = ['column', 'priority', 'due', 'start', 'tags', 'name', 'description', 'owner', 'agent_owner', 'participants', 'checklist', 'parent_id', 'issues'] as const;

function validPerson(value: unknown, kind: 'user' | 'node'): boolean {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.kind === kind && typeof row.id === 'string' && row.id.length > 0;
}

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
  if ('owner' in patch && !validPerson(patch.owner, 'user')) {
    return Response.json({ ok: false, error: 'owner_must_be_human' }, { status: 400 });
  }
  if ('agent_owner' in patch && !validPerson(patch.agent_owner, 'node')) {
    return Response.json({ ok: false, error: 'agent_owner_must_be_node' }, { status: 400 });
  }
  if ('description' in patch && (typeof patch.description !== 'string' || patch.description.length > 20_000)) {
    return Response.json({ ok: false, error: 'invalid_description', field: 'description' }, { status: 400 });
  }
  if ('tags' in patch) {
    const tags = patch.tags;
    const valid = Array.isArray(tags) && tags.length <= 10 && tags.every(tag => typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 20);
    if (!valid) return Response.json({ ok: false, error: 'invalid_tags', field: 'tags' }, { status: 400 });
  }
  if ('parent_id' in patch) {
    const parent = patch.parent_id;
    if (parent !== null && (typeof parent !== 'string' || !/^req_[A-Za-z0-9_-]+$/.test(parent))) {
      return Response.json({ ok: false, error: 'invalid_parent_id', field: 'parent_id' }, { status: 400 });
    }
  }
  if ('checklist' in patch) {
    const list = patch.checklist;
    const valid = Array.isArray(list) && list.length <= 100 && list.every(item => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Record<string, unknown>;
      return typeof row.id === 'string' && row.id.length > 0
        && typeof row.text === 'string' && row.text.trim().length > 0 && row.text.length <= 500
        && (row.done === undefined || typeof row.done === 'boolean');
    });
    if (!valid) return Response.json({ ok: false, error: 'invalid_checklist', field: 'checklist' }, { status: 400 });
  }
  if ('participants' in patch) {
    const list = patch.participants;
    const valid = Array.isArray(list) && list.length <= 100 && list.every(person => {
      if (!person || typeof person !== 'object') return false;
      const row = person as Record<string, unknown>;
      return (row.kind === 'user' || row.kind === 'node') && typeof row.id === 'string' && row.id.length > 0;
    });
    if (!valid) return Response.json({ ok: false, error: 'invalid_participants' }, { status: 400 });
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
