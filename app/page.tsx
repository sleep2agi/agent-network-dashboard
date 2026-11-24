import { cache, Suspense } from 'react';
import { cookies } from 'next/headers';
import { hubFetch } from './lib/hub';
import { normalizeSessions } from './lib/session-normalize';
import { projectLiteSessions } from './lib/lite-status';
import type { Session } from './components/types';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import {HomeKpis, KpiPlaceholder} from './HomeKpis';
import HomeView from './HomeView';

import {HomeTaskStats, type Counts} from './HomeTaskStats';

async function read(path: string, network: string, timeout: number) {
  if (!network) return null;
  try {
    const res = await hubFetch(`${path}?network_id=${encodeURIComponent(network)}`, { signal: AbortSignal.timeout(timeout) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

export default async function HomePage() {
  const network = (await cookies()).get('anet_network_id')?.value ?? '';
  const stats = await read('/api/stats', network, 300);
  const rows = stats?.tasks?.by_status;
  const counts: Counts = stats?.ok && Array.isArray(rows) && rows.every(r => r && typeof r.status === 'string' && Number.isFinite(r.count))
    ? rows.map(({status, count}: {status:string;count:number}) => ({status, count})) : null;
  return <div className="min-h-full bg-[var(--bg)] text-[var(--fg)] p-4 sm:p-6">
    <h1 className="mb-4 text-2xl font-bold tracking-tight text-center lg:text-left">Agent Network</h1>
    <Suspense fallback={<KpiPlaceholder />}><ScopedKpis network={network} /></Suspense>
    <HomeTaskStats network={network} counts={counts} />
    <Suspense fallback={<LoadingSkeleton />}><ScopedNodes network={network} counts={counts} /></Suspense>
  </div>;
}

const readSessions = cache(async (network: string) => {
  const status = await read('/api/status', network, 1500);
  return Array.isArray(status?.sessions) ? projectLiteSessions(normalizeSessions(status.sessions as Session[])) : null;
});

async function ScopedKpis({network}: {network:string}) {
  return <HomeKpis network={network} initial={await readSessions(network)} />;
}

async function ScopedNodes({network, counts}: {network:string; counts:Counts}) {
  const sessions = await readSessions(network);
  return <HomeView initialNetwork={network} initialSessions={sessions} initialCounts={counts} />;
}
