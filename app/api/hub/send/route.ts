import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const { alias, task, priority, attachments } = await req.json();

    // Get user's network_id for proper network scoping
    let networkId: string | undefined;
    try {
      const userToken = await getV3UserToken();
      if (userToken) {
        const meRes = await hubFetch('/api/auth/me', { headers: { Authorization: `Bearer ${userToken}` } });
        if (meRes.ok) {
          const meData = await meRes.json();
          networkId = meData.current_network || meData.networks?.[0]?.network_id;
        }
      }
    } catch {}

    const userToken = await getV3UserToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
    const res = await fetch(`${HUB_URL}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'send_task',
          arguments: {
            alias,
            task,
            priority: priority || 'normal',
            ...(Array.isArray(attachments) && attachments.length ? { meta: { attachments } } : {}),
            ...(networkId ? { network_id: networkId } : {}),
          },
        },
      }),
    });
    const raw = await res.text();
    // MCP SSE response: "event: message\ndata: {...}\n\n"
    const dataMatch = raw.match(/data:\s*(\{.*\})/);
    const parsed = dataMatch ? JSON.parse(dataMatch[1]) : JSON.parse(raw);
    const content = parsed?.result?.content?.[0]?.text;
    const result = content ? JSON.parse(content) : parsed;
    return Response.json(result);
  } catch (e: unknown) {
    return Response.json({ error: 'send failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
