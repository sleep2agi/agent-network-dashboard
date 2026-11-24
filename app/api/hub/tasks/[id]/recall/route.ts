import { requireDashboardAuth, getV3UserToken } from '@/app/lib/dashboard-auth';

const HUB_URL = process.env.COMMHUB_URL || 'http://127.0.0.1:9200';
const TASK_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

interface HubRecallResponse {
  ok?: boolean;
  recalled?: boolean;
  already_recalled?: boolean;
  task_id?: string;
  previous_status?: string;
  status?: string;
  recalled_at?: string;
  recalled_by?: string;
  error?: string;
  message?: string;
}

function userMessage(status: number, body: HubRecallResponse): string {
  switch (body.error) {
    case 'task_already_terminal':
      return '对方已回复或任务已结束，无法撤回';
    case 'recall_sender_only':
      return '只能撤回自己发送的消息';
    case 'task not found':
    case 'task_not_found':
      return '消息不存在或已失效';
    default:
      if (status === 401) return '认证已过期，请重新登录';
      if (status === 409) return '对方已回复或任务已结束，无法撤回';
      if (status === 403) return '只能撤回自己发送的消息';
      if (status >= 500) return `撤回失败 (${status})，请稍后重试`;
      return body.message || body.error || `撤回失败 (HTTP ${status})`;
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { id } = await params;
  if (!id || !TASK_ID_REGEX.test(id)) {
    return Response.json(
      { ok: false, error: 'invalid_task_id', message: '无效的消息 ID' },
      { status: 400 },
    );
  }

  const userToken = await getV3UserToken();
  if (!userToken) {
    return Response.json(
      { ok: false, error: 'no_session', message: '无会话 token，请重新登录' },
      { status: 401 },
    );
  }

  let hubRes: Response;
  try {
    hubRes = await fetch(`${HUB_URL}/api/tasks/${encodeURIComponent(id)}/recall`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch (e: unknown) {
    return Response.json(
      {
        ok: false,
        error: 'hub_unreachable',
        message: '服务端不可达，请稍后重试',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  let hubBody: HubRecallResponse;
  try {
    hubBody = (await hubRes.json()) as HubRecallResponse;
  } catch {
    return Response.json(
      { ok: false, error: 'hub_bad_response', message: `服务端返回异常 (${hubRes.status})` },
      { status: 502 },
    );
  }

  if (!hubRes.ok || !hubBody.ok) {
    return Response.json(
      {
        ok: false,
        error: hubBody.error ?? `hub_${hubRes.status}`,
        message: userMessage(hubRes.status, hubBody),
        detail: hubBody,
      },
      { status: hubRes.status },
    );
  }

  return Response.json({
    ok: true,
    recalled: true,
    already_recalled: !!hubBody.already_recalled,
    task_id: hubBody.task_id ?? id,
    previous_status: hubBody.previous_status,
    status: hubBody.status ?? 'cancelled',
    recalled_at: hubBody.recalled_at,
    recalled_by: hubBody.recalled_by,
  });
}
