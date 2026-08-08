import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { callMcp, parseMcpEnvelope, resolveDefaultNetworkId } from '@/app/lib/hub-mcp';

async function networkArg(value?: string | null) {
  const networkId = value || await resolveDefaultNetworkId();
  return networkId ? { network_id: networkId } : {};
}

async function invoke(tool: string, args: Record<string, unknown>) {
  const res = await callMcp(tool, args);
  if (res.status === 404 || res.status === 501) {
    return Response.json({ ok: false, unconfirmed: true, error: `hub lacks ${tool}` }, { status: 200 });
  }
  if (!res.ok) return Response.json({ ok: false, error: `hub ${res.status}` }, { status: 502 });
  let result: { ok?: boolean; error?: string };
  try {
    result = await parseMcpEnvelope(res) as { ok?: boolean; error?: string };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unknown tool|tool.+not found|not registered/i.test(message)) {
      return Response.json({ ok: false, unconfirmed: true, error: `hub lacks ${tool}` }, { status: 200 });
    }
    throw error;
  }
  return Response.json(result, { status: result?.ok === false ? 400 : 200 });
}

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  const url = new URL(req.url);
  const skillId = url.searchParams.get('skill_id');
  if (skillId) {
    try { return await invoke('get_skill', { ...(await networkArg(url.searchParams.get('network_id'))), skill_id: skillId }); }
    catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
  }
  const args = {
    ...(await networkArg(url.searchParams.get('network_id'))),
    ...(url.searchParams.get('review') === '1' ? { include_pending: true } : {}),
    ...(url.searchParams.get('q') ? { query: url.searchParams.get('q')! } : {}),
  };
  try { return await invoke('list_skills', args); }
  catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  try {
    return await invoke('submit_skill', {
      ...(await networkArg(typeof body.network_id === 'string' ? body.network_id : null)),
      slug: body.slug,
      name: body.name,
      description: body.description || '',
      version: body.version,
      content: body.content,
    });
  } catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}

export async function PATCH(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  try {
    return await invoke('review_skill', {
      ...(await networkArg(typeof body.network_id === 'string' ? body.network_id : null)),
      skill_id: body.skill_id,
      decision: body.decision,
      note: body.note || '',
    });
  } catch (e) { return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 }); }
}
