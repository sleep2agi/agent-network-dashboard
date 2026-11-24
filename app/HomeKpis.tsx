'use client';

import { StatsBar } from './components/StatsBar';
import type { Session } from './components/types';
import { useHealth, useSessions } from './lib/hooks';
import { useNetworkId } from './lib/network-context';
import { isOnline, presenceStatus } from './lib/presence';

export function KpiPlaceholder() {
  return <div data-testid="kpi-placeholder" aria-label="正在读取节点统计"><StatsBar placeholder presenceUnknown online={0} working={0} total={0} /></div>;
}

export function HomeKpis({ network, initial }: { network: string; initial: Session[] | null }) {
  const { networkId, ready } = useNetworkId();
  const seed = network && (!ready || network === networkId) ? initial : null;
  const { sessions, loaded } = useSessions({ lite: true, initial: seed });
  const { health } = useHealth();
  if (!loaded && !seed) return <KpiPlaceholder />;
  const list = loaded ? sessions : seed ?? [];
  return <StatsBar total={list.length} working={list.filter(s => s.status === 'working').length}
    online={list.filter(s => isOnline(s, health?.sse_sessions || {})).length}
    presenceUnknown={presenceStatus(health?.sse_sessions, health) !== 'ready'} />;
}
