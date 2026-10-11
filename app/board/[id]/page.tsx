'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PendingNotice } from '../../components/PendingNotice';
import { useNetworkId } from '../../lib/network-context';
import { relativeAgo } from '../../lib/time';
import { personLabel, shortIdLabel } from '../../lib/requirement-links.mjs';

type Person = { kind?: string; id?: string; name?: string; display_name?: string; alias?: string };
type CheckItem = { id?: string; text?: string; done?: boolean };
type Requirement = {
  id: string;
  seq?: number | null;
  name?: string;
  column?: string;
  priority?: string;
  description?: string;
  due?: string;
  start?: string;
  assignee?: string;
  tags?: string[];
  checklist?: CheckItem[];
  owner?: Person | null;
  agent_owner?: Person | null;
  external_url?: string | null;
  updatedAt?: string;
};

export default function RequirementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { networkId } = useNetworkId();
  const [card, setCard] = useState<Requirement | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState('');
  const [loadedFor, setLoadedFor] = useState('');
  const scope = JSON.stringify([networkId, id]);

  useEffect(() => {
    let alive = true;
    const net = networkId ? `network_id=${encodeURIComponent(networkId)}&` : '';
    Promise.all([
      fetch(`/api/hub/requirements/${encodeURIComponent(id)}?${net}`, { cache: 'no-store' }).then(async (res) => {
        if (res.status === 401) {
          if (alive) router.push('/login');
          return null;
        }
        if (!res.ok) throw new Error(`Could not load this task (HTTP ${res.status})`);
        return res.json();
      }),
      fetch(`/api/hub/requirements/people?${net}`, { cache: 'no-store' }).then((res) => res.ok ? res.json() : { people: [] }).catch(() => ({ people: [] })),
    ]).then(([body, directory]) => {
      if (!alive || !body) return;
      setPeople(Array.isArray(directory?.people) ? directory.people : []);
      const requirement = body?.requirement;
      if (body.ok === false || !requirement || requirement.id !== id) {
        setCard(null);
        setError(body?.error || 'Task not found');
      } else {
        setCard(requirement);
        setError('');
      }
      setLoadedFor(scope);
    }).catch((e: unknown) => {
      if (!alive) return;
      setCard(null);
      setPeople([]);
      setError(e instanceof Error ? e.message : 'Could not load this task');
      setLoadedFor(scope);
    });
    return () => { alive = false; };
  }, [id, networkId, router, scope]);

  const loading = loadedFor !== scope;
  const seq = shortIdLabel(card?.seq);
  const checklist = Array.isArray(card?.checklist) ? card.checklist : [];

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-5 text-[var(--fg)] sm:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/board" className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline">← Board</Link>
        {loading ? <p className="text-xs text-[var(--fg-dim)]">Loading task…</p> : null}
        {!loading && error ? <p className="text-xs text-red-300">{error}</p> : null}
        {!loading && card ? (
          <>
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--fg-muted)]">
                {seq ? <span className="font-mono text-cyan-400">{seq}</span> : null}
                <span className="rounded border border-[var(--border)] px-1.5 py-0.5">{card.column || 'pool'}</span>
                {card.priority ? <span>{card.priority}</span> : null}
                {card.updatedAt ? <span>{relativeAgo(card.updatedAt) || ''}</span> : null}
              </div>
              <h1 className="text-xl font-semibold">{card.name || card.id}</h1>
            </header>
            <PendingNotice>This page is read-only. Editing the card is not wired yet.</PendingNotice>
            <dl className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs sm:grid-cols-2">
              <div><dt className="text-[var(--fg-dim)]">Owner</dt><dd>{card.owner ? personLabel(card.owner, people) : '—'}</dd></div>
              <div><dt className="text-[var(--fg-dim)]">Agent</dt><dd>{card.agent_owner ? personLabel(card.agent_owner, people) : '—'}</dd></div>
              <div><dt className="text-[var(--fg-dim)]">Assignee</dt><dd>{card.assignee || '—'}</dd></div>
              <div><dt className="text-[var(--fg-dim)]">Start / due</dt><dd>{card.start || '—'} → {card.due || '—'}</dd></div>
            </dl>
            {card.description ? (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
                <h2 className="text-xs font-medium text-[var(--fg-muted)]">Description</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{card.description}</p>
              </section>
            ) : null}
            {checklist.length > 0 ? (
              <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
                <h2 className="text-xs font-medium text-[var(--fg-muted)]">Checklist</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {checklist.map((item) => (
                    <li key={item.id || item.text} className={item.done ? 'text-[var(--fg-dim)] line-through' : ''}>
                      {item.done ? '✓' : '○'} {item.text}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {Array.isArray(card.tags) && card.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {card.tags.map((tag) => (
                  <span key={tag} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--fg-muted)]">{tag}</span>
                ))}
              </div>
            ) : null}
            {card.external_url && /^https?:\/\//i.test(card.external_url) ? (
              <a href={card.external_url} className="text-xs text-cyan-400 hover:underline" target="_blank" rel="noreferrer">{card.external_url}</a>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
