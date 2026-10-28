import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const res = await hubFetch('/api/auth/tokens');
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) return Response.json(await res.json());
    // 失败不是「没有 token」。旧行为返回 200 空数组，正好命中了
    // /settings/tokens 里那条注释警告的坑：用户以为没有 token，于是重复创建。
    return Response.json(
      { ok: false, error: `CommHub /api/auth/tokens ${res.status}` },
      { status: res.status === 404 ? 502 : res.status },
    );
  } catch {
    return Response.json({ error: 'failed' }, { status: 502 });
  }
}
