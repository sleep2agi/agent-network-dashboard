import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';
const REF_REGEX = /^[^\x00-\x1f/]{1,120}$/;
const REQ_REGEX = /^[A-Za-z0-9_.:-]{1,120}$/;

/**
 * GET /api/hub/nodes/:ref/secrets/:requestId —— 取「密钥名称列表」的结果。
 *
 * 响应白名单（关键）：只回 { ok, status, error, keys:[{key,source}], revision }。
 * Hub 的 snapshot 里若将来多出任何字段（包括可能的 values），都不会流到浏览器。
 */
export async function GET(req: Request, { params }: { params: Promise<{ ref: string; requestId: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { ref, requestId } = await params;
  if (!ref || !REF_REGEX.test(ref)) return Response.json({ ok: false, error: 'invalid_ref' }, { status: 400 });
  if (!requestId || !REQ_REGEX.test(requestId)) return Response.json({ ok: false, error: 'invalid_request_id' }, { status: 400 });

  const userToken = await getV3UserToken();
  if (!userToken) return Response.json({ ok: false, error: 'no_session' }, { status: 401 });

  let hubRes: Response;
  try {
    hubRes = await fetch(`${HUB_URL}/api/nodes/${encodeURIComponent(ref)}/secrets/${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Bearer ${userToken}` },
      cache: 'no-store',
    });
  } catch {
    return Response.json({ ok: false, error: 'hub_unreachable' }, { status: 502 });
  }
  const j = (await hubRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!hubRes.ok || j.ok === false) {
    return Response.json({ ok: false, error: typeof j.error === 'string' ? j.error : 'hub_error' }, { status: hubRes.status === 200 ? 400 : hubRes.status });
  }

  const snap = (j.snapshot ?? {}) as { revision?: unknown; keys?: unknown };
  const keys = Array.isArray(snap.keys)
    ? snap.keys
        .map((k) => (typeof k === 'string' ? { key: k, source: 'node' } : k && typeof (k as { key?: unknown }).key === 'string' ? { key: (k as { key: string }).key, source: typeof (k as { source?: unknown }).source === 'string' ? (k as { source: string }).source : 'node' } : null))
        .filter((k): k is { key: string; source: string } => !!k)
    : [];
  return Response.json({
    ok: true,
    status: typeof j.status === 'string' ? j.status : undefined,
    error: typeof j.error === 'string' ? j.error : undefined,
    revision: typeof snap.revision === 'number' ? snap.revision : undefined,
    keys,
  });
}
