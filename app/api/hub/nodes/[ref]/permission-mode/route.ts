import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

/**
 * PUT /api/hub/nodes/:ref/permission-mode —— 代理 Hub 的 RFC-041 权限模式端点
 * （/home/vansin/.commhub/src-94cef5d9/server/src/server.ts:4082，允许值见
 *  server/src/node-permissions.ts:22 NODE_PERMISSION_MODES）。
 *
 * 为什么要在这一层再校验一次：Hub 的取值是 normal|readonly|restricted，
 * 前端下拉是展示层，任何直接打接口的调用都应该被同一个白名单挡住。
 *
 * 授权：用户令牌 + 节点主人 / 网络 owner·admin / Hub 管理员（Hub 侧判定）。
 * 我们只透传用户令牌，不在这里降级成节点令牌、也不缓存结果。
 */
const REF_REGEX = /^[^\x00-\x1f/]{1,120}$/;
const MODES = ['normal', 'readonly', 'restricted'] as const;

function userMessage(status: number, body: { error?: string; message?: string }): string {
  switch (body.error) {
    case 'invalid_permission_mode':
      return '权限模式取值不合法（只支持 正常 / 只读 / 受限）';
    case 'permission_denied':
      return '权限不足 — 只有节点主人、网络管理员或 Hub 管理员可以修改';
    case 'node not found':
      return '节点不存在或已被删除';
    default:
      if (status === 401) return '认证已过期，请重新登录';
      if (status >= 500) return `服务端错误 (${status})，请重试`;
      return body.message || body.error || `HTTP ${status}`;
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { ref } = await params;
  if (!ref || !REF_REGEX.test(ref)) {
    return Response.json({ ok: false, error: 'invalid_ref' }, { status: 400 });
  }
  let clientBody: Record<string, unknown>;
  try {
    clientBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json', message: '请求体不是合法 JSON' }, { status: 400 });
  }
  const mode = clientBody.mode;
  if (typeof mode !== 'string' || !(MODES as readonly string[]).includes(mode)) {
    return Response.json({ ok: false, error: 'invalid_mode', allowed: MODES }, { status: 400 });
  }
  const userToken = await getV3UserToken();
  if (!userToken) {
    return Response.json({ ok: false, error: 'no_session', message: '无会话 token，请重新登录' }, { status: 401 });
  }

  let hubRes: Response;
  try {
    hubRes = await fetch(`${HUB_URL}/api/nodes/${encodeURIComponent(ref)}/permission-mode`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }), // 白名单：只转发 mode
      cache: 'no-store',
    });
  } catch {
    return Response.json({ ok: false, error: 'hub_unreachable', message: '无法连接 CommHub' }, { status: 502 });
  }
  let hubBody: Record<string, unknown> = {};
  try { hubBody = (await hubRes.json()) as Record<string, unknown>; } catch { /* 非 JSON 就当失败处理 */ }
  if (!hubRes.ok || hubBody.ok === false) {
    return Response.json(
      { ok: false, ...hubBody, message: userMessage(hubRes.status, hubBody as { error?: string; message?: string }) },
      { status: hubRes.ok ? 400 : hubRes.status },
    );
  }
  return Response.json(hubBody);
}
