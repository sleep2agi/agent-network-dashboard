/** Shared timestamp helpers for hub-sourced data.
 *
 *  Background — the CommHub serialises timestamps SQL-style without a
 *  zone ("2026-05-15 06:00:28"), but some test data uses full ISO
 *  ("…T06:00:28Z"). `Date.parse` on bare SQL is **local-time** in every
 *  browser the dashboard supports, so a UTC+8 operator silently sees
 *  every timestamp 8 h older than reality (Round 35 dug this out via
 *  the `isGhost` filter mis-fire).
 *
 *  Round 38 / Loop consolidates parsing — TopoGraph (R35), ChatPopover
 *  (R37) and utils.ts::timeAgo all mirrored the same SQL→UTC rewrite;
 *  one source of truth here. */

/** Parse a hub timestamp to ms-since-epoch, treating SQL-style strings
 *  as UTC. ISO strings (with `T`) bypass the rewrite and are parsed as-is.
 *  Returns null for empty / unparseable input. */
export function parseHubTime(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** 一个节点静默多久算「陈旧」。
 *
 *  这个阈值原本只活在 TopoGraph 里(Round 27 / P0 把它从 24h 收到 1h:
 *  健康 agent 每几秒心跳一次,静默一小时基本等于没了)。但同一份节点数据
 *  有多个入口,而只有拓扑图知道这个阈值 —— 定时任务的节点选择器完全不知道,
 *  于是下拉框里几个月前的死节点和刚心跳过的节点长得一模一样。
 *
 *  实测(2026-08-13 生产):171 个节点里 110 个 `updated_at` 超过一小时,
 *  最久的停在三个月前,而 **171/171 的 `lifecycle_state` 都是 "active"** ——
 *  除了时间戳,没有任何字段能分辨(hub 侧见 #751)。
 *
 *  提到这里是为了让两个入口不会各飘各的。注意**只有阈值可共享**:
 *  TopoGraph 的 `isGhost` 还要求 `status === 'offline'` 且无 SSE 连接,
 *  那些字段 `/api/nodes` 不返回,不能照搬。 */
export const NODE_STALE_MS = 60 * 60 * 1000;

/** 按 `NODE_STALE_MS` 判断一个 hub 时间戳是否已陈旧。
 *  时间戳缺失/不可解析时返回 false —— 保守:宁可不标记,也不误标一个新节点。 */
export function isHubTimeStale(dateStr: string | null | undefined): boolean {
  const t = parseHubTime(dateStr);
  return t !== null && Date.now() - t > NODE_STALE_MS;
}

/** Format `dateStr` as a short relative-time string ("6m ago" / "2h ago").
 *  Future timestamps (clock skew) collapse to "just now". Returns null when
 *  the input doesn't parse — callers can decide on a fallback. */
export function relativeAgo(dateStr: string | null | undefined): string | null {
  const t = parseHubTime(dateStr);
  if (t === null) return null;
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Loop R7 (跨面一致性): WeChat-style contextual timestamp shared by the
 *  chat panel (R3) and /messages dividers. zh locales keep the native
 *  wording (昨天/星期X); others get Intl output ("Yesterday"/"Tue").
 *  Today → "14:32" · yesterday → "昨天 14:32" · <7d → "星期二 14:32" ·
 *  this year → "7月16日 14:32" · older adds the year. */
export function formatWeChatTime(value: string | null | undefined): string {
  const t = parseHubTime(value);
  if (t === null) return '';
  const d = new Date(t);
  const now = new Date();
  const zh = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh');
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (dayDiff === 0) return hm;
  if (dayDiff === 1) return zh ? `昨天 ${hm}` : `Yesterday ${hm}`;
  if (dayDiff > 1 && dayDiff < 7) {
    const wd = new Intl.DateTimeFormat(zh ? 'zh-CN' : undefined, { weekday: zh ? 'long' : 'short' }).format(d);
    return `${wd} ${hm}`;
  }
  const md = new Intl.DateTimeFormat(zh ? 'zh-CN' : undefined, {
    month: zh ? 'long' : 'short', day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }).format(d);
  return `${md} ${hm}`;
}
