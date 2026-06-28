import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

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

const ACTIONS = ['restart', 'rename'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: { node_id?: string; action?: string; new_name?: string; network_id?: string };
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
  } else {
    // rename
    const newName = (body.new_name || '').trim();
    if (!newName) return Response.json({ error: 'new_name required for rename' }, { status: 400 });
    tool = MCP_TOOL_RENAME;
    args.new_name = newName;
  }

  try {
    const res = await callMcp(tool, args);
    if (res.ok) {
      const result = await parseMcpEnvelope(res);
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
