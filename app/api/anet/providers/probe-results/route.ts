import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Probe-results poll (RFC-028 P2 — get_probe_results, the matrix renderer
 * source). The matrix dispatches probes (async) then polls this for each
 * cell's resolved status. Returns rows:
 *   { provider_id, model_name, daemon_node_id, status, latency_ms, error_label, raw_status_code, probed_at }
 *
 * MOCK_PROVIDERS=1 → deterministic schema-shaped fixture so the preview matrix
 * resolves instantly. Real → get_probe_results MCP.
 */

const MOCK_SERVERS = ['node_daemon_gpu1', 'node_daemon_gpu2', 'node_daemon_cpu1'];
const MOCK_MODELS: Record<string, string[]> = {
  prov_claude: ['claude-opus-4-x', 'claude-sonnet-4-6'],
  prov_deepseek: ['deepseek-v4-pro'],
  prov_minimax: ['MiniMax-M3'],
};

function mockCell(model: string, server: string) {
  let h = 0;
  const s = `${model}@${server}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  const bucket = h % 10;
  if (bucket === 7) return { status: 'auth_fail', error_label: '401 key rejected', raw_status_code: 401 };
  if (bucket === 3) return { status: 'unreachable', error_label: 'connect ETIMEDOUT', raw_status_code: 0 };
  if (bucket === 9) return { status: 'incompatible', error_label: 'model not served', raw_status_code: 404 };
  return { status: 'ok', latency_ms: 80 + (h % 600) };
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get('provider_id') || undefined;

  if (process.env.MOCK_PROVIDERS === '1') {
    const models = (providerId && MOCK_MODELS[providerId]) || [];
    const results = models.flatMap(m => MOCK_SERVERS.map(srv => ({
      provider_id: providerId, model_name: m, daemon_node_id: srv, probed_at: Date.now(), ...mockCell(m, srv),
    })));
    return Response.json({ ok: true, mock: true, results });
  }

  const networkId = await resolveDefaultNetworkId();
  const args: Record<string, unknown> = { ...(providerId ? { provider_id: providerId } : {}), ...(networkId ? { network_id: networkId } : {}), limit: 500 };
  try {
    const res = await callMcp('get_probe_results', args);
    if (res.status === 404 || res.status === 501) {
      return Response.json({ ok: false, unconfirmed: true, results: [], error: 'hub lacks RFC-028 get_probe_results (needs #308)' }, { status: 200 });
    }
    if (!res.ok) return Response.json({ ok: false, error: `hub ${res.status}`, results: [] }, { status: 502 });
    const result = (await parseMcpEnvelope(res)) as { ok?: boolean; results?: unknown[]; error?: string };
    if (result?.ok === false) return Response.json({ ok: false, error: result.error || 'query_failed', results: [] }, { status: 502 });
    return Response.json({ ok: true, results: Array.isArray(result?.results) ? result.results : [] });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e), results: [] }, { status: 502 });
  }
}
