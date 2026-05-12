import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const alias = searchParams.get('alias');
  if (!alias) return Response.json({ error: 'alias required' }, { status: 400 });

  try {
    // Get session status
    const statusRes = await hubFetch('/api/status');
    const statusData = await statusRes.json();
    const session = (statusData.sessions || []).find((s: { alias: string }) => s.alias === alias);

    // Get inbox messages for this session (sent TO this session)
    const inboxRes = await hubFetch('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(),
        method: 'tools/call',
        params: { name: 'get_inbox', arguments: { alias, limit: 50 } }
      }),
    });
    const inboxRaw = await inboxRes.text();
    const inboxMatch = inboxRaw.match(/data:\s*(\{.*\})/);
    const inboxData = inboxMatch ? JSON.parse(inboxMatch[1]) : JSON.parse(inboxRaw);
    const inboxContent = inboxData?.result?.content?.[0]?.text;
    const inboxParsed = inboxContent ? JSON.parse(inboxContent) : { messages: [] };

    // Get health for SSE info
    const healthRes = await hubFetch('/health');
    const healthData = await healthRes.json();
    // SSE keys are `network_id:alias` since server v0.7+; fall back to alias.
    const sseSessions = healthData.sse_sessions || {};
    const sessionNetworkId = session?.network_id;
    const sseCount = (sessionNetworkId ? sseSessions[`${sessionNetworkId}:${alias}`] : undefined) ?? sseSessions[alias] ?? 0;

    return Response.json({
      session: session || null,
      inbox: inboxParsed.messages || [],
      sse: sseCount,
    });
  } catch (e: unknown) {
    return Response.json({ error: 'failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
