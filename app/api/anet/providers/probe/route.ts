import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Provider connectivity probe (RFC-028 P2 — aligned to real #308 schema).
 *
 *   GET  → probe-target server set (online host_supervisor daemons).
 *   POST { provider_id, model_name, daemon_node_id } → DISPATCH a probe
 *          (probe_provider_model is async: it mints a pending probe_results
 *          row + doorbells the daemon, and returns only { probe_id }). The
 *          actual cell status lands later in probe_results — the matrix polls
 *          /api/anet/providers/probe-results (get_probe_results) for it.
 *
 * Hub-without-RFC-028 → flagged `unconfirmed`. MOCK_PROVIDERS=1 → no-op
 * dispatch (the mock results come from the probe-results route).
 */

function mockServers() {
  return [
    { daemon_node_id: 'node_daemon_gpu1', hostname: 'gpu-node-1' },
    { daemon_node_id: 'node_daemon_gpu2', hostname: 'gpu-node-2' },
    { daemon_node_id: 'node_daemon_cpu1', hostname: 'cpu-node-1' },
  ];
}

async function resolveServerSet(): Promise<Array<{ daemon_node_id: string; hostname: string }>> {
  try {
    const res = await hubFetch('/api/nodes');
    if (!res.ok) return [];
    const data = (await res.json()) as { nodes?: unknown; sessions?: unknown };
    const raw = data.nodes ?? data.sessions ?? data;
    const arr = (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []) as Array<Record<string, unknown>>;
    const out: Array<{ daemon_node_id: string; hostname: string }> = [];
    for (const n of arr) {
      if (!n || typeof n !== 'object') continue;
      const id = String(n.node_id || '');
      if (n.role === 'host_supervisor' || id.startsWith('node_daemon_')) {
        out.push({ daemon_node_id: id, hostname: String(n.server || n.hostname || n.alias || id) });
      }
    }
    return out;
  } catch { return []; }
}

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  if (process.env.MOCK_PROVIDERS === '1') return Response.json({ ok: true, mock: true, servers: mockServers() });
  return Response.json({ ok: true, servers: await resolveServerSet() });
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  let body: { provider_id?: string; model_name?: string; daemon_node_id?: string; network_id?: string };
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const { provider_id, model_name, daemon_node_id } = body;
  if (!provider_id || !model_name || !daemon_node_id) {
    return Response.json({ error: 'provider_id, model_name, daemon_node_id required' }, { status: 400 });
  }
  if (process.env.MOCK_PROVIDERS === '1') {
    return Response.json({ ok: true, mock: true, probe_id: `mock_${model_name}_${daemon_node_id}` });
  }
  const networkId = body.network_id || (await resolveDefaultNetworkId());
  const args = { provider_id, model_name, daemon_node_id, ...(networkId ? { network_id: networkId } : {}) };
  try {
    const res = await callMcp('probe_provider_model', args);
    if (res.status === 404 || res.status === 501) {
      return Response.json({ ok: false, unconfirmed: true, error: 'hub lacks RFC-028 probe_provider_model (needs #308)' }, { status: 200 });
    }
    if (!res.ok) return Response.json({ ok: false, error: `hub ${res.status}` }, { status: 502 });
    const result = (await parseMcpEnvelope(res)) as { ok?: boolean; probe_id?: string; error?: string };
    if (result?.ok === false) return Response.json({ ok: false, error: result.error || 'dispatch_failed' }, { status: 502 });
    return Response.json({ ok: true, probe_id: result?.probe_id });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
