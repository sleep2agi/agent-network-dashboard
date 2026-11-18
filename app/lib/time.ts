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

/** Parse a hub timestamp to ms-since-epoch, treating zone-less strings as UTC.
 *
 *  🔴 只补 `Z` 给「带空格」的 SQL 格式是不够的：CommHub 的 /api/tasks 实测回的是
 *  `2026-11-16T19:18:08`（**带 T、无时区**）。旧实现遇到带 T 的直接原样解析，
 *  浏览器按本地时区解释 ⇒ 本机 UTC+8 下整段时间偏移 8 小时：
 *  实测同一份 200 条失败任务，按 UTC = 200 条在 24h 内，按本地 = 162 条。
 *  现在两种无时区写法（空格分隔 / 带 T）都补 `Z`；已有 Z 或 ±HH:MM 的原样保留。
 *  Returns null for empty / unparseable input. */
export function parseHubTime(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const iso = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
  const withTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const t = Date.parse(withTz);
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
  // `.577`：文案门此前抓不到相对时间——它只在"慢"或滚动到某处时才出现，
  // 而截图里 /messages 的消息头就是 "2s ago / 1m ago"。中文界面里这属于漏网英文。
  if (s < 0) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
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

/** 把 Hub 时间戳格式化成"本地时间"字符串（`.616`）。
 *
 *  为什么需要：信息卡此前直接把 `2026-11-18 12:30:26`（UTC）渲染出来，
 *  本机 UTC+8 下用户看到的时间比真实时间早 8 小时，会把"34 秒前的心跳"读成"8 小时前"。
 *  解析用 parseHubTime（无时区按 UTC），格式化用本地时区 —— 两者缺一不可。
 *  返回空串表示"没有值"，调用方据此显示占位符，不要显示 1970。
 */
export function formatHubTime(dateStr: string | null | undefined): string {
  const ms = parseHubTime(dateStr);
  if (ms === null) return '';
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
