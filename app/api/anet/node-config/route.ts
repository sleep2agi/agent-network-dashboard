import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Per-node config proxy for #1316. This route talks to the real hub MCP tools:
 *   GET  ?node_id=...  -> get_config_update snapshot/status
 *   GET  ?apply_id=... -> get_config_update apply status, then ack when applied
 *   POST               -> update_node_config
 *
 * A save is only "applied" after get_config_update reports applied and
 * ack_config_update succeeds. There is no mock success fallback.
 */

const MCP_TOOL_UPDATE = 'update_node_config';
const MCP_TOOL_GET_UPDATE = 'get_config_update';
const MCP_TOOL_ACK_UPDATE = 'ack_config_update';

const EDITABLE_FLAGS = [
  'permissionMode',
  'dangerouslySkipPermissions',
  'maxTurns',
  'budget',
  'timeout',
] as const;

const EDITABLE_CHANNELS = ['telegram', 'feishu', 'commhub'] as const;

type ConfigBody = {
  node_id?: string;
  alias?: string;
  base_revision?: number;
  network_id?: string;
  model?: unknown;
  flags?: Record<string, unknown>;
  channels?: unknown;
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function normalizeResult(result: unknown): Record<string, unknown> {
  return result && typeof result === 'object' ? result as Record<string, unknown> : {};
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function exposeConfigSnapshot(result: Record<string, unknown>) {
  const config = normalizeResult(result.config);
  return {
    ...result,
    ...(result.model === undefined && config.model !== undefined ? { model: config.model } : {}),
    ...(result.flags === undefined && config.flags !== undefined ? { flags: config.flags } : {}),
    ...(result.channels === undefined && config.channels !== undefined ? { channels: config.channels } : {}),
    ...(result.config_revision === undefined && config.config_revision !== undefined ? { config_revision: config.config_revision } : {}),
    ...(result.config_update_capable === undefined && config.config_update_capable !== undefined ? { config_update_capable: config.config_update_capable } : {}),
  };
}

async function callConfigTool(tool: string, args: Record<string, unknown>) {
  const res = await callMcp(tool, args);
  if (res.status === 404 || res.status === 501) {
    return {
      response: Response.json(
        { ok: false, unconfirmed: true, error: `hub tool '${tool}' not available (${res.status})` },
        { status: 501 },
      ),
    };
  }
  if (!res.ok) {
    return { response: Response.json({ ok: false, error: `hub ${res.status}`, status: res.status }, { status: 502 }) };
  }
  const result = normalizeResult(await parseMcpEnvelope(res));
  if (result.ok === false) {
    return { response: Response.json({ ...result, ok: false, error: String(result.error || `${tool}_failed`) }, { status: 502 }) };
  }
  return { result };
}

async function ackAppliedConfig(result: Record<string, unknown>, networkId?: string | null) {
  const updateId = stringField(result, ['applyId', 'apply_id', 'updateId', 'update_id', 'config_update_id']);
  const nodeId = stringField(result, ['node_id', 'nodeId']);
  const args: Record<string, unknown> = {
    ...(updateId ? { update_id: updateId, apply_id: updateId } : {}),
    ...(nodeId ? { node_id: nodeId } : {}),
    ...(networkId ? { network_id: networkId } : {}),
  };
  if (!Object.keys(args).some(k => k === 'update_id' || k === 'apply_id' || k === 'node_id')) {
    return { response: Response.json({ ok: false, error: 'config_update_missing_ack_target' }, { status: 502 }) };
  }
  return callConfigTool(MCP_TOOL_ACK_UPDATE, args);
}

function buildPatch(body: ConfigBody) {
  const patch: { model?: unknown; flags?: Record<string, unknown>; channels?: string[] } = {};
  if (body.model !== undefined) patch.model = body.model;
  if (body.flags && typeof body.flags === 'object') {
    const flags: Record<string, unknown> = {};
    for (const k of EDITABLE_FLAGS) {
      if (k in body.flags && body.flags[k] !== undefined) flags[k] = body.flags[k];
    }
    if (Object.keys(flags).length > 0) patch.flags = flags;
  }
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
  return patch;
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || (await resolveDefaultNetworkId());
  const applyId = searchParams.get('apply_id');
  if (applyId) {
    try {
      const out = await callConfigTool(MCP_TOOL_GET_UPDATE, { apply_id: applyId, update_id: applyId, ...(networkId ? { network_id: networkId } : {}) });
      if (out.response) return out.response;
      const result = out.result;
      if (result.status === 'applied') {
        const ack = await ackAppliedConfig({ ...result, applyId }, networkId);
        if (ack.response) return ack.response;
        return Response.json({ ok: true, ...exposeConfigSnapshot(result), applyId, ack: ack.result || true });
      }
      return Response.json({ ok: true, ...exposeConfigSnapshot(result), applyId });
    } catch (e: unknown) {
      return Response.json({ ok: false, applyId, error: errText(e) }, { status: 502 });
    }
  }

  const nodeId = searchParams.get('node_id') || searchParams.get('alias') || '';
  if (!nodeId) return Response.json({ error: 'node_id or alias required' }, { status: 400 });
  try {
    const out = await callConfigTool(MCP_TOOL_GET_UPDATE, { node_id: nodeId, ...(networkId ? { network_id: networkId } : {}) });
    if (out.response) return out.response;
    return Response.json({ ok: true, node_id: nodeId, ...exposeConfigSnapshot(out.result) });
  } catch (e: unknown) {
    return Response.json({ ok: false, node_id: nodeId, error: errText(e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: ConfigBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const nodeId = body.node_id || body.alias;
  if (!nodeId) return Response.json({ error: 'node_id or alias required' }, { status: 400 });

  const patch = buildPatch(body);
  if (patch.model === undefined && !patch.flags && !patch.channels) {
    return Response.json({ ok: false, error: 'empty_patch' }, { status: 400 });
  }

  const networkId = body.network_id || (await resolveDefaultNetworkId());
  const args = {
    node_id: nodeId,
    ...(typeof body.base_revision === 'number' ? { base_revision: body.base_revision } : {}),
    patch,
    ...(networkId ? { network_id: networkId } : {}),
  };

  try {
    const out = await callConfigTool(MCP_TOOL_UPDATE, args);
    if (out.response) return out.response;
    const result = out.result;
    const applyId = stringField(result, ['applyId', 'apply_id', 'updateId', 'update_id', 'config_update_id']);
    if (result.status === 'applied') {
      const ack = await ackAppliedConfig({ ...result, node_id: nodeId, ...(applyId ? { applyId } : {}) }, networkId);
      if (ack.response) return ack.response;
      return Response.json({ ok: true, ...exposeConfigSnapshot(result), ...(applyId ? { applyId } : {}), ack: ack.result || true });
    }
    if (!applyId) {
      return Response.json(
        {
          ok: false,
          error: 'config_update_missing_apply_id',
          detail: 'update_node_config returned before node-side apply could be confirmed; use anet node on the target machine until the hub returns an apply_id/update_id.',
          result,
        },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, ...exposeConfigSnapshot(result), applyId });
  } catch (e: unknown) {
    return Response.json({ ok: false, node_id: nodeId, error: errText(e) }, { status: 502 });
  }
}
