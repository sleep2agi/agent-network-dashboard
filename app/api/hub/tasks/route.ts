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
    const contentType = tasksRes.headers.get('content-type') || '';
    if (tasksRes.ok && contentType.includes('application/json')) {
      const data = await tasksRes.json();
      if (data.ok && data.tasks && data.tasks.length > 0) {
        return Response.json(data);
      }
      // network_id filter returned empty — retry without filter to include unassigned tasks
      if (networkId && data.tasks?.length === 0) {
        const fallbackParams = new URLSearchParams();
        if (filterStatus) fallbackParams.set('status', filterStatus);
        if (filterFrom) fallbackParams.set('from_name', filterFrom);
        if (filterTo) fallbackParams.set('to_name', filterTo);
        if (before) fallbackParams.set('before', before);
        if (beforeTaskId) fallbackParams.set('before_task_id', beforeTaskId);
        fallbackParams.set('limit', String(limit));
        fallbackParams.set('skip_stats', '1');
        const fbRes = await fetch(`${HUB_URL}/api/tasks?${fallbackParams.toString()}`, { headers: await hubHeaders(), next: { revalidate: 0 } });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          if (fbData.ok && fbData.tasks?.length > 0) {
            return Response.json({ ...fbData, source: 'global' });
          }
        }
        return Response.json(data);
      }
      // For targeted queries (chat history by to_name, or a single task_id),
      // a valid empty v2 result is authoritative — return it immediately
      // instead of falling through to a global /api/completions scan. That
      // extra round-trip is what kept the chat-history spinner turning on a
      // node with no tasks yet, and its substring to_name match could surface
      // unrelated rows. Broad list queries keep the legacy fallback below.
      // (Vincent tg923: 转圈加载太久)
      if (data.ok && Array.isArray(data.tasks) && (filterTo || filterTaskId)) {
        return Response.json(data);
      }
    }

    // Fallback: map /api/completions to tasks shape
    const compRes = await fetch(
      `${HUB_URL}/api/completions?limit=${limit}`,
      { headers: await hubHeaders(), next: { revalidate: 0 } },
    );
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
