import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId, HUB_MCP_PATH, MCP_PROTOCOL_VERSION } from '@/app/lib/hub-mcp';
import { hubFetch } from '@/app/lib/hub';

/**
 * Per-node lifecycle actions proxy (node-lifecycle UI M1 — restart / rename;
 * delete is a disabled placeholder until RFC-027). Thin MCP proxy to the hub
 * using the browser session's V3 user token (hubFetch), mirroring the shape
 * the node-config route (#260/#262 PR C) established:
 *
 *   POST { node_id, action: 'restart' }                  → restart_node  (RFC-024, shipped)
 *   POST { node_id, action: 'rename', new_name: string } → rename_node   (⚠️ contract Q1)
 *
 * Contract is the hub MCP endpoint at HUB_MCP_PATH (JSON-RPC tools/call),
 * which returns either application/json or text/event-stream; in both cases
 * the tool payload is JSON in result.content[0].text.
 *
 * OPEN CONTRACT QUESTIONS (asked 通信龙/工程马, gate the final wiring):
 *   Q1 rename: does a hub MCP tool exist (assumed `rename_node`)? If not,
 *      工程马 adds it RFC-024-style; until confirmed, rename returns a flagged
 *      `unconfirmed` response (NOT fake success) so the UI can show "pending backend".
 *   Q3 restart completion: how is restart take-effect confirmed — reuse the
 *      RFC-024 config_revision poll, or a dedicated status? For now we return
 *      the raw restart_node result and let the client poll node status back to
 *      online (same pattern as PR C's apply-lifecycle). Adjust once answered.
 *
 * ⚠️ Per 通信龙: never mock fake success. On hub error / unconfirmed tool we
 * surface the real failure so the UI never lies about a node having restarted.
 */

const MCP_TOOL_RESTART = 'restart_node';
const MCP_TOOL_RENAME = 'rename_node'; // ⚠️ Q1 — confirm hub-side tool name before relying on this
// RFC-027 PR2 — stop/delete lifecycle. daemon_node_id is auto-resolved
// hub-side from child_node_id (PR2 prereq); dashboard doesn't pass it.
const MCP_TOOL_STOP = 'stop_node';
const MCP_TOOL_DELETE = 'delete_node';

const ACTIONS = ['restart', 'rename', 'stop', 'delete'] as const;
type Action = (typeof ACTIONS)[number];

/**
 * GET → lifecycle capability probe (usability-audit rule: a control only
 * renders when its backend actually exists). Queries the hub's MCP
 * tools/list once a minute and reports which lifecycle tools are live —
 * prod hubs behind the canonical train may lack rename/stop/delete while
 * newer ones have them, and the UI must not show dead buttons either way.
 */
let capsCache: { at: number; tools: Record<string, boolean> } | null = null;
const CAPS_TTL_MS = 60_000;

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  if (capsCache && Date.now() - capsCache.at < CAPS_TTL_MS) {
    return Response.json({ ok: true, cached: true, tools: capsCache.tools });
  }
  try {
    const res = await hubFetch(HUB_MCP_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    if (!res.ok) return Response.json({ ok: false, error: `hub ${res.status}` }, { status: 502 });
    // tools/list is NOT a tools/call — its result is { tools: [...] } with no
    // content[].text, so parseMcpEnvelope (built for tool calls) would throw.
    // Parse the JSON-RPC envelope directly (json or SSE data: frame).
    const raw = await res.text();
    let envelope: { result?: { tools?: { name?: string }[] } } = {};
    try {
      const dataLine = raw.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean).pop();
      envelope = JSON.parse(dataLine || raw);
    } catch { /* fall through to empty names */ }
    const names: string[] = (envelope.result?.tools || []).map(t => String(t.name || ''));
    if (names.length === 0) {
      // Unreadable list ≠ "no tools" — report unknown rather than hiding
      // everything (restart is known-live on every hub we run).
      return Response.json({ ok: false, error: 'tools_list_unreadable' }, { status: 502 });
    }
    const tools = {
      restart: names.includes(MCP_TOOL_RESTART),
      rename: names.includes(MCP_TOOL_RENAME),
      stop: names.includes(MCP_TOOL_STOP),
      delete: names.includes(MCP_TOOL_DELETE),
    };
    capsCache = { at: Date.now(), tools };
    return Response.json({ ok: true, tools });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: {
    node_id?: string;
    action?: string;
    new_name?: string;
    network_id?: string;
    // RFC-027 PR2 stop/delete:
    confirm_alias?: string;     // delete only — must equal node alias byte-exact
    force?: boolean;             // both — override in-flight refuse + audit
    grace_seconds?: number;      // both — SIGTERM grace before SIGKILL (5-60s, default 10)
    delete_config?: boolean;     // delete only — false keeps config dir, default true backs up
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const nodeId = body.node_id;
  if (!nodeId) return Response.json({ error: 'node_id required' }, { status: 400 });

  const action = body.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) {
    return Response.json({ error: `action must be one of: ${ACTIONS.join(', ')}` }, { status: 400 });
  }

  // node MCP tools require an explicit network_id (V3 token current_network may
  // be null). Prefer the caller's, else resolve the user's default from /api/auth/me.
  const networkId = body.network_id || (await resolveDefaultNetworkId());

  // Build the MCP tool + arguments per action.
  let tool: string;
  const args: Record<string, unknown> = {
    node_id: nodeId,
    ...(networkId ? { network_id: networkId } : {}),
  };

  if (action === 'restart') {
    tool = MCP_TOOL_RESTART;
  } else if (action === 'rename') {
    const newName = (body.new_name || '').trim();
    if (!newName) return Response.json({ error: 'new_name required for rename' }, { status: 400 });
    tool = MCP_TOOL_RENAME;
    args.new_name = newName;
  } else if (action === 'stop') {
    // RFC-027 §2.2 stop_node. daemon_node_id auto-resolves hub-side.
    tool = MCP_TOOL_STOP;
    args.child_node_id = nodeId;
    delete args.node_id;
    if (body.force === true) args.force = true;
    if (typeof body.grace_seconds === 'number') args.grace_seconds = body.grace_seconds;
  } else if (action === 'delete') {
    // RFC-027 §2.2 delete_node. confirm_alias REQUIRED + must match.
    const confirmAlias = (body.confirm_alias || '').trim();
    if (!confirmAlias) return Response.json({ error: 'confirm_alias required for delete (must equal node alias)' }, { status: 400 });
    tool = MCP_TOOL_DELETE;
    args.child_node_id = nodeId;
    delete args.node_id;
    args.confirm_alias = confirmAlias;
    if (body.force === true) args.force = true;
    if (typeof body.grace_seconds === 'number') args.grace_seconds = body.grace_seconds;
    if (body.delete_config === false) args.delete_config = false;
  } else {
    // exhaustive; the ACTIONS check above catches unknown actions first
    return Response.json({ error: `unhandled action: ${action}` }, { status: 500 });
  }

  try {
    const res = await callMcp(tool, args);
    if (res.ok) {
      const result = await parseMcpEnvelope(res) as Record<string, unknown>;
      // RFC-027 PR2 (通信龙 explicit): structured errors from the hub tool
      // payload (node_not_active / cannot_delete_daemon / node_busy_in_flight
      // / confirm_alias_mismatch / forbidden_cross_tenant ...) MUST surface
      // as-is to the user — don't wrap them as outer ok:true with a hidden
      // result.ok:false. Promote the inner ok + error to the outer envelope
      // so the dashboard can render the real message.
      if (result && typeof result === 'object' && (result as { ok?: boolean }).ok === false) {
        // Bubble hub's structured payload to a 409 (action refused, e.g.
        // in-flight/cross-tenant/wrong-confirm) so the dashboard can branch
        // on error code without parsing 200-with-ok:false.
        return Response.json(
          { ...result, action, node_id: nodeId },
          { status: 409 },
        );
      }
      return Response.json({ ok: true, action, node_id: nodeId, result });
    }
    // Hub reached but tool not available (e.g. rename_node not deployed yet → Q1).
    if (res.status === 404 || res.status === 501) {
      return Response.json(
        {
          ok: false,
          unconfirmed: true,
          action,
          node_id: nodeId,
          error: `hub tool '${tool}' not available (${res.status})`,
        },
        { status: 501 },
      );
    }
    return Response.json({ ok: false, action, error: `hub ${res.status}`, status: res.status }, { status: 502 });
  } catch (e: unknown) {
    // Honest failure — never report a fake success.
    return Response.json(
      {
        ok: false,
        action,
        node_id: nodeId,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
