import { requireDashboardAuth } from '@/app/lib/dashboard-auth';
import { hubFetch } from '@/app/lib/hub';
import { normalizeSessions } from '@/app/lib/session-normalize';

export async function GET(req: Request) {
  const authFailure = await requireDashboardAuth();
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const networkId = searchParams.get('network_id') || '';
  // "all" or "" → no network_id filter (admin sees all)
  const includeFilter = networkId && networkId !== 'all';
  const qs = includeFilter ? `?network_id=${encodeURIComponent(networkId)}` : '';

  try {
    const res = await hubFetch(`/api/status${qs}`);
    // 上游 5xx 不能透传成 200：页面靠状态码区分「读到 0 个节点」和「没读到」。
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `CommHub /api/status ${res.status}` },
        { status: res.status === 404 ? 502 : res.status },
      );
    }
    const data = await res.json();
    if (Array.isArray(data.sessions)) data.sessions = normalizeSessions(data.sessions);

    // lite=1：按 Session 接口投影，丢掉页面从不读取的字段并截断超长文本。
    // 生产实测 393 条会话共 709,690 B，单条约 2.1 KB，其中
    //   task 319B / host 233B / process_telemetry 101B 占约 65%（host 与 telemetry 页面不用）。
    if (searchParams.get('lite') === '1' && Array.isArray(data.sessions)) {
      // 再去掉三个首页从不读取的字段（逐个核对过：page.tsx / NodeList / TopoGraph /
      // AgentCard / StatsBar / CommandCenter 都没有引用）：
      //   config_path 29.8 KB · version 10.2 KB · channels 7.1 KB（按 394 条会话实测）
      // project_dir 保留：TopoGraph 的悬停 title 会显示「cwd: …」。
      // channels / version 必须保留：
      //  - channels：NodeSettingsPanel 的频道开关用它初始化（7.1 KB / 394 条）
      //  - version：节点详情副行的「版本」chip（与客户端 APP 头部四件套对齐）读它
      // 2026-11-09 教训：UI 开始读一个被投影掉的字段时，typecheck 不会报错，
      // 只有真实 DOM 复核才会发现「渲染出来是空的」。tests/lite-status-projection.test.mjs
      // 现在把「页面要读的字段必须留在 KEEP 里」写成契约。
      const KEEP = ['alias','status','agent','server','task','progress','updated_at','node_id','session_id',
        'last_seen_at','network_id','project_dir','model','runtime','lifecycle_state','channels','version',
        // 节点能力旗：会话详情按它决定是否显示「规则文件」等分区（与 APP 一致）。
        // 2026-11-10 教训：UI 开始读一个被投影掉的字段时，typecheck 不会报错，
        // 只有真的点一次才会发现「菜单项根本不出现」。
        'rules_file_capable','logs_capable','files_capable','node_secrets_capable','skills_capable'] as const;
      data.sessions = data.sessions.map((s: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const k of KEEP) if (k in s) out[k] = s[k];
        if (typeof out.task === 'string' && out.task.length > 120) out.task = `${out.task.slice(0, 120)}…`;
        return out;
      });
    }

    // If filtered result is empty, fetch global count for empty-state hint
    if (includeFilter && Array.isArray(data.sessions) && data.sessions.length === 0) {
      try {
        const globalRes = await hubFetch('/api/status');
        const globalData = await globalRes.json();
        if (Array.isArray(globalData.sessions)) globalData.sessions = normalizeSessions(globalData.sessions);
        const globalCount = Array.isArray(globalData.sessions) ? globalData.sessions.length : 0;
        if (globalCount > 0) {
          return Response.json({ ...data, _hint: { global_count: globalCount, filtered_network: networkId } });
        }
      } catch {}
    }

    return Response.json(data);
  } catch (e: unknown) {
    return Response.json({ error: 'CommHub unreachable', detail: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
