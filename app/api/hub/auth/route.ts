import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { NextResponse } from 'next/server';
import { DASHBOARD_SESSION_COOKIE } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

/**
 * Proxy for CommHub V3 Auth API.
 * POST: register or login (action in body)
 * GET: /api/auth/me (requires user token in query)
 */
export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const body = await req.json();
    const { action, ...payload } = body;

    if (action === 'create_token') {
      const { token: userToken, name } = payload;
      const res = await hubFetch('/api/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
        body: JSON.stringify({ name }),
      });
      return Response.json(await res.json());
    }

    if (action === 'revoke_token') {
      const { token: userToken, token_id } = payload;
      const res = await hubFetch(`/api/auth/tokens/${token_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${userToken}` },
      });
      return Response.json(await res.json());
    }

    if (action === 'change_password') {
      const { token: userToken, current_password, new_password } = payload;
      const res = await hubFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
        body: JSON.stringify({ old_password: current_password, new_password }),
      });
      const data = await res.json();
      const response = NextResponse.json(data);
      if (data.ok && data.token) {
        const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
        response.cookies.set(DASHBOARD_SESSION_COOKIE, `v3:${data.token}`, {
          httpOnly: true,
          secure: proto === 'https' && process.env.COOKIE_INSECURE !== '1',
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 24,
        });
      }
      return response;
    }

    if (action === 'create_network') {
      const { token: userToken, name, description } = payload;
      const res = await hubFetch('/api/networks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
        body: JSON.stringify({ name, description }),
      });
      return Response.json(await res.json());
    }

    if (action === 'delete_network') {
      const { token: userToken, network_id } = payload;
      const res = await hubFetch(`/api/networks/${network_id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${userToken}` },
      });
      return Response.json(await res.json());
    }

    if (action === 'invite_member') {
      const { token: userToken, network_id, role } = payload;
      const res = await hubFetch(`/api/networks/${network_id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
        body: JSON.stringify({ role }),
      });
      return Response.json(await res.json());
    }

    if (action === 'update_profile') {
      const { token: userToken, display_name, email } = payload;
      const res = await hubFetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
        body: JSON.stringify({ display_name, email }),
      });
      return Response.json(await res.json());
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
      body: JSON.stringify(payload),
    });
    return Response.json(await res.json());
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const userToken = searchParams.get('token') || '';
  const endpoint = searchParams.get('endpoint') || '/api/auth/me';

  try {
    const res = await hubFetch(endpoint, {
      headers: userToken ? { 'Authorization': `Bearer ${userToken}` } : {},
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return Response.json(await res.json());
    }
    return Response.json({ ok: false, error: 'endpoint not available' }, { status: 404 });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
