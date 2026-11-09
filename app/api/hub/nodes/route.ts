import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}


/** /api/status → node 形状。老 Hub 没有 /api/nodes 表时用它兜底，
 *  也用于 nodes 表为空但会话还在的情况（两边必须给出同一份映射）。 */
function nodesFromSessions(sessions: Array<Record<string, unknown>>, requestedNetworkId: string | null) {
  return sessions
    .filter(s => !requestedNetworkId || s.network_id === requestedNetworkId)
    .map(s => ({
      node_id: s.node_id || s.resume_id,
      alias: s.alias,
      status: s.status,
      task: s.task,
      server: s.server,
      hostname: s.hostname,
      agent: s.agent,
      project_dir: s.project_dir,
      registered_at: s.registered_at,
      updated_at: s.updated_at,
      last_seen_at: s.last_seen_at,
      network_id: s.network_id,
    }));
}

/** lite=1：只保留 /nodes 页真正读取的字段。
 *  实测：402 个节点的全量响应 394 KB，而 useNodeLifecycle 只用
 *  alias / node_id / lifecycle_state / avatar_url / display_name / team / tags / attrs_revision。
 *  （2026-11-09 抓到的首屏时间线：/api/hub/nodes 394 KB + 一次 2953 ms 长任务，
 *   首行被压到 11.7 s。）*/
const NODE_LITE_KEEP = ['alias', 'node_id', 'network_id', 'lifecycle_state', 'avatar_url',
  'display_name', 'team', 'tags', 'attrs_revision', 'status', 'agent'] as const;

type NodesPayload = { nodes?: Array<Record<string, unknown>> } & Record<string, unknown>;

function projectNodes<T extends NodesPayload>(data: T, lite: boolean): T {
  if (!lite) return data;
  if (Array.isArray(data.nodes)) {
    data.nodes = data.nodes.map((n) => {
      const out: Record<string, unknown> = {};
      for (const k of NODE_LITE_KEEP) if (k in n) out[k] = n[k];
      return out;
    });
  }
  return data;
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const requestedNetworkId = searchParams.get('network_id');
  const params = new URLSearchParams();
  // `network_id` is required by network-scoped pickers (scheduled tasks,
  // lifecycle UI). Dropping it here makes the browser look scoped while the
  // Hub actually returns every network visible to the user.
  for (const key of ['node_id', 'alias', 'network_id']) {
    const val = searchParams.get(key);
    if (val) params.set(key, val);
  }

  try {
    const url = `${HUB_URL}/api/nodes${params.toString() ? '?' + params.toString() : ''}`;
    const res = await fetch(url, {
      headers: await hubHeaders(),
      next: { revalidate: 0 },
    });
    // #1636 —— 上游 401 原样上抛（否则下面会返回 200 + 空节点）
    if (res.status === 401) return Response.json({ error: 'login required' }, { status: 401 });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      const lite = searchParams.get('lite') === '1';
      if (data.nodes && data.nodes.length > 0) return Response.json(projectNodes(data, lite));
      // nodes table empty — fall back to sessions, map to node shape
      const statusUrl = `${HUB_URL}/api/status${params.toString() ? '?' + params.toString() : ''}`;
      const statusRes = await fetch(statusUrl, { headers: await hubHeaders(), next: { revalidate: 0 } });
      if (statusRes.status === 401) return Response.json({ error: 'login required' }, { status: 401 });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const nodes = nodesFromSessions(statusData.sessions || [], requestedNetworkId);
        return Response.json(projectNodes({ ok: true, nodes, count: nodes.length, source: 'sessions' }, lite));
      }
      return Response.json(projectNodes(data, lite));
    }
    // 老 Hub 没有 /api/nodes（404）：用 /api/status 兜底是设计好的降级。
    // 但 5xx 不是「没有节点」，两个上游都失败时必须报错，否则
    // 生命周期/属性面板会显示成「一个节点都没有」。
    const statusUrl = `${HUB_URL}/api/status${params.toString() ? '?' + params.toString() : ''}`;
    const statusRes = await fetch(statusUrl, { headers: await hubHeaders(), next: { revalidate: 0 } });
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      const nodes = nodesFromSessions(statusData.sessions || [], requestedNetworkId);
      const liteFallback = searchParams.get('lite') === '1';
      return Response.json(projectNodes({ ok: true, nodes, count: nodes.length, source: 'sessions' }, liteFallback));
    }
    // —— 旧 Hub 回退链的**第二跳**也可能 401（主路由 404 → /api/status 401）。
    // 那是「没有登录」，不是「这次查不到节点」：必须原样上抛。
    // 落在下面的 502 会把唯一可执行的提示（去登录）换成一句拼接错误，
    // 前端只会得到「加载失败」，而用户其实只需要重新登录。
    // 注意只补这一跳：主路由自己的 401 由既有 guard 负责，两者不是同一条路径
    // （空表 200 → status 401 是上一条回退，也不在这里）。
    if (statusRes.status === 401) return Response.json({ error: 'login required' }, { status: 401 });
    return Response.json(
      { ok: false, error: `CommHub /api/nodes ${res.status} · /api/status ${statusRes.status}` },
      { status: 502 },
    );
  } catch (e: unknown) {
    return Response.json(
      { error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
