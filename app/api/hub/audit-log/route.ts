import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  for (const key of ['limit', 'action', 'user_id', 'network_id']) {
    const val = searchParams.get(key);
    if (val) params.set(key, val);
  }
  // User token overrides CommHub token for user-scoped access
  const userToken = searchParams.get('token') || '';

  try {
    const init: RequestInit = {};
    if (userToken) {
      init.headers = { 'Authorization': `Bearer ${userToken}` };
    }
    // Without userToken, hubFetch uses CommHub auth token

    const res = await hubFetch(`/api/audit-log?${params.toString()}`, init);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return Response.json(await res.json());
    }
    // Graceful fallback
    const text = await res.text().catch(() => '');
    return Response.json({ ok: false, logs: [], count: 0, error: text || `status ${res.status}` });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
