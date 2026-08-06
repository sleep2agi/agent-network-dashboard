import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const limit = searchParams.get('limit') || '50';
  const networkId = searchParams.get('network_id') || '';
  // Show last 7 days by default (server defaults to 1 hour which is too short)
  const since = searchParams.get('since') || new Date(Date.now() - 7 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const qs = new URLSearchParams({ limit, since });
  if (networkId) qs.set('network_id', networkId);
  try {
    const res = await hubFetch(`/api/messages?${qs.toString()}`);
    const data = await res.json();
    // Fallback: if network filter returns empty, retry without filter
    if (networkId && data.ok && (!data.messages || data.messages.length === 0)) {
      const fbQs = new URLSearchParams({ limit, since });
      const fbRes = await hubFetch(`/api/messages?${fbQs.toString()}`);
      const fbData = await fbRes.json();
      if (fbData.ok && fbData.messages?.length > 0) {
        return Response.json({ ...fbData, source: 'global' });
      }
    }
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ ok: false, messages: [] }, { status: 502 });
  }
}
