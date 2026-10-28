import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

interface Completion {
  id: string;
  session_name: string;
  task: string;
  result: string;
  artifacts: unknown;
  score: number | null;
  duration_minutes: number | null;
  completed_at: string;
}

/**
 * Proxy layer: tries /api/tasks first (v2), falls back to /api/completions (v0.4.1).
 * Front-end always gets a stable {ok, tasks[], count} shape.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') || '100', 10);
  const networkId = searchParams.get('network_id') || '';
  const filterStatus = searchParams.get('status') || '';
  const filterFrom = searchParams.get('from_name') || '';
  const filterTo = searchParams.get('to_name') || '';
  const filterTaskId = searchParams.get('task_id') || '';
  const before = searchParams.get('before') || '';
  const beforeTaskId = searchParams.get('before_task_id') || '';
  // #248 — the dashboard never consumes the per-status `stats` block that
  // the v2 endpoint computes by default (full GROUP BY scan on a large
  // tasks table). Opt out via `?skip_stats=1` to skip the subquery on
  // commhub-server ≥ 0.8.8 — older servers ignore the unknown flag and
  // return the full payload, so this is safe regardless of hub version.
  // Combined with the composite `(to_name, created_at DESC)` index that
  // also shipped in 0.8.8, the chat panel's history fetch goes from
  // ~28 ms p50 to ~1 ms p50 on a 100k-task DB (Docker A/B verified).

  try {
    // Try v2 /api/tasks first
    const params = new URLSearchParams();
    if (networkId) params.set('network_id', networkId);
    if (filterStatus) params.set('status', filterStatus);
    if (filterFrom) params.set('from_name', filterFrom);
    if (filterTo) params.set('to_name', filterTo);
    if (filterTaskId) params.set('task_id', filterTaskId);
    if (before) params.set('before', before);
    if (beforeTaskId) params.set('before_task_id', beforeTaskId);
    params.set('limit', String(limit));
    params.set('skip_stats', '1');

    const tasksRes = await fetch(
      `${HUB_URL}/api/tasks?${params.toString()}`,
      { headers: await hubHeaders(), next: { revalidate: 0 } },
    );
    // #1636-P1 —— 上游说 401 就是 401。绝不能落进下面的 /api/completions 兜底，
    // 否则「登录失效」会被显示成「暂无任务」（最容易被误判成系统正常的假空态）。
    if (tasksRes.status === 401) {
      return Response.json({ ok: false, error: 'login required' }, { status: 401 });
    }
    if (tasksRes.status === 403) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    const contentType = tasksRes.headers.get('content-type') || '';
    const tasksJson = tasksRes.ok && contentType.includes('application/json');

    if (tasksJson) {
      const data = await tasksRes.json();
      // 200 + ok:false 也是上游故障（Hub 自己说没给成结果），不能当成空列表。
      if (data.ok === false) {
        return Response.json(
          { ok: false, error: `CommHub /api/tasks ${tasksRes.status} (ok:false)` },
          { status: 502 },
        );
      }
      // #1636-P1 —— **主接口的合法 200（含空数组）就是答案，直接返回**。
      //
      // 旧实现在这里分三种情况绕过：
      //   1. 有 network_id 且为空 ⇒ 撤掉 network_id 再查一次（跨网络串数据）；
      //   2. 广查询为空 ⇒ 继续去 /api/completions 捞历史，命中就带上
      //      `source: 'completions'` 返回 —— 主接口说的「这个网络/这批筛选下没有任务」
      //      被悄悄替换成另一份数据的投影；
      //   3. 定向查询为空 ⇒ 直接返回（这一条本来就是对的）。
      //
      // 共同的问题是：**调用方无法从响应里看出答案来自哪个接口**。
      // 「没有任务」和「我换了个数据源给你看历史」必须由调用方自己决定，
      // 不能由代理层替它决定。所以这里统一直接返回。
      //
      // 产品口径：任务的「当前列表」= /api/tasks；历史完成记录是**另一个视图**
      // （要的话应由页面显式发起 /api/completions，而不是被代理层替换）。
      return Response.json(data);
    } else {
      // 非 2xx，或 2xx 但不是 JSON。
      //   · 404/405/501 = 旧 Hub 没有 /api/tasks ⇒ 允许走 completions 兜底；
      //   · 其它（401 已在上面、500/502/HTML）= **上游故障**，必须非 2xx。
      const endpointMissing =
        tasksRes.status === 404 || tasksRes.status === 405 || tasksRes.status === 501;
      if (!endpointMissing) {
        return Response.json(
          { ok: false, error: `CommHub /api/tasks ${tasksRes.status}` },
          { status: 502 },
        );
      }
      // 旧 Hub 没有 /api/tasks，而调用方指定了网络：completions 不支持按网络过滤，
      // 用它兜底等于跨网络返回数据。但也**不能伪装成 200 空列表** —— 那是假空态，
      // 用户会以为「这个网络真的没任务」。返回一个可识别的能力错误，让调用方
      // 能显示「当前 Hub 不支持按网络查询任务」。
      if (networkId) {
        return Response.json(
          {
            ok: false,
            error: 'hub_tasks_scope_unsupported',
            detail: `CommHub /api/tasks ${tasksRes.status}: 该 Hub 不支持按网络查询任务，无法在保持 network_id 作用域的前提下返回结果`,
          },
          { status: 501 },
        );
      }
    }

    // Fallback: map /api/completions to tasks shape
    const compRes = await fetch(
      `${HUB_URL}/api/completions?limit=${limit}`,
      { headers: await hubHeaders(), next: { revalidate: 0 } },
    );
    // 两个上游都失败时必须报错：旧实现会返回 {ok:true, tasks:[]}，
    // 页面于是把「Hub 挂了我读不到」显示成「暂无任务」。
    if (compRes.status === 401) {
      return Response.json({ ok: false, error: 'login required' }, { status: 401 });
    }
    if (compRes.status === 403) {
      return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    if (!compRes.ok) {
      return Response.json(
        { ok: false, error: `CommHub /api/tasks ${tasksRes.status} · /api/completions ${compRes.status}` },
        { status: 502 },
      );
    }
    const compData = await compRes.json();
    const completions: Completion[] = compData.completions || [];

    let tasks = completions.map(c => ({
      task_id: c.id,
      from_name: '',
      to_name: c.session_name,
      status: 'replied',
      priority: 'normal',
      content: c.task || '',
      result: c.result || '',
      created_at: c.completed_at,
      updated_at: c.completed_at,
      delivered_at: '',
      started_at: '',
      completed_at: c.completed_at,
      expires_at: '',
    }));

    // Apply client-side filters for fallback mode
    if (filterStatus && filterStatus !== 'replied') {
      tasks = []; // completions are all "replied"
    }
    if (filterFrom) {
      tasks = tasks.filter(t => t.from_name.includes(filterFrom));
    }
    if (filterTo) {
      tasks = tasks.filter(t => t.to_name.includes(filterTo));
    }

    return Response.json({ ok: true, tasks, count: tasks.length, source: 'completions' });
  } catch (e: unknown) {
    return Response.json(
      { error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
