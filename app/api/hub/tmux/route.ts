import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name') || '';
  const lines = searchParams.get('lines') || '30';

  if (!name) return Response.json({ error: 'name required' }, { status: 400 });

  try {
    const res = await hubFetch(`/api/tmux/${encodeURIComponent(name)}?lines=${lines}`);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return Response.json(await res.json());
    return Response.json({ ok: false, error: `tmux capture failed (${res.status})` });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
