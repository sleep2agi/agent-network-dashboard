import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const res = await hubFetch('/health');
    const data = await res.json();
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
