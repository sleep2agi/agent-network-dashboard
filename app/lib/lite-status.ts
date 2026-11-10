import type { Session } from '../components/types';

/**
 * `/api/hub/status?lite=1` 的字段投影（唯一实现）。
 *
 * 为什么抽出来：现在有两处需要「lite 投影」——API 路由（浏览器取数）与
 * `/nodes` 服务端组件（首屏 SSR 注入）。两份逻辑迟早会漂移，
 * 而漂移的后果是「页面读的字段被其中一个投影掉」（.433 踩过一次）。
 */
const KEEP = ['alias','status','agent','server','task','progress','updated_at','node_id','session_id',
  'last_seen_at','network_id','project_dir','model','runtime','lifecycle_state','channels','version',
  'rules_file_capable','logs_capable','files_capable','node_secrets_capable','skills_capable'] as const;

export function projectLiteSessions(sessions: Session[]): Session[] {
  return sessions.map((s) => {
    const src = s as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of KEEP) if (k in src) out[k] = src[k];
    if (typeof out.task === 'string' && out.task.length > 120) out.task = `${out.task.slice(0, 120)}…`;
    return out as unknown as Session;
  });
}
