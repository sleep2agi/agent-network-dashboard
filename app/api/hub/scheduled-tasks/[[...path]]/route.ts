import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';
const SEGMENT = /^[A-Za-z0-9_-]{1,200}$/;

async function proxy(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  const token = await getV3UserToken();
  if (!token) return Response.json({ ok: false, error: 'no_session' }, { status: 401 });

  const { path = [] } = await context.params;
  if (path.length > 2 || path.some((part) => !SEGMENT.test(part))) {
    return Response.json({ ok: false, error: 'invalid_path' }, { status: 400 });
  }
  const sourceUrl = new URL(req.url);
  const upstream = new URL(`${HUB_URL}/api/scheduled-tasks${path.length ? `/${path.map(encodeURIComponent).join('/')}` : ''}`);
  sourceUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  let body: string | undefined;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const raw = await req.text();
    if (raw.length > 32_000) return Response.json({ ok: false, error: 'body_too_large' }, { status: 413 });
    body = raw || '{}';
  }
  try {
    const res = await fetch(upstream, {
      method: req.method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      cache: 'no-store',
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/json; charset=utf-8' },
    });
  } catch {
    return Response.json({ ok: false, error: 'hub_unreachable', message: '无法连接 CommHub' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
