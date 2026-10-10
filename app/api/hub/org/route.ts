import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Read-only org snapshot: Agent teams (their own tree) and human departments.
 * Writes stay on the hub. A failed half is returned as an error object so the
 * other half can still render.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || (await resolveDefaultNetworkId());
  if (!networkId) return Response.json({ ok: false, error: 'network_id required' }, { status: 400 });

  const enc = encodeURIComponent(networkId);
  try {
    const [teamsRes, deptRes] = await Promise.all([
      hubFetch(`/api/networks/${enc}/agent-teams`),
      hubFetch(`/api/networks/${enc}/departments`),
    ]);
    const teams = await teamsRes.json().catch(() => ({ ok: false, error: 'invalid_hub_response' }));
    const departments = await deptRes.json().catch(() => ({ ok: false, error: 'invalid_hub_response' }));
    if (teamsRes.status === 401 || deptRes.status === 401) {
      return Response.json({ ok: false, error: 'auth_required' }, { status: 401 });
    }
    return Response.json({
      ok: teamsRes.ok || deptRes.ok,
      network_id: networkId,
      teams: teamsRes.ok ? teams : { ok: false, status: teamsRes.status, error: teams?.error || `hub ${teamsRes.status}` },
      departments: deptRes.ok ? departments : { ok: false, status: deptRes.status, error: departments?.error || `hub ${deptRes.status}` },
    });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
