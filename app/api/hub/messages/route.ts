import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const limit = searchParams.get('limit') || '50';
  const networkId = searchParams.get('network_id') || '';
  // Show last 7 days by default (server defaults to 1 hour which is too short)
  const since = searchParams.get('since') || new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const qs = new URLSearchParams({ limit, since });
  if (networkId) qs.set('network_id', networkId);
  try {
    const res = await hubFetch(`/api/messages?${qs.toString()}`);
    // 上游失败不能包装成 200 {ok:false, messages:[]}：那会让页面把
    // 「Hub 读不到」显示成「没有消息」。状态码原样透传（5xx→502）。
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `CommHub /api/messages ${res.status}` },
        { status: res.status === 404 ? 502 : res.status },
      );
    }
    const data = await res.json();
    // #1636-P1 —— 显式指定了 network_id 时，「空」就是答案。
    // 旧实现在这里撤掉 network_id 再查一次，把别的网络的命中以 `source: 'global'`
    // 返回给调用方；如果那次兜底是 401，还会被吞成「200 + 原空集合」。
    // 作用域不能因为「结果为空」被放宽 —— 要跨网络看，由调用方显式切换。
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ ok: false, messages: [] }, { status: 502 });
  }
}
