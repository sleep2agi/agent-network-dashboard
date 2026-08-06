import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const body = await req.json();
    const res = await hubFetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, from_session: 'Dashboard' }),
    });
    const data = await res.json();
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: 'CommHub unreachable' }, { status: 502 });
  }
}
