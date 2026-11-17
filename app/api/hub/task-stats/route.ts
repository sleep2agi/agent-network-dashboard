import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { parseHubTime } from '@/app/lib/time';

/**
 * 任务状态计数（只回数字，不回任务本体）。
 *
 * 为什么需要：首页只要「每个状态有多少任务」，而 /api/stats 在部分环境不返回
 * tasks.by_status，于是首页退回拉 /api/hub/tasks?limit=500 —— 生产实测
 * **665,867 B**（公网 240 KB/s 约 2.8 秒），只为数出 5 个数字。
 *
 * 做法：服务端取任务列表并就地统计，浏览器只收几百字节。
 * 注意：只做计数，不缓存、不改判定口径（状态字符串原样作为 key）。
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || '';
  const status = searchParams.get('status') || '';
  const sinceHours = Number(searchParams.get('sinceHours') || '0');
  const includeFilter = networkId && networkId !== 'all';
  const statusQs = status ? `&status=${encodeURIComponent(status)}` : '';
  const qs = `?limit=500${includeFilter ? `&network_id=${encodeURIComponent(networkId)}` : ''}${statusQs}`;

  try {
    const res = await hubFetch(`/api/tasks${qs}`);
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `CommHub /api/tasks ${res.status}` },
        { status: res.status === 404 ? 502 : res.status },
      );
    }
    const data = await res.json();
    const tasks = Array.isArray(data.tasks) ? data.tasks : Array.isArray(data) ? data : [];
    const byStatus: Record<string, number> = {};
    const since = sinceHours > 0 ? Date.now() - sinceHours * 3600_000 : 0;
    let recent = 0;
    let oldest = Number.POSITIVE_INFINITY;
    for (const t of tasks) {
      const st = typeof t?.status === 'string' && t.status ? t.status : 'unknown';
      byStatus[st] = (byStatus[st] || 0) + 1;
      const when = t?.completed_at || t?.created_at;
      // 🔴 必须走 parseHubTime：CommHub 的时间戳常是「2026-11-16T19:18:08」这种**无时区**串，
      // 裸 Date.parse 会按本地时区解释（本机 UTC+8），窗口整体偏移 8 小时。
      // 实测同一份 200 条失败任务：按 UTC 解释 200 条在 24h 内，按本地解释只有 162 条 ——
      // 横幅此前报的正是 162，等于把这 8 小时里的失败系统性漏掉。
      const parsed = when ? parseHubTime(String(when)) : null;
      const ts = parsed === null ? NaN : parsed;
      if (!Number.isFinite(ts)) continue;
      if (ts < oldest) oldest = ts;
      if (since > 0 && ts >= since) recent += 1;
    }
    // 🔴 「近 24 小时 N 个失败」曾按**截断后的列表**直接当总数报。
    // CommHub /api/tasks 实测单次最多回 200 条（limit=500 也只回 200，且 offset/page 被忽略），
    // 所以只要 24h 内失败超过 200，计到的就只是下界，页面却写成了确定值。
    // 判据只用数据本身：列表已顶到页上限 **且** 最老一条仍晚于窗口起点 ⇒ 窗口没走完 ⇒ 只能给下界。
    // 反之（最老一条早于窗口起点）说明窗口内的失败已全部在列表里，计数是精确的。
    const HUB_PAGE_CAP = 200;
    const truncated = since > 0 && tasks.length >= HUB_PAGE_CAP && Number.isFinite(oldest) && oldest >= since;
    return Response.json(
      {
        ok: true,
        total: tasks.length,
        byStatus,
        recent,
        truncated,
        coveredFrom: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'hub request failed' },
      { status: 502 },
    );
  }
}
