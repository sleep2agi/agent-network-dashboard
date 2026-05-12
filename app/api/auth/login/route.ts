import { NextResponse } from 'next/server';
import {
  createDashboardSessionValue,
  DASHBOARD_SESSION_COOKIE,
  verifyDashboardPassword,
} from '@/app/lib/dashboard-auth';
import { checkRateLimit } from '@/app/lib/rate-limit';

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';

  const { allowed, retryAfterMs } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } },
    );
  }

  const contentType = req.headers.get('content-type') || '';
  const password = contentType.includes('application/json')
    ? String((await req.json()).password || '')
    : String((await req.formData()).get('password') || '');

  if (!await verifyDashboardPassword(password)) {
    return Response.json({ error: 'invalid password' }, { status: 401 });
  }

  const sessionValue = await createDashboardSessionValue(password);
  const response = NextResponse.json({ ok: true });
  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  const isHttps = proto === 'https';
  response.cookies.set(DASHBOARD_SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: isHttps && process.env.COOKIE_INSECURE !== '1',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return response;
}
