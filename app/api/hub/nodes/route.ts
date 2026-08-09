import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
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
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data.nodes && data.nodes.length > 0) return Response.json(data);
      // nodes table empty — fall back to sessions, map to node shape
      const statusRes = await fetch(`${HUB_URL}/api/status`, { headers: await hubHeaders(), next: { revalidate: 0 } });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        const nodes = (statusData.sessions || []).map((s: Record<string, unknown>) => ({
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
        return Response.json({ ok: true, nodes, count: nodes.length, source: 'sessions' });
      }
      return Response.json(data);
    }
    return Response.json({ ok: true, nodes: [], count: 0, source: 'fallback' });
  } catch (e: unknown) {
    return Response.json(
      { error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
