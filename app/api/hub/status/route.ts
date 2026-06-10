import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { normalizeSessions } from '@/app/lib/session-normalize';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || '';
  // "all" or "" → no network_id filter (admin sees all)
  const includeFilter = networkId && networkId !== 'all';
  const qs = includeFilter ? `?network_id=${encodeURIComponent(networkId)}` : '';

  try {
    const res = await hubFetch(`/api/status${qs}`);
    const data = await res.json();
    if (Array.isArray(data.sessions)) data.sessions = normalizeSessions(data.sessions);

    // If filtered result is empty, fetch global count for empty-state hint
    if (includeFilter && Array.isArray(data.sessions) && data.sessions.length === 0) {
      try {
        const globalRes = await hubFetch('/api/status');
        const globalData = await globalRes.json();
        if (Array.isArray(globalData.sessions)) globalData.sessions = normalizeSessions(globalData.sessions);
        const globalCount = Array.isArray(globalData.sessions) ? globalData.sessions.length : 0;
        if (globalCount > 0) {
          return Response.json({ ...data, _hint: { global_count: globalCount, filtered_network: networkId } });
        }
      } catch {}
    }

    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
