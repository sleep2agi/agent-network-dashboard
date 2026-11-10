import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

/**
 * 节点级 Hub 工具代理（JSON-RPC `tools/call`）。
 *
 * 为什么要这个路由：节点级能力（规则文件、技能…）在 Hub 侧只以 MCP 工具暴露，
 * 浏览器不能直接带用户 token 调 Hub。这里用服务端会话里的 V3 token 转发，
 * 前端只调本路由，不接触 Hub 地址与 token。
 *
 * 与 APP 保持一致的两点（见 agent-network-app/src/api.ts 的 callHubTool）：
 *  1. 必须带 `MCP-Protocol-Version` 与 `Accept: application/json, text/event-stream`；
 *  2. Hub 可能返回 SSE（`data: {...}`）而不是 JSON，两种都要能解析。
 *
 * 安全边界：
 *  - 只允许白名单里的工具，避免这个路由变成「任意 Hub 工具调用器」；
 *  - 入参原样转发，不做路径/文件名的拼接（与 APP 的约定一致：路径由节点自己决定）。
 */
const ALLOWED = new Set([
  'read_node_rules_file',
  'write_node_rules_file',
  'get_rules_file_result',
  'list_node_skills',
  'read_node_skill',
  'tail_node_logs',
]);

/** 入参白名单（.448）：日志工具只接受这几个键，其余在边界丢弃。
 *  lines 上限 2000（与 Hub LOGS_MAX_LINES 对齐）、grep ≤200 字符、since_ts 只收数值。 */
function sanitizeArgs(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  if (tool !== 'tail_node_logs') return args;
  const out: Record<string, unknown> = {};
  for (const key of ['node_id', 'child_node_id', 'alias', 'network_id'] as const) {
    if (typeof args[key] === 'string' && args[key]) out[key] = args[key];
  }
  const n = Number(args.lines);
  out.lines = Number.isFinite(n) ? Math.max(1, Math.min(2000, Math.trunc(n))) : 500;
  if (args.level === 'info' || args.level === 'warn' || args.level === 'error') out.level = args.level;
  if (typeof args.grep === 'string' && args.grep.trim()) out.grep = args.grep.trim().slice(0, 200);
  const since = Number(args.since_ts);
  if (Number.isFinite(since) && since >= 0) out.since_ts = Math.trunc(since);
  return out;
}

function parseMcp(text: string, contentType: string): { kind: 'payload'; payload: unknown } | { kind: 'error'; error: string } {
  const tryJson = (raw: string) => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // SSE：取最后一条 data: 行（Hub 对 tools/call 可能走流式）
  const raw = contentType.includes('text/event-stream')
    ? (text.split('\n').filter(l => l.startsWith('data:')).pop() ?? '').replace(/^data:\s*/, '')
    : text;

  const msg = tryJson(raw);
  if (!msg) return { kind: 'error', error: 'Hub 返回了无法解析的响应' };
  if (msg.error) {
    const e = msg.error as { message?: string; code?: number };
    return { kind: 'error', error: e.message ?? `JSON-RPC 错误 ${e.code ?? ''}` };
  }
  const result = msg.result as { content?: Array<{ text?: string }>; structuredContent?: unknown; isError?: boolean } | undefined;
  if (result?.isError) {
    const t = result.content?.map(c => c.text).filter(Boolean).join('\n') ?? 'Hub 工具返回错误';
    return { kind: 'error', error: t };
  }
  // 工具返回可能是结构化 JSON（structuredContent）或纯文本 content
  if (result?.structuredContent !== undefined) return { kind: 'payload', payload: result.structuredContent };
  const textPayload = result?.content?.map(c => c.text).filter(Boolean).join('\n') ?? '';
  const asJson = tryJson(textPayload);
  return { kind: 'payload', payload: asJson ?? textPayload };
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  let body: { tool?: string; args?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: '请求体不是 JSON' }, { status: 400 });
  }

  const tool = typeof body.tool === 'string' ? body.tool : '';
  if (!ALLOWED.has(tool)) {
    return Response.json({ ok: false, error: `不支持的工具：${tool || '(空)'}` }, { status: 400 });
  }

  try {
    const res = await hubFetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: body.args ?? {} } }),
    });

    // 老 Hub 没有该工具时常见 404 / 501：如实转成「不支持」，不要伪装成成功
    if (res.status === 404 || res.status === 501) {
      return Response.json({ ok: false, kind: 'unsupported', error: '当前 Hub 还不支持这个工具，请先升级 Hub' }, { status: 200 });
    }
    if (!res.ok) {
      return Response.json({ ok: false, error: `Hub HTTP ${res.status}` }, { status: 502 });
    }

    const text = await res.text();
    const parsed = parseMcp(text, res.headers.get('content-type') ?? '');
    if (parsed.kind === 'error') return Response.json({ ok: false, error: parsed.error }, { status: 200 });
    return Response.json({ ok: true, payload: parsed.payload });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
