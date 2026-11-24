'use client';
import Link from 'next/link';
import {useStats,useTaskStats} from './lib/hooks';
import {useNetworkId} from './lib/network-context';
export type Counts = {status:string;count:number}[] | null;
export function useHomeCounts(initialNetwork:string,initialCounts:Counts){
 const {networkId,ready}=useNetworkId();
 const seeded=!!initialNetwork&&(!ready||networkId===initialNetwork);
  const { stats: liveStats } = useStats();
  const stats = liveStats ?? (seeded && initialCounts ? {tasks:{by_status:initialCounts}} : null);
  // 首页只在 /api/stats 没给 by_status 时才需要统计任务状态。
  // 以前回退是拉 tasks?limit=500（生产实测 665,867 B）；现在改叫服务端计数端点
  //（/api/hub/task-stats，回几百字节），浏览器不再为 5 个数字下载 666 KB。
  const statsHasTaskStatus = Boolean(stats?.tasks?.by_status?.length);
  const { taskStats: fallbackTaskStats, loaded: fallbackLoaded, error: fallbackError } = useTaskStats(stats != null && !statsHasTaskStatus);
  // Task stats: prefer /api/stats, fallback to manual
  const taskStats: Record<string, number> = {};
  if (stats?.tasks?.by_status?.length) {
    for (const s of stats.tasks.by_status) {
      taskStats[s.status] = s.count;
    }
  } else if (fallbackTaskStats) {
    Object.assign(taskStats, fallbackTaskStats);
  }

  // `.619`：统计是否已经读到（决定显示数字还是「读取中」）。
  // 两条路径任一完成即算读到：/api/stats 自带 by_status，或兜底端点的 SWR 已返回。
  const taskStatsReady = statsHasTaskStatus || fallbackLoaded;

 return {taskStats,taskStatsReady,fallbackError};
}
export function HomeTaskStats({network,counts}:{network:string;counts:Counts}){
const {taskStats,taskStatsReady,fallbackError}=useHomeCounts(network,counts);
return (
      <section className="mb-4 sm:mb-6 flex items-center justify-between rounded-lg bg-[var(--bg-secondary)] px-4 py-2.5 text-xs">
          <div className="text-gray-400 tabular-nums">
            {taskStatsReady ? (
              <>
                <span className={taskStats['running'] ? 'text-green-400' : 'text-gray-500'}>{taskStats['running'] || 0} 运行中</span>
                <span className="text-gray-600"> &middot; </span>
                <span className={taskStats['failed'] ? 'text-red-400' : 'text-gray-500'}>{taskStats['failed'] || 0} 失败</span>
              </>
            ) : (
              // 读不到 ≠ 没有：占位而不是把整条藏起来，也不再显示 0。
              // 失败与加载分开写：失败后继续显示"读取中"等于宣称一件没发生的事。
              // 用 token 色而不是 text-gray-500：命名调色板类有 ratchet（不走 token、换主题不变色）。
              <span className="text-[var(--fg-dim)]">{fallbackError ? '统计暂不可用' : '统计读取中…'}</span>
            )}
          </div>
          {/* 命中区：链接外观只有 16px 高（与左侧计数同行，保持紧凑），
              手机拇指点不准。透明 ::before 上下各扩 4px ⇒ 命中 24px（WCAG 2.2 SC 2.5.8 AA），
              像素外观不变。做法与 HealthBanner / 军团图例一致。 */}
          <Link href="/tasks" prefetch={false} className="relative text-[var(--accent-text)] hover:opacity-80 before:absolute before:inset-y-[-4px] before:inset-x-[-4px] before:content-['']">查看全部 →</Link>
      </section>
);
}
