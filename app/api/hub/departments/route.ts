import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';
import { cachedJson, cacheKey } from '@/app/lib/hub-response-cache';
import { hubFetch } from '@/app/lib/hub';
import { resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * 部门树代理 —— 与客户端 `GET /api/networks/{id}/departments` 同一份数据
 * （客户端证据：`src/org-api.ts:63`）。
 *
 * 为什么必须单独一条：`/api/requirements/people/directory` 只带
 * `department: { id, name }`，拿不到 `parent_id` / `leader_user_id` / 成员表，
 * 于是 Dashboard 的组织架构只能是「人按部门名分堆」，画不出真实编制。
 *
 * 契约：**状态码原样透传**。老 Hub 没有这条路由 → 404，前端据此回退到
 * 扁平分组；不能把 404 改写成 200 或 502，否则「Hub 不支持」和「网络断了」
 * 会被混成同一个空页面。
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  let networkId = searchParams.get('network_id');
  if (!networkId) networkId = await resolveDefaultNetworkId();
  if (!networkId) {
    return Response.json({ ok: false, error: 'network_id_required' }, { status: 400 });
  }

  try {
    // `.650`：与 people 同一套 10s 短缓存（理由见 hub-response-cache.ts）。
    // 404 也必须原样透传且不缓存成"成功"——老 Hub 没有这条路由时前端要回退到扁平分组。
    const token = await getV3UserToken();
    const key = cacheKey('departments', token || '', new URLSearchParams({ network_id: networkId }));
    const { status, json, hit } = await cachedJson(key, 10_000, async () => {
      const res = await hubFetch(`/api/networks/${encodeURIComponent(networkId)}/departments`);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return {
          status: res.status === 404 ? 404 : 502,
          json: { ok: false, error: 'hub_not_json', status: res.status },
        };
      }
      const parsed = (await res.json()) as { departments?: unknown; members?: unknown; ok?: boolean };
      return {
        status: res.status,
        json: { ok: res.ok ? (parsed.ok ?? true) : false, ...parsed, network_id: networkId },
      };
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
