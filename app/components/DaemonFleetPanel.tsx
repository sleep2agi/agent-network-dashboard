'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNetworkId } from '../lib/network-context';
import { readinessSummary } from '../lib/hub-align.mjs';
import { PendingNotice } from './PendingNotice';

type Daemon = {
  daemon_node_id: string;
  alias: string;
  hostname?: string | null;
  online?: boolean;
  can_create_nodes?: boolean;
  create_nodes_blocked_reason?: string;
  runtimes_supported?: string[];
  runtime_readiness?: Record<string, unknown>;
};

function createLine(daemon: Daemon): string {
  if (daemon.can_create_nodes === false) {
    return `现在不能建节点${daemon.create_nodes_blocked_reason ? `（${daemon.create_nodes_blocked_reason}）` : ''}`;
  }
  if (daemon.can_create_nodes === true) return '可以建节点';
  return '还没上报能不能建节点';
}

export function DaemonFleetPanel() {
  const { networkId } = useNetworkId();
  const router = useRouter();
  const [daemons, setDaemons] = useState<Daemon[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const url = networkId
      ? `/api/anet/host-supervisors?network_id=${encodeURIComponent(networkId)}`
      : '/api/anet/host-supervisors';
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          router.push('/login');
          return null;
        }
        return r.json();
      })
      .then((body) => {
        if (!alive || !body) return;
        if (!body.ok) {
          setError(body.error || '读取 daemon 失败');
          setDaemons([]);
          return;
        }
        setError('');
        setDaemons(Array.isArray(body.daemons) ? body.daemons : []);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : '读取 daemon 失败');
        setDaemons([]);
      });
    return () => { alive = false; };
  }, [networkId, router]);

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg)]">Daemons</h2>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          Hub 已经在 /api/host-supervisors 上返回的建节点能力和 runtime 自检。没报过的字段保持「未知」，不会当成不能建。
        </p>
      </div>
      {daemons === null ? <p className="text-xs text-[var(--fg-dim)]">正在读取 daemon…</p> : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {daemons && daemons.length === 0 && !error ? (
        <p className="text-xs text-[var(--fg-dim)]">这个网络里还没有 host_supervisor。</p>
      ) : null}
      <ul className="space-y-2">
        {(daemons || []).map((daemon) => {
          const readiness = daemon.runtime_readiness && typeof daemon.runtime_readiness === 'object'
            ? Object.entries(daemon.runtime_readiness)
            : [];
          return (
            <li key={daemon.daemon_node_id} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-[var(--fg)]">{daemon.alias || daemon.daemon_node_id}</span>
                <span className="text-[var(--fg-dim)]">{daemon.online === false ? '离线' : daemon.online === true ? '在线' : '在线状态未上报'}</span>
              </div>
              <p className="mt-1 text-[var(--fg-muted)]">{createLine(daemon)}</p>
              {daemon.runtimes_supported && daemon.runtimes_supported.length > 0 ? (
                <p className="mt-1 text-[var(--fg-dim)]">runtime：{daemon.runtimes_supported.join('、')}</p>
              ) : null}
              {readiness.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-[var(--fg-dim)]">
                  {readiness.map(([name, entry]) => {
                    const summary = readinessSummary(entry);
                    return (
                      <li key={name}>
                        {name}{summary ? ` · ${summary.state}${summary.reason ? ` · ${summary.reason}` : ''}` : ''}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <PendingNotice>
        按某一台 daemon 列出它管的子节点，并在这一页启动、停止、重启或删除，还没接到。节点自己的生命周期菜单仍然可用。
      </PendingNotice>
    </section>
  );
}
