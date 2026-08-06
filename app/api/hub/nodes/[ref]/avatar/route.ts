import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

/** Same segment rule as the attrs proxy: hub resolves node_id/name/alias. */
const REF_REGEX = /^[^\x00-\x1f/]{1,120}$/;

/**
 * PUT /api/hub/nodes/:ref/avatar — dashboard-side proxy to hub #462's
 * per-node avatar endpoint (server.ts:2477, validated by
 * avatar-validate.ts). Body: { avatar_url: string | null } — null/empty
 * clears. avatar 接线单 (通信龙 裁定): the hub is the cross-device truth
 * for custom avatars; the settings panel PUTs here FIRST and only echoes
 * to localStorage after success.
 *
 * 🔴 Whitelist: ONLY avatar_url is forwarded — everything else the
 * client sent is dropped at this boundary (same discipline as the attrs
 * proxy right next door).
 */
function userMessage(status: number, body: { error?: string; reason?: string; message?: string }): string {
  switch (body.error) {
    case 'invalid_avatar_url':
      return body.reason ? `头像 URL 不合法：${body.reason}` : '头像 URL 不合法';
    case 'permission_denied':
      return '权限不足 — 你不是该网络的管理员';
    case 'node not found':
      return '节点不存在或已被删除';
    default:
      if (status === 401) return '认证已过期，请重新登录';
      if (status >= 500) return `服务端错误 (${status})，请重试`;
      return body.message || body.error || `HTTP ${status}`;
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { ref } = await params;
  if (!ref || !REF_REGEX.test(ref)) {
    return Response.json({ ok: false, error: 'invalid_ref' }, { status: 400 });
  }
  const userToken = await getV3UserToken();
  if (!userToken) {
    return Response.json({ ok: false, error: 'no_session', message: '无会话 token，请重新登录' }, { status: 401 });
  }
  let clientBody: Record<string, unknown>;
  try {
    clientBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json', message: '请求体不是合法 JSON' }, { status: 400 });
  }
  const forwardBody = { avatar_url: 'avatar_url' in clientBody ? clientBody.avatar_url : null };

  let hubRes: Response;
  try {
    hubRes = await fetch(`${HUB_URL}/api/nodes/${encodeURIComponent(ref)}/avatar`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(forwardBody),
      cache: 'no-store',
    });
  } catch {
    return Response.json({ ok: false, error: 'hub_unreachable', message: '无法连接 CommHub' }, { status: 502 });
  }
  let hubBody: Record<string, unknown> = {};
  try { hubBody = (await hubRes.json()) as Record<string, unknown>; } catch {}
  if (!hubRes.ok || hubBody.ok === false) {
    return Response.json(
      { ok: false, ...hubBody, message: userMessage(hubRes.status, hubBody as { error?: string }) },
      { status: hubRes.ok ? 400 : hubRes.status },
    );
  }
  return Response.json(hubBody);
}
