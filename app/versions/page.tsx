'use client';

import Link from 'next/link';
import { useSessions } from '../lib/hooks';
import type { Session } from '../components/types';

/** Published agent-node preview this page compares against. Not fetched from npm. */
const PUBLISHED_AGENT_NODE = '2.5.0-preview.150';

function online(s: Session) {
  return s.status === 'idle' || s.status === 'working';
}

function isAgentNode(s: Session) {
  return (s.agent || '').startsWith('agent-node');
}

export default function VersionsPage() {
  const { sessions, isLoading, error } = useSessions();
  const live = sessions.filter(online);
  const nodes = live.filter(isAgentNode);
  const current = nodes.filter(s => s.version === PUBLISHED_AGENT_NODE);
  const missing = nodes.filter(s => !s.version);
  const behind = nodes.filter(s => s.version && s.version !== PUBLISHED_AGENT_NODE);
  const groups = new Map<string, number>();
  for (const s of live) {
    const key = s.version || '(未上报)';
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-[var(--fg)]">
      <h1 className="text-lg font-semibold">版本</h1>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">
        只读。对照已发布的 agent-node <code>{PUBLISHED_AGENT_NODE}</code>。这里没有升级按钮。
      </p>
      {isLoading && <p className="mt-4 text-sm">读取中…</p>}
      {error && <p className="mt-4 text-sm text-red-400">读不到会话列表。</p>}
      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded border border-[var(--border)] p-3">在线 {live.length}</div>
        <div className="rounded border border-[var(--border)] p-3">已是 {PUBLISHED_AGENT_NODE.split('.').pop()}：{current.length}</div>
        <div className="rounded border border-[var(--border)] p-3">agent-node 落后或未上报：{behind.length + missing.length}</div>
      </div>
      <h2 className="mt-6 text-sm font-semibold">在线版本分布</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {ranked.map(([ver, n]) => (
          <li key={ver} className="flex justify-between gap-4 font-mono">
            <span>{ver}</span><span>{n}</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 text-sm font-semibold">agent-node 不是 {PUBLISHED_AGENT_NODE}</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {[...behind, ...missing].map(s => (
          <li key={s.alias}>
            <Link className="text-[var(--hl)]" href={`/node?alias=${encodeURIComponent(s.alias)}`}>{s.alias}</Link>
            <span className="ml-2 text-[var(--fg-muted)]">{s.version || '未上报'} · {s.server || s.agent}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
