import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

/**
 * SSE proxy: forwards CommHub /events/<alias> to the browser.
 * Default alias is the current user's username (so the user receives all
 * task replies routed back to them as from_session). Pass ?alias=other to
 * subscribe to a different channel (e.g. for monitoring a specific agent).
 *
 * Earlier this was hard-coded to /events/Dashboard but server-side replies
 * push to from_session (the original sender's alias), not "Dashboard", so
 * the chat panel never got real-time updates and had to rely on polling.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const userToken = await getV3UserToken();
  const headers: Record<string, string> = {};
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

  // Resolve the SSE channel name AND network id. `?alias=` and `?network_id=`
  // overrides win; otherwise both default from /api/auth/me (single round-trip).
  //
  // #247: the hub's /events SSE handler requires an explicit network_id for
  // utok_ callers (utok_ has no implicit network binding the way ntok_ does).
  // Pre-#247 the dashboard didn't pass network_id, so even after the hub
  // started accepting utok_ the upstream would still 403 at the network gate.
  const reqUrl = new URL(req.url);
  let channel = reqUrl.searchParams.get('alias') || '';
  let networkId = reqUrl.searchParams.get('network_id') || '';

  if (!channel || !networkId) {
    try {
      const meRes = await fetch(`${HUB_URL}/api/auth/me`, { headers });
      if (meRes.ok) {
        const me = await meRes.json();
        if (!channel) channel = me?.user?.username || 'Dashboard';
        if (!networkId) {
          // commhub /api/auth/me returns either `current_network` (string) or
          // a `networks[]` array. Prefer the explicit current_network; fall
          // back to the first network the user belongs to.
          networkId = me?.current_network || me?.networks?.[0]?.network_id || '';
        }
      } else {
        if (!channel) channel = 'Dashboard';
      }
    } catch {
      if (!channel) channel = 'Dashboard';
    }
  }

  // #247: surface a clear error if we still don't have a network_id, instead
  // of letting the upstream return an opaque 403 / a generic 502 from the proxy.
  if (!networkId) {
    return new Response(
      'SSE proxy: no network_id available (user is not a member of any network — log in and verify network membership)',
      { status: 400 },
    );
  }

  const upstreamUrl = `${HUB_URL}/events/${encodeURIComponent(channel)}?network_id=${encodeURIComponent(networkId)}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers,
      // @ts-expect-error - Next.js fetch doesn't type duplex
      duplex: 'half',
    });

    if (!upstream.ok || !upstream.body) {
      return new Response('SSE upstream unavailable', { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch {
    return new Response('SSE connection failed', { status: 502 });
  }
}

export async function HEAD(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  if (searchParams.get('probe') !== '1') {
    return new Response(null, { status: 405 });
  }

  // P0 fix: probe /health instead of opening real SSE upstream.
  // Opening /events/:session keeps an upstream connection hanging, which
  // exhausts the browser's HTTP/1.1 connection pool and blocks RSC fetches.
  const userToken = await getV3UserToken();
  const headers: Record<string, string> = {};
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`${HUB_URL}/health`, {
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return new Response(null, {
      status: 204,
      headers: { 'x-anet-sse-available': res.ok ? 'true' : 'false' },
    });
  } catch {
    clearTimeout(timeout);
    return new Response(null, {
      status: 204,
      headers: { 'x-anet-sse-available': 'false' },
    });
  }
}
