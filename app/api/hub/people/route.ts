import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';
import { cachedJson, cacheKey } from '@/app/lib/hub-response-cache';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Org directory — #1635.
 *
 * The Hub already builds this projection for MCP `requirements_people`
 * (people + department + the Agents each person owns). Its REST twin is
 * `/api/requirements/people/directory`; there is no `/api/people`. Proxying
 * the existing one keeps a single source of truth instead of a second query.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  // 透传 network_id：多网络账号必须显式指定，否则 Hub 侧
  // resolveRestReadNetworkId 只会回落到「恰好一个成员关系」。
  for (const key of ['q', 'limit', 'offset', 'network_id']) {
    const value = searchParams.get(key);
    if (value) params.set(key, value);
  }
  if (!params.has('limit')) params.set('limit', '100');

  try {
    // `.650`：军团首帧 = max(people, departments) + 2ms，Hub 侧这两个接口 0.7–3s。
    // 2D / 3D / org 三页共用这份目录，10s 内的重复访问不该重复付这笔钱。
    // key 里带用户 token 的哈希：人员目录按权限过滤，不能跨用户复用。
    const token = await getV3UserToken();
    const key = cacheKey('people', token || '', params);
    const { status, json, hit } = await cachedJson(key, 10_000, async () => {
      const res = await fetch(`${HUB_URL}/api/requirements/people/directory?${params.toString()}`, {
        headers: await hubHeaders(),
        next: { revalidate: 0 },
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { status: 502, json: { ok: false, error: 'hub_not_json', status: res.status } };
      }
      return { status: res.status, json: await res.json() };
    });
    return Response.json(json, {
      status,
      headers: { 'X-Dashboard-Cache': hit ? 'hit' : 'miss' },
    });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
