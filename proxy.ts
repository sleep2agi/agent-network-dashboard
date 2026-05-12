import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'anet_dashboard_session';

export function proxy(request: NextRequest) {
  const isLogin = request.nextUrl.pathname === '/login';
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (!hasSession && !isLogin) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (hasSession && isLogin) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/node', '/tasks', '/tasks/:path*', '/nodes', '/messages', '/logs', '/settings', '/settings/:path*', '/admin'],
};
