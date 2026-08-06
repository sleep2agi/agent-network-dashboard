import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { HubDefinitiveError, HubDeliveryUnknownError, sendWithIdempotentRecovery, withAbortTimeout } from '@/app/lib/hub-send-recovery';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';

export async function POST(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  try {
    const { alias, task, priority, attachments, network_id, request_id } = await req.json();
    if (typeof alias !== 'string' || !alias.trim() || typeof task !== 'string' || !task.trim()) {
      return Response.json({ ok: false, error: 'invalid_request', detail: 'alias and task are required' }, { status: 400 });
    }
    const clientRequestId = typeof request_id === 'string' && /^dreq_[A-Za-z0-9_-]{16,96}$/.test(request_id)
      ? request_id
      : `dreq_${crypto.randomUUID().replace(/-/g, '')}`;

    // P0 (指挥室: "dashboard 发不出消息"): multi-network users hit
    // "network_id required for user token when multiple networks are
    // available" because this route GUESSED the network server-side
    // (me.current_network || networks[0]) — wrong network for
    // multi-network users, and nothing at all when the me-call failed.
    // The client knows the real scope (the target node's own network, or
    // the sidebar-selected one) — prefer what it sends; the me-derivation
    // stays only as a single-network fallback. Same pattern as the
    // node-config network_id fix (PR #15, regression-found).
    let networkId: string | undefined =
      typeof network_id === 'string' && network_id ? network_id : undefined;
    if (!networkId) try {
      const userToken = await getV3UserToken();
      if (userToken) {
        const meRes = await withAbortTimeout(3_000, signal => hubFetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${userToken}` }, signal,
        }));
        if (meRes.ok) {
          const meData = await meRes.json();
          networkId = meData.current_network || meData.networks?.[0]?.network_id;
        }
      }
    } catch {}

    const userToken = await getV3UserToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: clientRequestId,
        method: 'tools/call',
        params: {
          name: 'send_task',
          arguments: {
            alias,
            task,
            priority: priority || 'normal',
            meta: {
              client_request_id: clientRequestId,
              source: 'dashboard-chat',
              ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
            },
            ...(networkId ? { network_id: networkId } : {}),
          },
        },
    });

    try {
      const result = await sendWithIdempotentRecovery({ hubUrl: HUB_URL, headers, body });
      return Response.json({ ...result, request_id: clientRequestId });
    } catch (retryError: unknown) {
      if (retryError instanceof HubDeliveryUnknownError) {
        return Response.json({
          ok: false,
          error: 'delivery_unknown',
          detail: retryError instanceof Error ? retryError.message : String(retryError),
          request_id: clientRequestId,
          retryable: true,
        }, { status: 504 });
      }
      if (retryError instanceof HubDefinitiveError) {
        return Response.json({
          ok: false,
          error: 'hub_rejected',
          detail: retryError.message,
          request_id: clientRequestId,
          retryable: false,
        }, { status: retryError.status });
      }
      throw retryError;
    }
  } catch (e: unknown) {
    return Response.json({ error: 'send failed', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
