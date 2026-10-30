import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Checklist toggle — #1634. Only that one item is written (Hub patches a
 * single entry), so two people editing different items do not clobber
 * each other.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { id, itemId } = await ctx.params;
  if (!/^req_[A-Za-z0-9_-]+$/.test(id || '') || !/^[A-Za-z0-9_-]{1,40}$/.test(itemId || '')) {
    return Response.json({ ok: false, error: 'invalid_checklist_target' }, { status: 400 });
  }

  let body: { done?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.done !== 'boolean') {
    return Response.json({ ok: false, error: 'done_must_be_boolean' }, { status: 400 });
  }

  try {
    const networkId = new URL(req.url).searchParams.get('network_id');
    const scope = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';
    const res = await fetch(
      `${HUB_URL}/api/requirements/${encodeURIComponent(id)}/checklist/${encodeURIComponent(itemId)}${scope}`,
      {
        method: 'PATCH',
        headers: { ...(await hubHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: body.done }),
        next: { revalidate: 0 },
      },
    );
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
