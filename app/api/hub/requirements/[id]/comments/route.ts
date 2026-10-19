import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Comments — #1634. Hub's path is the plural `/comments` (a singular
 * `/comment` route 404s); it requires non-empty `text` and appends to the
 * timeline without touching the description.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { id } = await ctx.params;
  if (!/^req_[A-Za-z0-9_-]+$/.test(id || '')) {
    return Response.json({ ok: false, error: 'invalid_requirement_id' }, { status: 400 });
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return Response.json({ ok: false, error: 'invalid_comment', field: 'text' }, { status: 400 });
  if (text.length > 4000) return Response.json({ ok: false, error: 'comment_too_long' }, { status: 400 });

  try {
    const res = await fetch(`${HUB_URL}/api/requirements/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      headers: { ...(await hubHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
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
