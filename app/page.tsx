import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { hubFetch } from './lib/hub';
import { normalizeSessions } from './lib/session-normalize';
import { projectLiteSessions } from './lib/lite-status';
import type { Session } from './components/types';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import HomeView from './HomeView';

export default function HomePage() {
  return <Suspense fallback={<LoadingSkeleton />}><ScopedHome /></Suspense>;
}

async function ScopedHome() {
  const network = (await cookies()).get('anet_network_id')?.value ?? '';
  const query = `?network_id=${encodeURIComponent(network)}`;
  const read = async (path: string) => {
    if (!network) return null;
    try {
      // Hub 卡住时不能让首页一直停在骨架：1.5 秒没回就放弃服务端首帧，交给浏览器自己取。
      const res = await hubFetch(path + query, { signal: AbortSignal.timeout(1500) });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const [status, stats] = await Promise.all([read('/api/status'), read('/api/stats')]);
  const initialSessions = Array.isArray(status?.sessions)
    ? projectLiteSessions(normalizeSessions(status.sessions as Session[])) : null;
  const rows = stats?.tasks?.by_status;
  const initialCounts = stats?.ok && Array.isArray(rows) && rows.every(r => r && typeof r.status === 'string' && Number.isFinite(r.count))
    ? rows.map(({status, count}: {status:string;count:number}) => ({status, count})) : null;
  return <HomeView initialNetwork={network} initialSessions={initialSessions} initialCounts={initialCounts} />;
}
