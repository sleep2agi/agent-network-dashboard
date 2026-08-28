import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * P1 "本机创建": resolve the local host-supervisor daemon's node_id from the
 * hub node list (a node whose config_snapshot.role === 'host_supervisor'), so
 * the wizard doesn't need a server-picker UI. Returns null if none found.
 */
async function resolveLocalDaemonNodeId(): Promise<string | null> {
  try {
    const res = await hubFetch('/api/nodes');
    if (!res.ok) return null;
    const data = (await res.json()) as { nodes?: unknown; sessions?: unknown };
    const raw = data.nodes ?? data.sessions ?? data;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
    const arr = list as Array<Record<string, unknown>>;
    // PRIMARY — server-extracted `role` field (sleep2agi/agent-network PR
    // fix/api-nodes-role-field). Hub reads role from config_snapshot JSON
    // and exposes it as a top-level row field. Works for ANY daemon node_id
    // (user-created or otherwise), not just the `node_daemon_` prefix.
    for (const n of arr) {
      if (!n || typeof n !== 'object') continue;
      if (n.role === 'host_supervisor') return String(n.node_id || '');
    }
    // LEGACY config_snapshot path — for any older hub that still passes
    // through the raw snapshot blob (no longer the case post-#312, but
    // defensive). Cheap, no extra round-trip.
    for (const n of arr) {
      if (!n || typeof n !== 'object') continue;
      const snapRaw = n.config_snapshot;
      if (typeof snapRaw === 'string') {
        try { if (JSON.parse(snapRaw)?.role === 'host_supervisor') return String(n.node_id || ''); } catch { /* skip */ }
      }
    }
    // LAST-RESORT heuristic — pre-role-field hubs (preview2.4 and older):
    // host_supervisor daemons started via the RFC-026 docker e2e get a
    // `node_daemon_` id prefix. User-created daemons (any node_id) won't
    // match here; they need the `role` field (hub post fix/api-nodes-role-field).
    const daemon = arr.find(n => n && typeof n === 'object' && String(n.node_id || '').startsWith('node_daemon_'));
    if (daemon) return String(daemon.node_id || '');
  } catch { /* fall through */ }
  return null;
}

/**
 * Create-node proxy (node-lifecycle UI M2 — RFC-026 §3.1 P1, 本机创建).
 * Backend `create_node` MCP tool landed in #299 (merged to main).
 *
 *   POST { node_spec:{name,runtime,model,flags,env_refs}, daemon_node_id?, network_id }
 *        → create_node MCP. Returns the hub result (expected to include a
 *          create-request id so the client can poll progress to ✓).
 *
 * RFC-026 §2.5 contract: create_node args = daemon_node_id + node_spec + network_id.
 * P1 pins the daemon to "本机" — the wizard resolves the local daemon_node_id and
 * passes it in; the route does not invent one.
 *
 * Progress polling (pending→succeeded over node_create_requests.status):
 *   ⚠️ OPEN CONTRACT Q2 (asked 通信龙/工程马): get_create_request is daemon-only,
 *   so how does the dashboard poll node_create_requests.status? (REST GET w/ V3
 *   token / a frontend-callable MCP status tool / create_node returns request_id
 *   for a specific endpoint). Until answered, GET below returns a flagged
 *   `unconfirmed` response — NOT a fake "succeeded" (per 通信龙: 别 mock 假成功).
 */

const MCP_TOOL_CREATE = 'create_node';
const EDITABLE_FLAGS = ['model', 'maxTurns', 'budget', 'timeout', 'permissionMode'] as const;
// Canonical runtime IDs accepted by current host supervisors. Keep the two
// preview peers routable even when a particular daemon omits them from its UI
// capability list; the daemon/hub remains the final capability authority.
const RUNTIMES = [
  'claude-agent-sdk',
  'codex-sdk',
  'codex-app-server',
  'grok-build-acp',
  'grok-build-cli',
] as const;

interface NodeSpec {
  name: string;
  runtime: string;
  model?: unknown;
  flags?: Record<string, unknown>;
  env_refs?: unknown;
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: { node_spec?: Partial<NodeSpec>; daemon_node_id?: string; network_id?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const spec = body.node_spec || {};
  const name = (spec.name || '').toString().trim();
  if (!name) return Response.json({ error: 'node_spec.name required' }, { status: 400 });

  const runtime = (spec.runtime || 'claude-agent-sdk').toString();
  if (!RUNTIMES.includes(runtime as (typeof RUNTIMES)[number])) {
    return Response.json({ error: `runtime must be one of: ${RUNTIMES.join(', ')}` }, { status: 400 });
  }

  // Whitelist flags — drop anything outside the editable contract (matches PR C).
  const flags: Record<string, unknown> = {};
  if (spec.flags && typeof spec.flags === 'object') {
    for (const k of EDITABLE_FLAGS) {
      if (k in spec.flags && spec.flags[k] !== undefined) flags[k] = spec.flags[k];
    }
  }

  const node_spec: NodeSpec = {
    name,
    runtime,
    ...(spec.model !== undefined ? { model: spec.model } : {}),
    flags,
    ...(spec.env_refs !== undefined ? { env_refs: spec.env_refs } : {}),
  };

  const networkId = body.network_id || (await resolveDefaultNetworkId());
  // P1: pin to the local host-supervisor daemon if the caller didn't specify one.
  const daemonNodeId = body.daemon_node_id || (await resolveLocalDaemonNodeId());
  if (!daemonNodeId) {
    return Response.json({ ok: false, error: 'no_host_supervisor_daemon', detail: '未找到本机 host_supervisor daemon（需先有一个在线的守护节点）' }, { status: 409 });
  }
  const args: Record<string, unknown> = {
    node_spec,
    daemon_node_id: daemonNodeId,
    ...(networkId ? { network_id: networkId } : {}),
  };

  try {
    const res = await callMcp(MCP_TOOL_CREATE, args);
    if (res.ok) {
      const result = (await parseMcpEnvelope(res)) as { ok?: boolean; error?: string; request_id?: string };
      // The MCP call can be HTTP-200 while create_node itself failed
      // (node_name_conflict, daemon_not_found, daemon_max_children, …). Propagate
      // that as a real failure — never report a fake success (per 通信龙).
      if (result && result.ok === false) {
        return Response.json({ ok: false, error: result.error || 'create_failed', result }, { status: 502 });
      }
      return Response.json({ ok: true, node_spec, result });
    }
    if (res.status === 404 || res.status === 501) {
      return Response.json(
        { ok: false, unconfirmed: true, error: `hub tool '${MCP_TOOL_CREATE}' not available (${res.status}) — is :hub on #299?` },
        { status: 501 },
      );
    }
    return Response.json({ ok: false, error: `hub ${res.status}`, status: res.status }, { status: 502 });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/**
 * Create-request progress poll. ⚠️ BLOCKED on contract Q2 — the polling
 * mechanism for node_create_requests.status is not yet confirmed for the
 * dashboard (get_create_request is daemon-only). Returns a flagged placeholder
 * so the client can wire its progress loop without being told a fake success.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get('request_id');
  if (!requestId) return Response.json({ error: 'request_id required' }, { status: 400 });

  return Response.json(
    {
      ok: false,
      unconfirmed: true,
      request_id: requestId,
      status: 'unknown',
      error: 'create-request status poll not wired — pending contract Q2 (dashboard poll path for node_create_requests.status)',
    },
    { status: 501 },
  );
}
