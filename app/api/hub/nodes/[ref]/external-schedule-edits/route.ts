import { getV3UserToken, requireDashboardAuth } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';
const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SCHEDULE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BODY_KEYS = new Set(['schedule_id', 'base_revision', 'patch']);
const PATCH_KEYS = new Set(['cron', 'enabled']);

export async function POST(req: Request, context: { params: Promise<{ ref: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  const token = await getV3UserToken();
  // The Hub owner gate requires a user identity. Network/admin tokens are
  // never upgraded or treated as an owner by the Dashboard proxy.
  if (!token?.startsWith('utok_')) return Response.json({ ok: false, error: 'user_token_required' }, { status: 403 });
  const { ref: nodeId } = await context.params;
  if (!NODE_ID.test(nodeId)) return Response.json({ ok: false, error: 'invalid_node_id' }, { status: 400 });
  let raw: string;
  try { raw = await req.text(); } catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  if (raw.length > 4096) return Response.json({ ok: false, error: 'body_too_large' }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    body = value as Record<string, unknown>;
  } catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  if (Object.keys(body).some((key) => !BODY_KEYS.has(key))) {
    return Response.json({ ok: false, error: 'invalid_edit_request' }, { status: 400 });
  }
  const patch = body.patch;
  if (!SCHEDULE_ID.test(String(body.schedule_id || '')) || !Number.isSafeInteger(body.base_revision) || Number(body.base_revision) < 0
    || !patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !PATCH_KEYS.has(key))) {
    return Response.json({ ok: false, error: 'invalid_edit_request' }, { status: 400 });
  }
  const fields = patch as Record<string, unknown>;
  if ((fields.cron !== undefined && (typeof fields.cron !== 'string' || fields.cron.length > 120 || /[\r\n\0]/.test(fields.cron)))
    || (fields.enabled !== undefined && typeof fields.enabled !== 'boolean')) {
    return Response.json({ ok: false, error: 'invalid_edit_request' }, { status: 400 });
  }
  try {
    const upstream = await fetch(`${HUB_URL}/api/nodes/${encodeURIComponent(nodeId)}/external-schedule-edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8' },
    });
  } catch {
    return Response.json({ ok: false, error: 'hub_unreachable' }, { status: 502 });
  }
}
