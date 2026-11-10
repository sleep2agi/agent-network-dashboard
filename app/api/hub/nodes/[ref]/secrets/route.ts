import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';
const REF_REGEX = /^[^\x00-\x1f/]{1,120}$/;

/**
 * POST /api/hub/nodes/:ref/secrets —— 节点密钥「请求入队」（RFC-028）。
 *
 * 为什么只放行 action:"list"：
 *   同一个端点的 put / delete 会**写入节点密钥**，那是另一件风险完全不同的事。
 *   这里的代理只服务「查看名称列表」，任何写操作一律在边界 400，不转发给 Hub。
 *   列表返回只有 key 名（Hub 侧 project() 不返回 values），UI 也永远不渲染值。
 *
 * 授权：用户令牌 + 节点主人 / 网络 owner·admin（Hub 侧判定）。
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { ref } = await params;
  if (!ref || !REF_REGEX.test(ref)) return Response.json({ ok: false, error: 'invalid_ref' }, { status: 400 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }
  const action = body.action ?? 'list';
  if (action !== 'list') {
    return Response.json({ ok: false, error: 'unsupported_action', message: '此代理只支持查看密钥名称（action=list）' }, { status: 400 });
  }

  const userToken = await getV3UserToken();
  if (!userToken) return Response.json({ ok: false, error: 'no_session', message: '无会话 token，请重新登录' }, { status: 401 });

  const url = new URL(req.url);
  const networkId = url.searchParams.get('network_id');
  const qs = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';

  let hubRes: Response;
  try {
    hubRes = await fetch(`${HUB_URL}/api/nodes/${encodeURIComponent(ref)}/secrets${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
      cache: 'no-store',
    });
  } catch {
    return Response.json({ ok: false, error: 'hub_unreachable', message: '无法连接 CommHub' }, { status: 502 });
  }
  const j = (await hubRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!hubRes.ok || j.ok === false) {
    return Response.json(
      { ok: false, error: typeof j.error === 'string' ? j.error : 'hub_error', message: typeof j.message === 'string' ? j.message : undefined },
      { status: hubRes.status === 200 ? 400 : hubRes.status },
    );
  }
  // 响应白名单：只回这三个字段
  return Response.json({
    ok: true,
    request_id: typeof j.request_id === 'string' ? j.request_id : undefined,
    status: typeof j.status === 'string' ? j.status : undefined,
    expires_at: typeof j.expires_at === 'number' ? j.expires_at : undefined,
  });
}
