import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

/**
 * Per-node config read/write proxy (#260 / #262 v0.11 — make node settings
 * actually work). Thin proxy to the hub, using the browser session's V3 user
 * token (hubFetch):
 *   GET ?node_id=…|alias=…  → current node config snapshot (model + flags)
 *   GET ?apply_id=…         → apply-lifecycle status for a prior POST (F3)
 *   POST { node_id|alias, model?, flags? } → update_node_config; returns an
 *                            applyId + status so the UI can poll take-effect.
 *
 * ⚠️ The hub-side tool (update_node_config + config snapshot) is not deployed
 * yet (工程马 WIP, contract under 通信牛 co-review). Until it lands, these calls
 * hit the ASSUMED contract paths below and, when the hub 404/501s or errors,
 * fall back to a clearly-flagged mock (`mock: true`) so the panel can be built
 * and reviewed. Confirm HUB_*_PATH against the finalized contract before
 * integration — they are isolated here so that's a one-line change.
 */

const HUB_GET_PATH = (nodeId: string) => `/api/nodes/${encodeURIComponent(nodeId)}/config`;
const HUB_UPDATE_PATH = '/api/nodes/config'; // POST → hub MCP update_node_config
const HUB_APPLY_STATUS_PATH = (applyId: string) => `/api/nodes/config/apply/${encodeURIComponent(applyId)}`;

// Editable flags whitelist (contract per 通信龙). Anything outside this set is
// dropped before forwarding, so the UI can't smuggle unexpected keys to the hub.
const EDITABLE_FLAGS = [
  'permissionMode',
  'dangerouslySkipPermissions',
  'teammateMode',
  'maxTurns',
  'budget',
  'timeout',
] as const;

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') || '').includes('application/json');
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);

  // F3 apply-lifecycle poll: GET ?apply_id=… returns the take-effect status of
  // a prior POST (status: pending | applied | rejected). When the hub tool
  // isn't deployed it mock-returns `pending` — the client drives its own mock
  // progression in that case, so it never actually polls this path.
  const applyId = searchParams.get('apply_id');
  if (applyId) {
    try {
      const res = await hubFetch(HUB_APPLY_STATUS_PATH(applyId));
      if (res.ok && isJson(res)) return Response.json(await res.json());
      return Response.json({ ok: true, mock: true, applyId, status: 'pending' });
    } catch (e: unknown) {
      return Response.json({
        ok: true,
        mock: true,
        applyId,
        status: 'pending',
        _hubError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const nodeId = searchParams.get('node_id') || searchParams.get('alias') || '';
  if (!nodeId) return Response.json({ error: 'node_id or alias required' }, { status: 400 });

  try {
    const res = await hubFetch(HUB_GET_PATH(nodeId));
    if (res.ok && isJson(res)) return Response.json(await res.json());
    // backend not ready (404/501/non-JSON) → flagged empty snapshot so the
    // panel can initialise its form and develop the save flow.
    return Response.json({ ok: true, mock: true, node_id: nodeId, model: null, flags: {} });
  } catch (e: unknown) {
    return Response.json({
      ok: true,
      mock: true,
      node_id: nodeId,
      model: null,
      flags: {},
      _hubError: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: { node_id?: string; alias?: string; model?: unknown; flags?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const nodeId = body.node_id || body.alias;
  if (!nodeId) return Response.json({ error: 'node_id or alias required' }, { status: 400 });

  // Whitelist flags — silently drop anything not in the editable contract.
  const flags: Record<string, unknown> = {};
  if (body.flags && typeof body.flags === 'object') {
    for (const k of EDITABLE_FLAGS) {
      if (k in body.flags && body.flags[k] !== undefined) flags[k] = body.flags[k];
    }
  }
  const payload = {
    node_id: nodeId,
    ...(body.model !== undefined ? { model: body.model } : {}),
    flags,
  };

  try {
    const res = await hubFetch(HUB_UPDATE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok && isJson(res)) return Response.json(await res.json());
    if (res.status === 404 || res.status === 501) {
      // hub tool not deployed yet — flagged mock so the Save + apply flow can
      // develop. `status: pending` + `applyId` let the client run its lifecycle.
      return Response.json({ ok: true, mock: true, applied: false, status: 'pending', applyId: `mock-${nodeId}`, node_id: nodeId, echo: payload });
    }
    return Response.json({ ok: false, error: `hub ${res.status}`, status: res.status }, { status: 502 });
  } catch (e: unknown) {
    return Response.json({
      ok: true,
      mock: true,
      applied: false,
      status: 'pending',
      applyId: `mock-${nodeId}`,
      node_id: nodeId,
      echo: payload,
      _hubError: e instanceof Error ? e.message : String(e),
    });
  }
}
