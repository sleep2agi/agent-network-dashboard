import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  for (const key of ['task_id', 'limit', 'network_id']) {
    const val = searchParams.get(key);
    if (val) params.set(key, val);
  }

  try {
    const res = await hubFetch(`/api/task_events?${params.toString()}`);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return Response.json(await res.json());
    return Response.json({ ok: true, events: [], count: 0 });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
