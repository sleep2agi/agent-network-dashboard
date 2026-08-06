import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

/**
 * `ref` may be a node_id, a node_name, or an alias — hub resolves.
 * We validate it as a URL-safe path segment before composition: no `/`,
 * no control chars, reasonable length. The hub does the real matching.
 */
const REF_REGEX = /^[^\x00-\x1f/]{1,120}$/;

/**
 * PUT /api/hub/nodes/:ref/attrs — dashboard-side proxy to hub's
 * per-node display-attributes endpoint (added by hub PR #497).
 *
 * Contract mirror (see server/src/server.ts:2147 and node-attrs-validate.ts):
 *
 *   Request body:
 *     { base_attrs_revision: <int >= 0>,
 *       display_name?: string | null,   // 120 char cap, wrong type = 400
 *       team?:         string | null,   // 120 char cap, wrong type = 400
 *       tags?:         string[] }       // per-item drop, junk never blocks
 *
 *   Success (200): { ok: true, node_id, alias, display_name, team,
 *                    tags, attrs_revision }
 *
 *   Error surface:
 *     400 invalid JSON | base_attrs_revision required
 *         | invalid_display_name (reason field)
 *         | invalid_team         (reason field)
 *     403 permission_denied
 *     404 node not found
 *     409 attrs_revision_conflict (current_attrs_revision field)
 *
 * 🔴 EXPLICIT NON-GOAL — this route MUST NOT accept an `alias` field.
 * The hub endpoint refuses it structurally (only display_name / team
 * / tags are consumed) but a client-side note stops well-meaning
 * future edits from adding it here. Alias changes are routing-key
 * changes and go through the rename 2PC endpoint.
 */

interface HubAttrsOk {
  ok: true;
  node_id: string;
  alias: string;
  display_name: string | null;
  team: string | null;
  tags: string[];
  attrs_revision: number;
}

interface HubAttrsErr {
  ok?: false;
  error?: string;
  reason?: string;
  current_attrs_revision?: number;
  message?: string;
}

/** Human-friendly Chinese message per hub error code. Every one asks:
 *  "which layer will the user check first?" — see the two-question rule
 *  from #46 / feedback_error_msg_points_at_wrong_layer.md. */
function userMessage(status: number, body: HubAttrsErr): string {
  switch (body.error) {
    case 'attrs_revision_conflict':
      return '该节点在你编辑期间被别人改动了，请重新加载最新值后再修改';
    case 'invalid_display_name':
      return body.reason
        ? `显示名不合法：${body.reason}`
        : '显示名不合法';
    case 'invalid_team':
      return body.reason ? `团队字段不合法：${body.reason}` : '团队字段不合法';
    case 'permission_denied':
      return '权限不足 — 你不是该网络的管理员';
    case 'node not found':
      return '节点不存在或已被删除';
    default:
      if (typeof body.error === 'string' && /base_attrs_revision/i.test(body.error)) {
        return 'base_attrs_revision 缺失或格式错误（这是客户端 bug）';
      }
      if (status === 401) return '认证已过期，请重新登录';
      if (status >= 500) return `服务端错误 (${status})，请重试`;
      return body.message || body.error || `HTTP ${status}`;
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { ref } = await params;
  if (!ref || !REF_REGEX.test(ref)) {
    return Response.json({ ok: false, error: 'invalid_ref' }, { status: 400 });
  }

  const userToken = await getV3UserToken();
  if (!userToken) {
    return Response.json(
      { ok: false, error: 'no_session', message: '无会话 token，请重新登录' },
      { status: 401 },
    );
  }

  let clientBody: Record<string, unknown>;
  try {
    clientBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { ok: false, error: 'invalid_json', message: '请求体不是合法 JSON' },
      { status: 400 },
    );
  }

  // 🔴 Whitelist — forward ONLY the four fields the hub endpoint
  // accepts. Anything else the client tried to send (alias, node_id,
  // arbitrary payload) is DROPPED at this boundary so a future
  // client-side bug can never accidentally pipe alias mutations
  // through this proxy.
  const forwardBody: Record<string, unknown> = {};
  if ('base_attrs_revision' in clientBody) forwardBody.base_attrs_revision = clientBody.base_attrs_revision;
  if ('display_name' in clientBody) forwardBody.display_name = clientBody.display_name;
  if ('team' in clientBody) forwardBody.team = clientBody.team;
  if ('tags' in clientBody) forwardBody.tags = clientBody.tags;

  let hubRes: Response;
  try {
    hubRes = await fetch(
      `${HUB_URL}/api/nodes/${encodeURIComponent(ref)}/attrs`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(forwardBody),
      },
    );
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        error: 'hub_unreachable',
        message: '服务端不可达，请稍后重试',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  let hubBody: HubAttrsOk | HubAttrsErr;
  try {
    hubBody = (await hubRes.json()) as HubAttrsOk | HubAttrsErr;
  } catch {
    return Response.json(
      { ok: false, error: 'hub_bad_response', message: `服务端返回异常 (${hubRes.status})` },
      { status: 502 },
    );
  }

  if (!hubRes.ok || !('ok' in hubBody && hubBody.ok)) {
    const err = hubBody as HubAttrsErr;
    return Response.json(
      {
        ok: false,
        error: err.error ?? `hub_${hubRes.status}`,
        message: userMessage(hubRes.status, err),
        // 409 carries the fresh revision the client needs to re-read.
        // Forward as a top-level field so the client can PATCH its
        // local state without digging into `detail`.
        ...(typeof err.current_attrs_revision === 'number'
          ? { current_attrs_revision: err.current_attrs_revision }
          : {}),
        // Preserve raw hub payload for operator log grep; client
        // renders `message`, not `detail`.
        detail: err,
      },
      { status: hubRes.status },
    );
  }

  // Success — passthrough verbatim. Alias comes back from hub so the
  // client can confirm it's the node they expected (defense against
  // ref collision: if the user typed an alias and got back a different
  // node_id, they'd notice).
  const ok = hubBody as HubAttrsOk;
  return Response.json({
    ok: true,
    node_id: ok.node_id,
    alias: ok.alias,
    display_name: ok.display_name,
    team: ok.team,
    tags: ok.tags,
    attrs_revision: ok.attrs_revision,
  });
}
