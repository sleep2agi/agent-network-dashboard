import { NextResponse } from 'next/server';
import { DASHBOARD_SESSION_COOKIE } from '@/app/lib/dashboard-auth';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(DASHBOARD_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
