import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { hubFetch } from '@/app/lib/hub';
import { normalizeSessions } from '@/app/lib/session-normalize';
import { projectLiteSessions } from '@/app/lib/lite-status';
import type { Session } from '@/app/components/types';
import { NodesView } from './NodesView';
import { NodesSkeleton } from './NodesSkeleton';

// 首屏服务端取数（.441）—— 关键：**用 Suspense 包住**，HTML 外壳先下发给浏览器。
//
// 为什么不直接 await：实测「阻塞式 SSR」把 TTFB 抬到 ~1s（要等 Hub 返回会话），
// fcp 从 166ms 恶化到 1076ms（6 倍）。而外壳先到、数据后流式补齐时，
// 首屏骨架 150ms 就出，行内容约 1s 到 —— 两个指标都不倒退。
//
// 三条安全约束：
//  1) 没有网络 cookie 就不注入（否则会把「全部网络」的会话渲染成当前网络，显示错数据）；
//  2) 取数失败一律回退到客户端取数（NodesView 自身兜底），绝不让首屏变白；
//  3) 注入的数据走与浏览器完全相同的 lite 投影（唯一实现见 app/lib/lite-status.ts）。
export default function NodesPage() {
  return (
    <Suspense fallback={<NodesSkeleton />}>
      <NodesWithServerData />
    </Suspense>
  );
}

async function NodesWithServerData() {
  let initialSessions: Session[] | null = null;
  try {
    const networkId = (await cookies()).get('anet_network_id')?.value ?? '';
    if (networkId) {
      const res = await hubFetch(`/api/status?network_id=${encodeURIComponent(networkId)}`);
      if (res.ok) {
        const data = (await res.json()) as { sessions?: unknown };
        if (Array.isArray(data.sessions)) {
          initialSessions = projectLiteSessions(normalizeSessions(data.sessions as Session[]));
        }
      }
    }
  } catch {
    initialSessions = null;
  }
  return <NodesView initialSessions={initialSessions} />;
}
