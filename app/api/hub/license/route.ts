import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const res = await hubFetch('/api/license');
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return Response.json(await res.json());
    return Response.json({ ok: false, error: 'license endpoint not available' }, { status: 404 });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const body = await req.json();
    const res = await hubFetch('/api/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return Response.json(await res.json());
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
