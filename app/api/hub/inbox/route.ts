import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function GET() {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const res = await hubFetch('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: 'get_inbox',
          arguments: { alias: 'Dashboard', limit: 50 }
        }
      }),
    });
    const text = await res.text();
    const match = text.match(/data:\s*(\{.*\})/);
    const data = match ? JSON.parse(match[1]) : JSON.parse(text);

    // Parse the nested result
    const content = data?.result?.content?.[0]?.text;
    const parsed = content ? JSON.parse(content) : data;
    return Response.json(parsed);
  } catch (e: unknown) {
    return Response.json({ error: 'inbox failed', messages: [] }, { status: 502 });
  }
}
