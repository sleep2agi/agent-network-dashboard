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

  // Resolve the SSE channel name: explicit ?alias= wins; otherwise look up
  // the user's username from /api/auth/me so we subscribe to the channel
  // the server pushes replies to.
  let channel = new URL(req.url).searchParams.get('alias') || '';
  if (!channel) {
    try {
      const meRes = await fetch(`${HUB_URL}/api/auth/me`, { headers });
      if (meRes.ok) {
        const me = await meRes.json();
        channel = me?.user?.username || 'Dashboard';
      } else {
        channel = 'Dashboard';
      }
    } catch {
      channel = 'Dashboard';
    }
  }

  try {
    const upstream = await fetch(`${HUB_URL}/events/${encodeURIComponent(channel)}`, {
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
