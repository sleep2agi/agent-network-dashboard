import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { buildAgentOrg } from '@/app/lib/agent-org.mjs';
import { hubFetch } from '@/app/lib/hub';
import { resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

const DIRECTORY_PAGE_LIMIT = 200;
const DIRECTORY_MAX_PAGES = 20;

async function readDirectory(networkId: string): Promise<{ status: number; pages: unknown[] }> {
  const pages: unknown[] = [];
  let offset = 0;
  for (let page = 0; page < DIRECTORY_MAX_PAGES; page += 1) {
    const res = await hubFetch(`/api/requirements/people/directory?network_id=${encodeURIComponent(networkId)}&limit=${DIRECTORY_PAGE_LIMIT}&offset=${offset}`);
    const body = await res.json().catch(() => null);
    if ((res.status === 404 || res.status === 405) && page === 0) return { status: res.status, pages: [] };
    if (!res.ok || (body && typeof body === 'object' && (body as { ok?: unknown }).ok === false)) {
      return { status: res.ok ? 502 : res.status, pages };
    }
    pages.push(body);
    const row = body && typeof body === 'object' ? body as { has_more?: unknown; next_offset?: unknown } : {};
    const next = typeof row.next_offset === 'number' ? row.next_offset : null;
    if (row.has_more !== true || next === null || next <= offset) return { status: 200, pages };
    offset = next;
  }
  return { status: 200, pages };
}

/**
 * Read-only org snapshot. Agent organization is the department tree plus the
 * people directory (agents hang off their owner). Agent teams stay a separate
 * list. Writes stay on the Hub; a failed half does not blank the other.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || (await resolveDefaultNetworkId());
  if (!networkId) return Response.json({ ok: false, error: 'network_id required' }, { status: 400 });

  const enc = encodeURIComponent(networkId);
  try {
    const [teamsRes, deptRes, directory] = await Promise.all([
      hubFetch(`/api/networks/${enc}/agent-teams`),
      hubFetch(`/api/networks/${enc}/departments`),
      readDirectory(networkId),
    ]);
    const teams = await teamsRes.json().catch(() => ({ ok: false, error: 'invalid_hub_response' }));
    const departments = await deptRes.json().catch(() => ({ ok: false, error: 'invalid_hub_response' }));
    if (teamsRes.status === 401 || deptRes.status === 401 || directory.status === 401) {
      return Response.json({ ok: false, error: 'auth_required' }, { status: 401 });
    }
    const org = buildAgentOrg({
      departmentsStatus: deptRes.status,
      departmentsBody: departments,
      directoryStatus: directory.status,
      directoryPages: directory.pages,
    });
    return Response.json({
      ok: teamsRes.ok || deptRes.ok || directory.status === 200,
      network_id: networkId,
      teams: teamsRes.ok ? teams : { ok: false, status: teamsRes.status, error: teams?.error || `hub ${teamsRes.status}` },
      departments: deptRes.ok ? departments : { ok: false, status: deptRes.status, error: departments?.error || `hub ${deptRes.status}` },
      org,
    });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
