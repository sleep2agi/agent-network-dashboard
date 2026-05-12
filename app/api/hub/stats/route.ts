import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || '';
  const qs = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';

  try {
    const res = await hubFetch(`/api/stats${qs}`);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return Response.json(await res.json());
    }
    // Fallback: server doesn't have /api/stats yet
    return Response.json({ ok: false, error: 'stats endpoint not available' }, { status: 404 });
  } catch (e: unknown) {
    return Response.json(
      { error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
