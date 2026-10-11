'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PendingNotice } from '../../components/PendingNotice';
import { MetaChip, PriorityChip, TagList, TaskPanel, columnDot, columnLabel } from '../../components/requirement-chrome';
import { useNetworkId } from '../../lib/network-context';
import { relativeAgo } from '../../lib/time';
import { isRequirementOverdue, normalizeRequirement, personLabel, shortIdLabel } from '../../lib/requirement-links.mjs';

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
  participants?: Person[];
  projectId?: string;
  archived?: boolean;
  children?: { total: number; done: number } | null;
  issues?: Array<{ repo: string; number: number; title?: string }>;
  external_url?: string | null;
  updatedAt?: string;
};

export default function RequirementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { networkId } = useNetworkId();
  const [card, setCard] = useState<Requirement | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [projectName, setProjectName] = useState('');
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
      fetch(`/api/hub/requirements/projects?${net}`, { cache: 'no-store' }).then((res) => res.ok ? res.json() : { projects: [] }).catch(() => ({ projects: [] })),
    ]).then(([body, directory, projectBody]) => {
      if (!alive || !body) return;
      setPeople(Array.isArray(directory?.people) ? directory.people : []);
      const requirement = normalizeRequirement(body?.requirement);
      const projects = Array.isArray(projectBody?.projects) ? projectBody.projects : [];
      const named = projects.find((row: { id?: string; name?: string }) => row && row.id && row.id === requirement?.projectId);
      setProjectName(typeof named?.name === 'string' ? named.name : '');
      if (body.ok === false || !requirement || requirement.id !== id) {
        setCard(null);
        setError(body?.error || 'Task not found');
      } else {
        setCard(requirement as Requirement);
        setError('');
      }
      setLoadedFor(scope);
    }).catch((e: unknown) => {
      if (!alive) return;
      setCard(null);
      setPeople([]);
      setProjectName('');
      setError(e instanceof Error ? e.message : 'Could not load this task');
      setLoadedFor(scope);
    });
    return () => { alive = false; };
  }, [id, networkId, router, scope]);

  const loading = loadedFor !== scope;
  const seq = shortIdLabel(card?.seq);
  const checklist = Array.isArray(card?.checklist) ? card.checklist : [];

  return (
    <main
      className="min-h-screen bg-[var(--bg)] px-4 py-6 text-[var(--fg)] sm:px-6"
      style={{ backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%, color-mix(in srgb, var(--info) 14%, transparent), transparent 60%)' }}
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <Link href="/board" className="inline-flex text-sm text-[var(--info)] hover:underline">← Board</Link>
        {loading ? <p className="text-sm text-[var(--fg-dim)]">Loading task…</p> : null}
        {!loading && error ? (
          <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
        ) : null}
        {!loading && card ? (
          <>
            <header className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {seq ? <span className="font-mono text-sm tabular-nums text-[var(--info)]">{seq}</span> : null}
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: columnDot(card.column) }} />
                  <MetaChip>{columnLabel(card.column)}</MetaChip>
                </span>
                <PriorityChip priority={card.priority} />
                {card.archived ? <MetaChip>Archived</MetaChip> : null}
                {card.updatedAt ? <span className="text-xs text-[var(--fg-dim)]">{relativeAgo(card.updatedAt) || ''}</span> : null}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{card.name || card.id}</h1>
            </header>
            <PendingNotice>This page is read-only. Editing the card is not wired yet.</PendingNotice>
            <dl className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-dim)]">Owner</dt>
                <dd className="mt-1">{card.owner ? personLabel(card.owner, people) : '—'}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-dim)]">Agent</dt>
                <dd className="mt-1">{card.agent_owner ? personLabel(card.agent_owner, people) : '—'}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-dim)]">Assignee</dt>
                <dd className="mt-1">{card.assignee || '—'}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-dim)]">Start / due</dt>
                <dd className={`mt-1 ${isRequirementOverdue(card) ? 'text-[var(--danger)]' : ''}`}>
                  {card.start || '—'} → {card.due || '—'}
                  {isRequirementOverdue(card) ? ' · Overdue' : ''}
                </dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-dim)]">Project</dt>
                <dd className="mt-1">{projectName || '—'}</dd>
              </div>
              <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
                <dt className="text-[11px] uppercase tracking-wide text-[var(--fg-dim)]">Participants</dt>
                <dd className="mt-1">{card.participants && card.participants.length > 0 ? card.participants.map((person) => personLabel(person, people)).join(', ') : '—'}</dd>
              </div>
            </dl>
            {card.children && card.children.total > 0 ? (
              <p className="text-sm text-[var(--fg-muted)]">{card.children.done} / {card.children.total} subtasks done</p>
            ) : null}
            {card.description ? (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-dim)]">Description</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{card.description}</p>
              </section>
            ) : null}
            {checklist.length > 0 ? (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-dim)]">Checklist</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  {checklist.map((item) => (
                    <li key={item.id || item.text} className={`rounded-xl bg-[var(--bg-elevated)] px-3 py-2 ${item.done ? 'text-[var(--fg-dim)] line-through' : ''}`}>
                      {item.done ? '✓' : '○'} {item.text}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {(card.tags && card.tags.length > 0) || (card.issues && card.issues.length > 0) ? (
              <TaskPanel className="space-y-3">
                {card.tags && card.tags.length > 0 ? (
                  <div>
                    <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-dim)]">Tags</h2>
                    <div className="mt-2"><TagList tags={card.tags} /></div>
                  </div>
                ) : null}
                {card.issues && card.issues.length > 0 ? (
                  <div>
                    <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-dim)]">Issues</h2>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {card.issues.map((issue) => (
                        <li key={`${issue.repo}#${issue.number}`}>
                          <a className="text-[var(--info)] hover:underline" href={`https://github.com/${issue.repo}/issues/${issue.number}`} target="_blank" rel="noreferrer">
                            {issue.repo}#{issue.number}{issue.title ? ` ${issue.title}` : ''}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </TaskPanel>
            ) : null}
            {card.external_url && /^https?:\/\//i.test(card.external_url) ? (
              <a href={card.external_url} className="text-sm text-[var(--info)] hover:underline" target="_blank" rel="noreferrer">{card.external_url}</a>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
