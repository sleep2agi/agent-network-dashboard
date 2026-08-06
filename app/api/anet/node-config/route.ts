import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

/**
 * Per-node config read/write proxy (#260 / #262 — make node settings actually
 * take effect). Thin proxy to the hub, using the browser session's V3 user
 * token (hubFetch forwards `Authorization: Bearer utok_…`). Endpoint contract =
 * RFC-024 (通信工程马, #287/#294/#290, e2e verified):
 *
 *   GET  ?node_id=…|alias=…  → REST GET /api/nodes/{id}/config — masked snapshot
 *        { ok, node_id, alias, network_id, config_revision, model, flags{6},
 *          config_update_capable }. Network scope auto-filtered hub-side.
 *   POST { node_id|alias, base_revision, model?, flags? }
 *        → MCP tools/call `update_node_config` at /mcp.
 *        → { ok, update_id, apply_mode } or { ok:false, error, … }.
 *
 * apply-status has NO endpoint: the client polls GET and compares the returned
 * `config_revision` against the `base_revision` it sent — a bump (> base) means
 * applied (snapshot is ground truth; hub atomically finalizes the row + bumps
 * nodes.config_revision). See NodeSettingsPanel.
 *
 * If the hub is unreachable the GET mock-falls back with `mock:true` (panel then
 * shows the "后端未接入" note); in normal live operation no mock flag is set.
 */

const HUB_GET_PATH = (nodeId: string) => `/api/nodes/${encodeURIComponent(nodeId)}/config`;
const HUB_MCP_PATH = '/mcp'; // MCP Streamable HTTP endpoint (tools/call)
const MCP_TOOL_UPDATE = 'update_node_config';
const MCP_PROTOCOL_VERSION = '2025-03-26';

// Editable flags whitelist (RFC-024 — confirmed with 工程马). Anything outside
// this set is dropped before forwarding so the UI can't smuggle unexpected keys
// into the patch. (`teammateMode` is NOT in the hub allowlist — update would
// return invalid_patch — so it's excluded here and from the form.)
const EDITABLE_FLAGS = [
  'permissionMode',
  'dangerouslySkipPermissions',
  'maxTurns',
  'budget',
  'timeout',
] as const;

// #260 channel edit — the panel toggles enable/disable for these keys only.
// Per-channel secrets (bot token / app secret / allowFrom) stay in the node's
// local config.json, never on the wire from the UI. WeChat is roadmap-only in
// the panel and intentionally not listed here.
const EDITABLE_CHANNELS = ['telegram', 'feishu', 'commhub'] as const;

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') || '').includes('application/json');
}

/**
 * Parse an MCP Streamable-HTTP response (either application/json or an SSE
 * text/event-stream frame) into the JSON-RPC envelope object.
 */
async function parseMcpEnvelope(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const o = JSON.parse(payload);
        if (o && (o.jsonrpc || o.result || o.error)) return o;
      } catch { /* keep scanning frames */ }
    }
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  // hub only resolves node_id — an alias would silently 404, so don't accept it.
  const nodeId = searchParams.get('node_id') || '';
  if (!nodeId) return Response.json({ error: 'node_id required' }, { status: 400 });

  try {
    const res = await hubFetch(HUB_GET_PATH(nodeId));
    if (res.ok && isJson(res)) return Response.json(await res.json());
    // Pass a real hub error (e.g. 404 node_not_found) straight through.
    if (isJson(res)) return Response.json(await res.json(), { status: res.status });
    // Hub unreachable / non-JSON → flagged fallback so the panel still renders.
    // (channels kept in the shape for the #31 channel toggles.)
    return Response.json({ ok: true, mock: true, node_id: nodeId, model: null, flags: {}, channels: [] });
  } catch (e: unknown) {
    return Response.json({
      ok: true,
      mock: true,
      node_id: nodeId,
      model: null,
      flags: {},
      channels: [],
      _hubError: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: {
    node_id?: string;
    base_revision?: number;
    network_id?: string;
    model?: unknown;
    flags?: Record<string, unknown>;
    channels?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // hub only resolves node_id (no alias fallback — it would silently 404).
  const nodeId = body.node_id;
  if (!nodeId) return Response.json({ error: 'node_id required' }, { status: 400 });
  if (typeof body.base_revision !== 'number') {
    return Response.json({ error: 'base_revision (number) required' }, { status: 400 });
  }

  // Build the partial patch — only the fields the client sends. Flags and
  // channels are whitelisted to the editable contract.
  const patch: { model?: unknown; flags?: Record<string, unknown>; channels?: string[] } = {};
  if (body.model !== undefined) patch.model = body.model;
  if (body.flags && typeof body.flags === 'object') {
    const flags: Record<string, unknown> = {};
    for (const k of EDITABLE_FLAGS) {
      if (k in body.flags && body.flags[k] !== undefined) flags[k] = body.flags[k];
    }
    if (Object.keys(flags).length > 0) patch.flags = flags;
  }
  // Whitelist channels (#31) — accept string[] of EDITABLE_CHANNELS keys only.
  // Any other shape or key is dropped, so the panel can never smuggle a secret
  // payload or an unknown channel name to the hub. Channels ride INSIDE the
  // RFC-024 patch — update_node_config's schema is { model?, flags?, channels? }.
  if (Array.isArray(body.channels)) {
    const allow = new Set<string>(EDITABLE_CHANNELS);
    const seen = new Set<string>();
    const channels: string[] = [];
    for (const c of body.channels) {
      if (typeof c !== 'string') continue;
      const key = c.trim().toLowerCase();
      if (!allow.has(key) || seen.has(key)) continue;
      seen.add(key);
      channels.push(key);
    }
    patch.channels = channels;
  }
  if (patch.model === undefined && !patch.flags && !patch.channels) {
    return Response.json({ ok: false, error: 'empty_patch' }, { status: 400 });
  }

  // Resolve network_id — REQUIRED by update_node_config when the token's
  // current_network is null (dry-run verified: omitting it → permission_denied).
  // Prefer the node's own network (sent by the client, who knows which network
  // the node is in) — re-deriving from /api/auth/me networks[0] picks the wrong
  // network for multi-network users (regression-test caught a false
  // cross_network_node). The hub still authorizes (SEC-1), so trusting the
  // client's network_id is safe. Fall back to the me-derivation.
  let networkId: string | undefined = body.network_id;
  if (!networkId) {
    try {
      const meRes = await hubFetch('/api/auth/me');
      if (meRes.ok) {
        const me = await meRes.json();
        networkId = me?.current_network || me?.networks?.[0]?.network_id;
      }
    } catch { /* fall through — hub may still infer if current_network is set */ }
  }

  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: MCP_TOOL_UPDATE,
      arguments: { node_id: nodeId, base_revision: body.base_revision, patch, ...(networkId ? { network_id: networkId } : {}) },
    },
  };

  try {
    const res = await hubFetch(HUB_MCP_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify(rpcBody),
    });

    if (!res.ok && res.status >= 500) {
      return Response.json({ ok: false, error: `hub ${res.status}` }, { status: 502 });
    }

    const rpc = await parseMcpEnvelope(res);
    if (!rpc) return Response.json({ ok: false, error: 'mcp_unparseable' }, { status: 502 });
    if (rpc.error) {
      const err = rpc.error as { message?: string };
      return Response.json({ ok: false, error: 'mcp_error', detail: err?.message }, { status: 502 });
    }

    // tools/call wraps the tool's JSON in result.content[0].text.
    const result = rpc.result as { content?: Array<{ text?: string }> } | undefined;
    const textContent = result?.content?.[0]?.text;
    let inner: Record<string, unknown> = {};
    if (typeof textContent === 'string') {
      try { inner = JSON.parse(textContent); } catch { inner = {}; }
    } else if (rpc.result && typeof rpc.result === 'object') {
      inner = rpc.result as Record<string, unknown>;
    }
    // inner = { ok:true, update_id, apply_mode } | { ok:false, error, … }
    // App-level errors come back HTTP 200 (ok:false) so the client maps them.
    return Response.json(inner);
  } catch (e: unknown) {
    return Response.json({ ok: false, error: 'hub_unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
