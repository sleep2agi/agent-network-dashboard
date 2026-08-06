import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';

export async function POST() {
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
          name: 'report_status',
          arguments: {
            resume_id: 'dashboard',
            alias: 'Dashboard',
            status: 'idle',
            server: 'vercel',
            hostname: 'vercel',
            agent: 'dashboard',
          }
        }
      }),
    });
    const text = await res.text();
    const match = text.match(/data:\s*(\{.*\})/);
    const data = match ? JSON.parse(match[1]) : JSON.parse(text);
    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: 'register failed' }, { status: 502 });
  }
}
