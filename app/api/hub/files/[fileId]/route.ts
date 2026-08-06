import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

/**
 * File ID shape: mirrors server/src/uploads.ts FILE_ID_REGEX exactly.
 * Token-exact check before any URL composition — refuse
 * `../../etc/passwd` before it can reach the hub.
 */
const FILE_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Header allowlist for the pass-through. We deliberately do NOT forward
 * everything from the hub response — the browser must NOT see anything
 * that could leak the internal request path or the Bearer token.
 *
 * `content-disposition` and `x-content-type-options` are intentionally
 * NOT in this list — they're stamped explicitly below (see JSDoc on
 * the response builder). Passing them through the allowlist would
 * silently defer to hub for the security-critical values, which is
 * exactly the regression path 通信龙 flagged in the #47 review.
 */
const HEADER_PASSTHROUGH = [
  'content-type',
  'content-length',
] as const;

// ── #492 preview half: safe-inline-type detection ──────────────
//
// 🔴 STRUCTURAL SAFETY (通信龙 #46 review of the inline design):
//   This proxy NEVER returns an inline response, regardless of the
//   file's real type. `Content-Disposition: attachment` + `nosniff`
//   stay stamped on every download, so no dashboard-origin URL can
//   ever serve user-uploaded content as a rendered page — that entire
//   XSS class is structurally impossible, not defended-by-whitelist.
//
// What we DO expose: a `X-Verified-Type` header carrying the true MIME
// as detected by magic bytes. The client uses this header to decide:
//   1. Fetch the bytes (browser downloads — no navigation)
//   2. `new Blob([bytes], {type: xVerifiedType})`
//   3. `URL.createObjectURL(blob)` → `<img>` / `<video>` src
//
// The blob URL is same-origin *to the browser's blob: scheme*, isolated
// from the dashboard origin — a bug in whitelist can degrade UX (image
// won't render) but can never become a cross-origin script vector.
//
// Detection rule: EXACT MIME match by per-format magic bytes at each
// format's actual offset. No prefix matching (`image/*` would let SVG
// in). No trust of upload-time mime/filename (both untrusted).
type SafeMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'video/mp4'
  | 'video/webm';

/**
 * Peek magic bytes and return the safe MIME if the file matches one
 * of our whitelisted formats.
 *
 * Per-format offset rules (not naive first-N compare — 通信龙 review):
 *   - PNG:  offset 0, `89 50 4E 47 0D 0A 1A 0A`
 *   - JPEG: offset 0, `FF D8 FF`
 *   - GIF:  offset 0, `47 49 46 38 (37|39) 61` ("GIF87a" / "GIF89a")
 *   - WebP: offset 0 `52 49 46 46` ("RIFF") + offset 8 `57 45 42 50` ("WEBP")
 *   - MP4:  offset 4 `66 74 79 70` ("ftyp") — MP4/M4V/QT ISO BMFF box
 *   - WebM: offset 0 `1A 45 DF A3` (EBML)
 *
 * Returns null for anything else (SVG, HTML, empty, corrupted, unknown).
 */
function detectSafeMime(head: Uint8Array): SafeMime | null {
  const b = head;
  if (b.length < 4) return null;

  // PNG
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
    b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A
  ) return 'image/png';

  // JPEG (FF D8 FF — final byte is FF E0 / FF E1 / FF DB variants; the FF prefix
  // is enough to distinguish. Reject if not exactly the three-byte JPEG marker.)
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';

  // GIF — "GIF87a" or "GIF89a"
  if (
    b.length >= 6 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
  ) return 'image/gif';

  // WebP — "RIFF????WEBP"
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp';

  // WebM (EBML header) — 1A 45 DF A3
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) {
    return 'video/webm';
  }

  // MP4 (ISO BMFF `ftyp` box at offset 4) — the first 4 bytes are a
  // big-endian box size we don't need to validate; the "ftyp" marker
  // is what we key on.
  if (
    b.length >= 8 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
  ) return 'video/mp4';

  return null;
}

/**
 * #492 — file download proxy: browser fetches `/api/hub/files/<file_id>`,
 * this proxy attaches the browser session's V3 user token as
 * `Authorization: Bearer <utok>` and forwards the response.
 *
 * Why proxy vs direct-browser-fetch to `/api/files/<id>`:
 *
 *   - Hub `/api/files/<id>` requires `Authorization: Bearer <token>`.
 *     If the client tried to fetch it directly, the browser would need
 *     the token in-page. Putting the token in a URL query string
 *     leaks it into browser history + server access logs + Referer
 *     headers on any follow-up navigation. Attaching it as an
 *     `Authorization` header from the client requires the client to
 *     hold the token, which we already refused to do (dashboard V3
 *     tokens are HttpOnly-cookie-only per `dashboard-auth.ts`).
 *   - By proxying, the token stays server-side. The client sends
 *     nothing but its own session cookie; the server adds the Bearer.
 *
 * Buffering vs streaming: this half of the proxy USED to stream (O(1)
 * memory). The preview half needs to detect magic bytes before
 * headers can be sent, so we now buffer the full body. Acceptable
 * because hub caps uploads at 12 MiB; worst case is 12 MiB *
 * concurrent-preview-requests per node process. If that becomes
 * memory pressure the fix is to tee the ReadableStream and inspect
 * the first chunk without buffering the rest — deferred until
 * evidence shows it's worth the complexity.
 *
 * Content-Disposition + X-Content-Type-Options come from the hub
 * response and are passed through verbatim — the hub already stamps
 * `attachment` disposition + `nosniff` on downloads (issue #221),
 * meaning the browser will download-not-render even if the file
 * happens to be text/html. Do not add or alter those headers here.
 *
 * The response ALWAYS carries `attachment` disposition — the client
 * reads `X-Verified-Type` and constructs a blob URL if it wants to
 * inline the content. See `detectSafeMime` above for the security
 * reasoning.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { fileId } = await params;
  if (!fileId || !FILE_ID_REGEX.test(fileId)) {
    return Response.json({ error: 'invalid file_id' }, { status: 400 });
  }

  const userToken = await getV3UserToken();
  if (!userToken) {
    return Response.json({ error: 'no session token' }, { status: 401 });
  }

  const url = `${HUB_URL}/api/files/${encodeURIComponent(fileId)}`;
  let hubRes: Response;
  try {
    hubRes = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${userToken}` },
      cache: 'no-store',
    });
  } catch (e: unknown) {
    return Response.json(
      { error: 'hub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  // Forward hub's status verbatim so a 404 (unknown file_id) surfaces
  // as a 404 the client can distinguish from a proxy error.
  if (!hubRes.ok) {
    const ct = hubRes.headers.get('content-type') || '';
    if (ct.includes('json')) {
      try {
        const errBody = await hubRes.json();
        return Response.json(errBody, { status: hubRes.status });
      } catch {
        // fall through to generic
      }
    }
    return new Response(null, { status: hubRes.status });
  }

  // Buffer full body — see JSDoc for the memory rationale.
  const bytes = new Uint8Array(await hubRes.arrayBuffer());
  const verifiedType = detectSafeMime(bytes.subarray(0, 32));

  // Build the response header set — only the allowlisted ones. This
  // strips anything the hub might leak (Set-Cookie, X-Hub-*, etc.).
  const outHeaders = new Headers();
  for (const key of HEADER_PASSTHROUGH) {
    const value = hubRes.headers.get(key);
    if (value !== null) outHeaders.set(key, value);
  }
  // Content-Length may not survive if we re-emit the body; set from
  // our own buffer length to be authoritative.
  outHeaders.set('content-length', String(bytes.length));

  // Defense-in-depth: always stamp nosniff on downloads even if the
  // hub didn't (it does today per #221, but pinning here means a hub
  // regression can't retroactively make the browser sniff-execute).
  // The polyglot-PNG-HTML adversarial sample in verify.sh depends on
  // this exact header being present.
  outHeaders.set('x-content-type-options', 'nosniff');

  // 🔴 SYMMETRIC PIN with nosniff (通信龙 review of PR #47):
  //   "永不 inline" is the single load-bearing invariant of this
  //   whole design. It CANNOT depend on hub always sending
  //   `Content-Disposition: attachment`, because a hub regression =
  //   proxy regression = XSS. Pin it here explicitly.
  //
  //   Filename preservation: if hub sent `attachment; filename="..."`
  //   we keep the whole thing (users see the friendly name in their
  //   download folder). If hub returns anything else (`inline; ...`,
  //   or missing) we override to bare `attachment` with a
  //   safe file_id-based filename fallback.
  const hubDisposition = hubRes.headers.get('content-disposition') || '';
  if (/^\s*attachment\b/i.test(hubDisposition)) {
    outHeaders.set('content-disposition', hubDisposition);
  } else {
    outHeaders.set('content-disposition', `attachment; filename="${fileId}"`);
  }

  // Structural invariant: `X-Verified-Type` is INFORMATIONAL only.
  // Adding it does not change the response's disposition or
  // Content-Type. The client uses it to decide whether to construct
  // a blob URL for inline rendering (browser-owned blob: scheme,
  // isolated from the dashboard origin).
  if (verifiedType) {
    outHeaders.set('x-verified-type', verifiedType);
  }

  return new Response(bytes, {
    status: 200,
    headers: outHeaders,
  });
}
