import { NextResponse } from 'next/server';
import { DASHBOARD_SESSION_COOKIE } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

/**
 * V3 Auth: register or login via CommHub Auth API.
 * On success, stores the user token (atok_) in the dashboard session cookie.
 */
export async function POST(req: Request) {
  try {
    const { action, username, password } = await req.json();

    if (!action || !password) {
      return Response.json({ error: 'username and password required' }, { status: 400 });
    }

    const endpoint = action === 'register' ? '/api/auth/register'
      : action === 'login' ? '/api/auth/login'
      : null;

    if (!endpoint) {
      return Response.json({ error: 'invalid action' }, { status: 400 });
    }

    const res = await hubFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!data.ok || (!data.token && !data.network_token)) {
      return Response.json({ ok: false, error: data.error || 'auth failed' }, { status: 401 });
    }

    // Prefer utok_ (user token), fallback to atok_, then ntok_
    const sessionToken = data.token || data.network_token;
    let networks = [];
    let currentNetwork = data.network_id || null;

    if (data.token) {
      try {
        const meRes = await hubFetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${data.token}` },
        });
        const meContentType = meRes.headers.get('content-type') || '';
        if (meRes.ok && meContentType.includes('application/json')) {
          const meData = await meRes.json();
          networks = meData.networks || [];
          currentNetwork = meData.current_network?.network_id || meData.networks?.[0]?.network_id || currentNetwork;
        }
      } catch {
        // Login remains valid even if profile enrichment fails.
      }
    }

    // Set session cookie with V3 user token
    const response = NextResponse.json({
      ok: true,
      user: data.user,
      token: data.token,
      network_token: data.network_token || null,
      network_id: currentNetwork,
      networks,
    });

    // Secure only when request is actually HTTPS (supports Docker HTTP demos)
    const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
    const isHttps = proto === 'https';
    response.cookies.set(DASHBOARD_SESSION_COOKIE, `v3:${sessionToken}`, {
      httpOnly: true,
      secure: isHttps && process.env.COOKIE_INSECURE !== '1',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });

    return response;
  } catch (e: unknown) {
    return Response.json({ error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
