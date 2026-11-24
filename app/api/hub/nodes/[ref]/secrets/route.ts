import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';
import { knownSecretError } from '@/app/lib/secret-errors';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';
const REF_REGEX = /^[^\x00-\x1f/]{1,120}$/;


/**
 * POST /api/hub/nodes/:ref/secrets —— 节点密钥「请求入队」（RFC-028）。list 看名称；put 只供聊天密钥卡保存。
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

  // 只认 JSON 对象：坏 JSON / null / 数组一律 400（以前坏 JSON 会被当成 list，null 会在读 action 时抛）。
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const action = body.action ?? 'list';
  // admin 2026-11-24 —— 聊天里的密钥卡要「保存」：放行 put，但只放这一种写，且边界严格校验。
  // 值只进转发给 Hub 的请求体：不写日志、不回显（响应仍是下面的三字段白名单）。
  // 写权限仍由 Hub 判定（owner / admin），delete 依旧不放行。
  let forward: Record<string, unknown> = { action: 'list' };
  if (action === 'put') {
    const key = body.key, value = body.value, revision = body.revision;
    if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,119}$/.test(key)
      || typeof value !== 'string' || !value || value.length > 8192 || value.includes('\0')
      || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      return Response.json({ ok: false, error: 'invalid_secret_input', message: '密钥名或内容不合法' }, { status: 400 });
    }
    forward = { action: 'put', key, value, revision };
  } else if (action !== 'list') {
    return Response.json({ ok: false, error: 'unsupported_action', message: '此代理只支持查看名称（list）和保存（put）' }, { status: 400 });
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
      body: JSON.stringify(forward),
      cache: 'no-store',
    });
  } catch {
    return Response.json({ ok: false, error: 'hub_unreachable', message: '无法连接 CommHub' }, { status: 502 });
  }
  const j = (await hubRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!hubRes.ok || j.ok === false) {
    // 只回已知错误码，不透传上游 error/message 原文：put 时上游异常正文里万一夹带了值，也到不了浏览器（Dash 欧评审 #463）。
    return Response.json({ ok: false, error: knownSecretError(j.error) }, { status: hubRes.status === 200 ? 400 : hubRes.status });
  }
  // 响应白名单：只回这三个字段
  return Response.json({
    ok: true,
    request_id: typeof j.request_id === 'string' ? j.request_id : undefined,
    status: typeof j.status === 'string' ? j.status : undefined,
    expires_at: typeof j.expires_at === 'number' ? j.expires_at : undefined,
  });
}
