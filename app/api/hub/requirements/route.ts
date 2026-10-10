import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Read-only requirements board.
 * Hub projects `abandoned` to `done` unless the caller declares the column.
 * Both the header and `accept_columns` are sent so an older proxy that
 * drops custom headers still asks for the real value.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || (await resolveDefaultNetworkId());
  if (!networkId) return Response.json({ ok: false, error: 'network_id required' }, { status: 400 });

  const qs = new URLSearchParams({
    network_id: networkId,
    view: 'summary',
    limit: '200',
    accept_columns: 'abandoned',
  });

  try {
    const res = await hubFetch(`/api/requirements?${qs.toString()}`, {
      headers: {
        Accept: 'application/json',
        'X-Anet-Accept-Columns': 'abandoned',
      },
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'invalid_hub_response' }));
    return Response.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    return Response.json({ ok: false, requirements: [], error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
