import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Per-node config proxy for #1316:
 *   GET  ?node_id=... -> hub REST config snapshot (node-side applied fact)
 *   POST              -> update_node_config MCP doorbell
 *
 * get_config_update and ack_config_update are node-side MCP tools: the node
 * calls them after the dashboard doorbell. The dashboard verifies success by
 * polling the snapshot until config_revision advances. There is no mock success
 * fallback.
 */

const MCP_TOOL_UPDATE = 'update_node_config';

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

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
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

async function getMaskedConfigSnapshot(nodeId: string, networkId?: string | null) {
  const params = new URLSearchParams();
  if (networkId) params.set('network_id', networkId);
  const res = await hubFetch(`/api/nodes/${encodeURIComponent(nodeId)}/config${params.toString() ? `?${params}` : ''}`, {
    headers: { Accept: 'application/json' },
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {
      response: Response.json(
        { ok: false, node_id: nodeId, error: 'node_config_snapshot_unavailable' },
        { status: 502 },
      ),
    };
  }
  const data = normalizeResult(await res.json().catch(() => ({})));
  if (data.ok !== true) {
    return {
      response: Response.json(
        { ...data, ok: false, node_id: nodeId, error: String(data.error || 'node_config_snapshot_failed') },
        { status: res.ok ? 502 : res.status },
      ),
    };
  }
  return { result: data };
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
  const nodeId = searchParams.get('node_id') || searchParams.get('alias') || '';
  if (!nodeId) return Response.json({ error: 'node_id or alias required' }, { status: 400 });
  try {
    const out = await getMaskedConfigSnapshot(nodeId, networkId);
    if (out.response) return out.response;
    const result = exposeConfigSnapshot(out.result);
    const currentRevision = numberField(result, 'config_revision') ?? 0;
    const baseRevision = numberField(Object.fromEntries(searchParams), 'base_revision');
    if (baseRevision !== undefined) {
      return Response.json({
        ok: true,
        node_id: nodeId,
        ...result,
        status: currentRevision > baseRevision ? 'applied' : 'pending',
        base_revision: baseRevision,
      });
    }
    return Response.json({ ok: true, node_id: nodeId, ...result });
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
  if (typeof body.base_revision !== 'number') {
    return Response.json({ error: 'base_revision (number) required' }, { status: 400 });
  }

  const patch = buildPatch(body);
  if (patch.model === undefined && !patch.flags && !patch.channels) {
    return Response.json({ ok: false, error: 'empty_patch' }, { status: 400 });
  }

  const networkId = body.network_id || (await resolveDefaultNetworkId());
  const args = {
    node_id: nodeId,
    base_revision: body.base_revision,
    patch,
    ...(networkId ? { network_id: networkId } : {}),
  };

  try {
    const out = await callConfigTool(MCP_TOOL_UPDATE, args);
    if (out.response) return out.response;
    const result = out.result;
    return Response.json({ ok: true, node_id: nodeId, base_revision: body.base_revision, status: 'pending', ...exposeConfigSnapshot(result) });
  } catch (e: unknown) {
    return Response.json({ ok: false, node_id: nodeId, error: errText(e) }, { status: 502 });
  }
}
