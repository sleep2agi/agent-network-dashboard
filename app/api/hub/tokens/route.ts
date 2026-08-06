import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const res = await hubFetch('/api/auth/tokens');
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return Response.json(await res.json());
    return Response.json({ ok: true, tokens: [] });
  } catch (e: unknown) {
    return Response.json({ error: 'failed' }, { status: 502 });
  }
}
