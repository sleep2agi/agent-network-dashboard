import { hubFetch } from './hub';

/**
 * Shared hub MCP (JSON-RPC tools/call) helpers for the node-config /
 * node-lifecycle / node-create proxies. The hub MCP endpoint answers with
 * either application/json or text/event-stream; in both cases the tool payload
 * is JSON in result.content[0].text. Mirrors the shape #260/#262 PR C established.
 */

export const HUB_MCP_PATH = '/mcp';
export const MCP_PROTOCOL_VERSION = '2025-03-26';

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') || '').includes('application/json');
}

/**
 * Resolve the user's default network_id from the hub profile, forwarding the
 * browser V3 token via hubFetch. Needed because a V3 user token often has a
 * null current_network, and node MCP tools require an explicit network_id
 * (else they 'permission_denied: network_id required'). Mirrors the resolution
 * in /api/auth/v3 and the PR C node-config fix (02dde66). Returns null if the
 * profile can't be read; callers should surface that rather than silently fail.
 */
export async function resolveDefaultNetworkId(): Promise<string | null> {
  try {
    const meRes = await hubFetch('/api/auth/me');
    if (meRes.ok && (meRes.headers.get('content-type') || '').includes('application/json')) {
      const me = (await meRes.json()) as {
        current_network?: { network_id?: string };
        networks?: Array<{ network_id?: string }>;
      };
      return me.current_network?.network_id || me.networks?.[0]?.network_id || null;
    }
  } catch {
    /* fall through → null */
  }
  return null;
}

export function mcpEnvelope(tool: string, args: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  };
}

/**
 * POST a tools/call to the hub MCP endpoint, forwarding the browser V3 token
 * via hubFetch. Returns the raw Response so callers can branch on status.
 */
export function callMcp(tool: string, args: Record<string, unknown>): Promise<Response> {
  return hubFetch(HUB_MCP_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    },
    body: JSON.stringify(mcpEnvelope(tool, args)),
  });
}

/**
 * Parse an MCP tools/call response (json or SSE) → the JSON tool payload.
 * Throws on MCP-level error or malformed envelope.
 */
export async function parseMcpEnvelope(res: Response): Promise<unknown> {
  let envelope: unknown;
  if (isJson(res)) {
    envelope = await res.json();
  } else {
    const raw = await res.text();
    const dataLines = raw
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trim())
      .filter(Boolean);
    const last = dataLines[dataLines.length - 1];
    if (!last) throw new Error('empty MCP SSE response');
    envelope = JSON.parse(last);
  }
  const env = envelope as { error?: { message?: string }; result?: { content?: Array<{ text?: string }> } };
  if (env.error) throw new Error(env.error.message || 'MCP error');
  const text = env.result?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('MCP result missing content text');
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
  }
}
