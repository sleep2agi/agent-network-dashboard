import { createHash } from 'node:crypto';

/**
 * BFF 侧的短 TTL 响应缓存（`.650`）。
 *
 * 背景（实测，2026-11-21，load1≈15）：
 *   军团首帧 = max(people, departments) + 2ms（客户端段只有 2ms）
 *   `people` / `departments` 在 Hub 侧 1.5–3s（负载低时约 0.7s）
 *   2D / 3D / org 三个页面都要这两份数据，来回切换会重复付这笔钱
 *
 * 所以在这里做两件事：
 *   1. 短 TTL（默认 10s）缓存：同一用户、同一网络、同一组参数在窗口内只打一次 Hub
 *   2. 单飞（single-flight）：并发的相同请求共享同一次在途调用，不叠加
 *
 * 安全边界：
 *   - key 里必须包含**用户 token 的哈希**——不同用户看到的人员目录可能不同（权限过滤），
 *     只按 network_id 做 key 会把 A 的可见范围发给 B。
 *   - 只缓存 GET 成功响应（2xx）；失败不缓存，避免把一次 502 冻结 10 秒。
 *   - TTL 故意很短：军团页本来就 30s 轮询，10s 内的陈旧在这里是可接受的。
 */
export type CachedJson = {
  status: number;
  json: unknown;
  /** true = 这次命中缓存（不产生 Hub 调用） */
  hit: boolean;
};

type Entry = { at: number; status: number; json: unknown };
const STORE = new Map<string, Entry>();
const INFLIGHT = new Map<string, Promise<Entry>>();

/** 上限保护：key 是有限集合（用户 × 网络 × 参数），但仍然兜底，避免内存无界增长。 */
const MAX_ENTRIES = 128;

function prune(now: number, ttlMs: number): void {
  for (const [k, v] of STORE) {
    if (now - v.at > ttlMs) STORE.delete(k);
  }
  if (STORE.size <= MAX_ENTRIES) return;
  const ordered = [...STORE.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [k] of ordered.slice(0, STORE.size - MAX_ENTRIES)) STORE.delete(k);
}

/** 缓存键：把「谁在看 / 看哪个网络 / 参数」压成一个不可逆的短串。 */
export function cacheKey(scope: string, token: string, params: URLSearchParams): string {
  const digest = createHash('sha256').update(token || 'anon').digest('base64url').slice(0, 16);
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const tail = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  return `${scope}|${digest}|${tail}`;
}

export async function cachedJson(
  key: string,
  ttlMs: number,
  load: () => Promise<{ status: number; json: unknown }>,
): Promise<CachedJson> {
  const now = Date.now();
  const hitEntry = STORE.get(key);
  if (hitEntry && now - hitEntry.at <= ttlMs) {
    return { status: hitEntry.status, json: hitEntry.json, hit: true };
  }

  const pending = INFLIGHT.get(key);
  if (pending) {
    const shared = await pending;
    return { status: shared.status, json: shared.json, hit: true };
  }

  const task = (async (): Promise<Entry> => {
    const { status, json } = await load();
    const entry: Entry = { at: Date.now(), status, json };
    // 只缓存成功响应：一次 502 不该被冻住整个 TTL。
    if (status >= 200 && status < 300) {
      STORE.set(key, entry);
      prune(entry.at, ttlMs);
    }
    return entry;
  })();

  INFLIGHT.set(key, task);
  try {
    const entry = await task;
    return { status: entry.status, json: entry.json, hit: false };
  } finally {
    INFLIGHT.delete(key);
  }
}

/** 测试用：清空缓存，避免用例间互相影响。 */
export function __clearHubResponseCache(): void {
  STORE.clear();
  INFLIGHT.clear();
}
