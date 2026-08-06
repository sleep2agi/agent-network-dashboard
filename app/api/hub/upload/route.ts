import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

// ── Hub upload-limit mirror ─────────────────────────────────────
//
// Mirror of the hub's own `MAX_UPLOAD_BYTES` / `MAX_REQUEST_CONTENT_LENGTH`
// (agent-network:server/src/uploads.ts). Duplicated here for one reason:
// without a client-side pre-check, an oversize upload:
//   1. dashboard opens streaming request → hub
//   2. hub 413s + FINs mid-body
//   3. undici's streaming request throws "fetch failed"
//   4. dashboard 502s a request that should 413 — wrong error layer,
//      user sees "服务端不可达" for a "your file is too big" problem
// Pre-check on this side so 413 fires before we open the hub socket.
//
// 🔴 DRIFT WARNING — two hard-coded constants for the same rule =
// silent drift risk. If this side stays at 12 MiB and hub raises to
// 20 MiB, users see "12 MB 上限" from the dashboard even though hub
// would accept.
//
// Mitigations shipped with this PR are PARTIAL — read carefully:
//   1. Comment above names the exact hub source (uploads.ts) so a
//      human editor knows both must change together.
//   2. Runtime drift-detect: any hub 413 response includes
//      `limit_bytes` — if it disagrees with HUB_MAX_UPLOAD_BYTES,
//      the proxy loudly `console.error`s so ops sees it in the
//      dashboard server log.
//
// 🔴 BLIND SPOT (通信龙 #45 pre-review): the runtime detect above is
// one-directional.
//   • L_dashboard > L_hub → dashboard passes, hub 413s with limit_bytes
//     → DETECTED ✓
//   • L_dashboard < L_hub → dashboard rejects client-side, hub is
//     never contacted → NEVER DETECTED 🔴
//   The second case is the more damaging one: legitimate files get
//   rejected with the wrong cap message, no log line, no signal.
//
// Real fix — sleep2agi/agent-network#496 — hub exposes MAX_UPLOAD_BYTES
// via /health; dashboard reads it at startup, caches, fallback to
// this hard-coded value if fetch fails (with a LOUD LOG when the
// fallback is in use — silent fetch failure re-introduces two
// constants). Blocked on hub-side PR.
const HUB_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const HUB_MAX_REQUEST_CONTENT_LENGTH = HUB_MAX_UPLOAD_BYTES + 1024 * 1024;

// #492 upload half — dashboard → hub `/api/upload` proxy.
//
// Multipart body forwards verbatim; Bearer added server-side. Token
// never leaves the dashboard host (no URL, no browser history, no
// client access to the header).
//
// Hub error surface (server/src/server.ts:1484+):
//   401 auth                       missing/expired Bearer
//   411 length_required            no Content-Length
//   400 bad_content_length | missing_file | multipart_parse_failed
//   413 payload_too_large          > 12 MiB (stage 1: header; stage 2: parsed size)
//   415 unsupported_media_type     not multipart/form-data
//   429 rate_limited (60/hour)     retry_after_ms + Retry-After header
//   500 write_failed | internal_*
//
// Each mapped to a plain-Chinese `message` the client can render.

interface HubUploadOk {
  ok: true;
  file_id: string;
  path?: string;
  url?: string;
  size?: number;
  mime?: string;
}

interface HubUploadErr {
  ok?: false;
  error?: string;
  message?: string;
  retry_after_ms?: number;
  limit_bytes?: number;
  observed_bytes?: number;
}

function userMessage(status: number, body: HubUploadErr): string {
  const raw = body.message || body.error || `HTTP ${status}`;
  switch (body.error) {
    case 'rate_limited': {
      const secs = body.retry_after_ms ? Math.ceil(body.retry_after_ms / 1000) : null;
      return secs
        ? `上传太频繁 — 请 ${secs} 秒后再试（60/小时限流）`
        : '上传太频繁 — 请稍后再试（60/小时限流）';
    }
    case 'payload_too_large': {
      const mib = body.limit_bytes ? Math.floor(body.limit_bytes / 1024 / 1024) : 12;
      return `文件超过 ${mib} MB 上限`;
    }
    case 'unsupported_media_type':
      return '上传格式错误（需要 multipart/form-data）';
    case 'length_required':
      return '缺少 Content-Length（浏览器通常自动带上，若持续可能是代理层去掉了）';
    case 'missing_file':
      return '请求里没找到 file 字段';
    case 'multipart_parse_failed':
      return '文件包解析失败，请重试或换一个文件';
    case 'bad_content_length':
      return '文件大小声明异常';
    case 'write_failed':
      return '服务端保存失败，请重试';
    default:
      if (status === 401) return '认证已过期，请重新登录';
      if (status >= 500) return `服务端错误 (${status})，请重试`;
      return raw;
  }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const userToken = await getV3UserToken();
  if (!userToken) {
    return Response.json(
      { ok: false, error: 'no_session', message: '无会话 token，请重新登录' },
      { status: 401 },
    );
  }

  // Content-Length — hub requires it (411 otherwise). Reject client-side
  // too so we fail fast without opening a socket to the hub.
  const contentLength = req.headers.get('content-length');
  if (!contentLength) {
    return Response.json(
      { ok: false, error: 'length_required', message: '缺少 Content-Length（前端 fetch 应自动带上）' },
      { status: 411 },
    );
  }
  const declaredBytes = Number(contentLength);
  if (!Number.isFinite(declaredBytes) || declaredBytes < 0) {
    return Response.json(
      { ok: false, error: 'bad_content_length', message: '文件大小声明异常' },
      { status: 400 },
    );
  }
  // Mirror hub stage-1 cap so we return a proper 413 instead of
  // racing the hub's early close. Without this, undici's streaming
  // request throws mid-body when the hub responds 413 + FIN, which
  // surfaces as `fetch failed` → we'd 502 a request that should 413.
  if (declaredBytes > HUB_MAX_REQUEST_CONTENT_LENGTH) {
    const mib = Math.floor(HUB_MAX_UPLOAD_BYTES / 1024 / 1024);
    return Response.json(
      {
        ok: false,
        error: 'payload_too_large',
        message: `文件超过 ${mib} MB 上限`,
        limit_bytes: HUB_MAX_UPLOAD_BYTES,
      },
      { status: 413 },
    );
  }

  const contentType = req.headers.get('content-type') || '';
  if (!/^multipart\/form-data/i.test(contentType)) {
    return Response.json(
      { ok: false, error: 'unsupported_media_type', message: '上传格式错误（需要 multipart/form-data）' },
      { status: 415 },
    );
  }

  let hubRes: Response;
  try {
    hubRes = await fetch(`${HUB_URL}/api/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        // Preserve the client's multipart Content-Type (contains the
        // boundary — the hub parses on this exact string).
        'content-type': contentType,
        'content-length': contentLength,
      },
      // Stream the body straight through. `duplex: 'half'` is the
      // undici requirement for streaming a request body (Node 18.16+).
      body: req.body,
      // @ts-expect-error — `duplex` not in the stock RequestInit type.
      duplex: 'half',
    });
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

  // Preserve rate-limit headers on 429 — client's countdown wants
  // them, and browser retry heuristics respect Retry-After.
  const outHeaders: Record<string, string> = {};
  if (hubRes.status === 429) {
    const retryAfter = hubRes.headers.get('retry-after');
    if (retryAfter) outHeaders['retry-after'] = retryAfter;
    for (const h of ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
      const v = hubRes.headers.get(h);
      if (v) outHeaders[h] = v;
    }
  }

  let hubBody: HubUploadOk | HubUploadErr;
  try {
    hubBody = (await hubRes.json()) as HubUploadOk | HubUploadErr;
  } catch {
    return Response.json(
      { ok: false, error: 'hub_bad_response', message: `服务端返回异常 (${hubRes.status})` },
      { status: 502 },
    );
  }

  if (!hubRes.ok || !('ok' in hubBody && hubBody.ok)) {
    const err = hubBody as HubUploadErr;
    // Drift-detect: if hub echoed a limit_bytes that disagrees with
    // our client-side mirror, surface it to ops. Fires only when a
    // request slips past our pre-check (declared Content-Length
    // lied, or hub's parsed-size stage 2 triggers on a
    // pre-check-passing envelope). Rare but loud.
    if (
      hubRes.status === 413 &&
      typeof err.limit_bytes === 'number' &&
      err.limit_bytes !== HUB_MAX_UPLOAD_BYTES
    ) {
      console.error(
        `[upload-proxy] hub upload cap drift — dashboard mirror=${HUB_MAX_UPLOAD_BYTES}, hub reports=${err.limit_bytes}. ` +
          `Update HUB_MAX_UPLOAD_BYTES in app/api/hub/upload/route.ts to match hub's server/src/uploads.ts:MAX_UPLOAD_BYTES.`,
      );
    }
    return Response.json(
      {
        ok: false,
        error: err.error ?? `hub_${hubRes.status}`,
        message: userMessage(hubRes.status, err),
        // Raw hub payload preserved for operator log grep; client
        // renders `message`, not `detail`.
        detail: err,
      },
      { status: hubRes.status, headers: outHeaders },
    );
  }

  // Success — strip hub-local `path` per #222 cross-host safety
  // (it's the hub-machine filesystem path, meaningless off-host and
  // tempts callers to use it as if portable).
  const ok = hubBody as HubUploadOk;
  return Response.json({
    ok: true,
    file_id: ok.file_id,
    mime: ok.mime,
    size: ok.size,
    // Same-origin dashboard URL for downstream fetches — routes
    // through the download proxy so no token is exposed. Callers
    // should prefer `file_id` (canonical) over this convenience.
    url: `/api/hub/files/${encodeURIComponent(ok.file_id)}`,
  });
}

// Legacy GET was a local-machine image-preview stub. Attachments
// now live on the hub; download via GET /api/hub/files/<file_id>.
// Return 410 so any stale bookmark learns to switch.
export async function GET() {
  return Response.json(
    {
      ok: false,
      error: 'gone',
      message:
        'legacy image-preview URL is no longer served — download via GET /api/hub/files/<file_id>',
    },
    { status: 410 },
  );
}
