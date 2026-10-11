import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

/**
 * Read-only requirements proxy.
 * List, one card, stats, events, people, and projects. Writes stay on the Hub.
 * `abandoned` is declared on every read so the Hub does not project that
 * column back to `done`.
 */
const COLLECTIONS = new Set(['stats', 'events', 'people', 'projects']);
const SEGMENT = /^[A-Za-z0-9_-]{1,200}$/;

function copyParams(source: URLSearchParams, target: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    const value = source.get(key);
    if (value) target.set(key, value);
  }
}

function clampLimit(raw: string | null, fallback: number) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, 500);
}

export async function GET(req: Request, context: { params: Promise<{ path?: string[] }> }) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { path = [] } = await context.params;
  if (path.length > 1 || path.some((part) => !SEGMENT.test(part))) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const head = path[0] ?? '';
  const kind = !head ? 'list' : COLLECTIONS.has(head) ? head : 'item';
  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || (await resolveDefaultNetworkId());
  if (!networkId) return Response.json({ ok: false, error: 'network_id required' }, { status: 400 });

  const qs = new URLSearchParams();
  qs.set('network_id', networkId);
  qs.set('accept_columns', 'abandoned');

  if (kind === 'list') {
    qs.set('view', searchParams.get('view') === 'full' ? 'full' : 'summary');
    qs.set('limit', String(clampLimit(searchParams.get('limit'), 200)));
    copyParams(searchParams, qs, ['q', 'status', 'cursor', 'seq', 'project_id', 'include_archived']);
  } else if (kind === 'stats') {
    copyParams(searchParams, qs, ['tz', 'days', 'recent', 'from']);
    if (!qs.has('days')) qs.set('days', '30');
    if (!qs.has('recent')) qs.set('recent', '12');
  } else if (kind === 'events') {
    qs.set('limit', String(clampLimit(searchParams.get('limit'), 50)));
    copyParams(searchParams, qs, ['since', 'cursor', 'requirement_id']);
  }

  const upstream = kind === 'list'
    ? `/api/requirements?${qs.toString()}`
    : kind === 'item'
      ? `/api/requirements/${encodeURIComponent(head)}?${qs.toString()}`
      : `/api/requirements/${head}?${qs.toString()}`;

  try {
    const res = await hubFetch(upstream, {
      headers: {
        Accept: 'application/json',
        'X-Anet-Accept-Columns': 'abandoned',
      },
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'invalid_hub_response' }));
    return Response.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
