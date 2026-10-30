import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

async function hubHeaders(): Promise<Record<string, string>> {
  const userToken = await getV3UserToken();
  const h: Record<string, string> = {};
  if (userToken) h['Authorization'] = `Bearer ${userToken}`;
  return h;
}

/**
 * Requirements (需求) list proxy — #1633.
 *
 * The dashboard has always been about dispatch tasks (/api/tasks); the
 * requirement board people actually work from had no route here at all.
 * Hub side is a plain REST read, so this stays a thin proxy: filters in,
 * `{ok, requirements[], has_more, next_cursor}` out, no reshaping.
 */
export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const params = new URLSearchParams();
  for (const key of ['network_id', 'status', 'tag', 'project_id', 'owner', 'agent_owner', 'q', 'include_archived', 'limit', 'cursor', 'view', 'parent_id']) {
    const value = searchParams.get(key);
    if (value) params.set(key, value);
  }
  if (!params.has('limit')) params.set('limit', '100');
  if (!params.has('view')) params.set('view', 'summary');

  try {
    const res = await fetch(`${HUB_URL}/api/requirements?${params.toString()}`, {
      headers: await hubHeaders(),
      next: { revalidate: 0 },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return Response.json(
        { ok: false, error: 'hub_not_json', status: res.status },
        { status: 502 },
      );
    }
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (e: unknown) {
    return Response.json(
      { ok: false, error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
