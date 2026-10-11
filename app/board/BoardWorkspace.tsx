'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PendingNotice } from '../components/PendingNotice';
import { RequirementRef } from '../components/RequirementRef';
import { useNetworkId } from '../lib/network-context';
import { relativeAgo } from '../lib/time';
import {
  matchesRequirementQuery,
  periodFromIso,
  personLabel,
  readStats,
} from '../lib/requirement-links.mjs';

type DashStats = {
  done: number;
  doing: number;
  pool: number;
  abandoned: number;
  leaders: Array<{ kind?: string; id?: string; n?: number; display_name?: string; name?: string; alias?: string }>;
  recent: Array<{ id: string; seq?: number | null; name?: string; completed_by?: { kind?: string; id?: string; display_name?: string; name?: string; alias?: string } | null }>;
  daily: Array<{ date: string; n?: number }>;
};

type Card = {
  id: string;
  seq?: number | null;
  name?: string;
  column?: string;
  priority?: string;
  due?: string;
  assignee?: string;
};

type Person = {
  kind?: string;
  id?: string;
  name?: string;
  display_name?: string;
  alias?: string;
};

type ActivityEvent = {
  id: string;
  requirement_id?: string;
  seq?: number | null;
  title?: string | null;
  actor?: Person | null;
  kind?: string;
  field?: string | null;
  at?: string;
};

const COLUMNS = [
  { id: 'pool', label: 'Pool' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
  { id: 'abandoned', label: 'Abandoned' },
] as const;

const VIEWS = [
  { id: 'board', label: 'Board' },
  { id: 'list', label: 'List' },
  { id: 'activity', label: 'Activity' },
  { id: 'dashboard', label: 'Dashboard' },
] as const;

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
] as const;

type ViewId = (typeof VIEWS)[number]['id'];
type PeriodId = (typeof PERIODS)[number]['id'];

function viewFrom(raw: string | null): ViewId {
  return VIEWS.some((view) => view.id === raw) ? raw as ViewId : 'board';
}

async function readJson(url: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body && typeof body === 'object' ? body as Record<string, unknown> : null };
}

function eventSummary(event: ActivityEvent): string {
  const kind = event.kind || 'event';
  return event.field ? `${kind} · ${event.field}` : kind;
}

export function BoardWorkspace() {
  const { networkId } = useNetworkId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = viewFrom(searchParams.get('view'));
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState('');
  const [aware, setAware] = useState(false);
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [priority, setPriority] = useState('');
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [stats, setStats] = useState<DashStats | null>(null);
  const [statsNote, setStatsNote] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [period, setPeriod] = useState<PeriodId>('week');

  useEffect(() => {
    if (view !== 'board' && view !== 'list') return;
    let alive = true;
    const params = new URLSearchParams();
    if (networkId) params.set('network_id', networkId);
    if (status) params.set('status', status);
    const q = query.trim();
    if (q) params.set('q', q);
    params.set('limit', '200');
    const handle = window.setTimeout(() => {
      readJson(`/api/hub/requirements?${params.toString()}`)
        .then(({ status, body }) => {
          if (!alive) return;
          if (status === 401) { router.push('/login'); return; }
          const requirements = body && Array.isArray(body.requirements) ? body.requirements as Card[] : null;
          if (body?.ok === false) {
            setError(typeof body.error === 'string' ? body.error : 'Could not load tasks');
            setCards((requirements || []).filter((row) => row && row.id));
            return;
          }
          const caps = body && Array.isArray(body.capabilities) ? body.capabilities : [];
          setAware(caps.includes('column_abandoned'));
          setError('');
          setCards((requirements || []).filter((row) => row && row.id));
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setError(e instanceof Error ? e.message : 'Could not load tasks');
          setCards([]);
        });
    }, q ? 250 : 0);
    return () => {
      alive = false;
      window.clearTimeout(handle);
    };
  }, [networkId, query, router, status, view]);

  useEffect(() => {
    if (view !== 'activity' && view !== 'dashboard') return;
    let alive = true;
    const net = networkId ? `network_id=${encodeURIComponent(networkId)}&` : '';
    readJson(`/api/hub/requirements/people?${net}`)
      .then(({ status, body }) => {
        if (!alive) return;
        if (status === 401) { router.push('/login'); return; }
        setPeople(body && Array.isArray(body.people) ? body.people as Person[] : []);
      })
      .catch(() => {
        if (alive) setPeople([]);
      });
    return () => { alive = false; };
  }, [networkId, router, view]);

  useEffect(() => {
    if (view !== 'activity') return;
    let alive = true;
    const params = new URLSearchParams();
    if (networkId) params.set('network_id', networkId);
    params.set('limit', '50');
    readJson(`/api/hub/requirements/events?${params.toString()}`)
      .then(({ status, body }) => {
        if (!alive) return;
        if (status === 401) { router.push('/login'); return; }
        const rows = body && Array.isArray(body.events) ? body.events as ActivityEvent[] : null;
        if (body?.ok === false) {
          setError(typeof body.error === 'string' ? body.error : 'Could not load activity');
          setEvents(rows || []);
          return;
        }
        setError('');
        setEvents(rows || []);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : 'Could not load activity');
        setEvents([]);
      });
    return () => { alive = false; };
  }, [networkId, router, view]);

  useEffect(() => {
    if (view !== 'dashboard') return;
    let alive = true;
    const params = new URLSearchParams();
    if (networkId) params.set('network_id', networkId);
    const from = periodFromIso(period, Date.now());
    if (from) params.set('from', from);
    try {
      params.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    } catch {
      params.set('tz', 'UTC');
    }
    params.set('days', '30');
    params.set('recent', '12');
    readJson(`/api/hub/requirements/stats?${params.toString()}`)
      .then(({ status, body }) => {
        if (!alive) return;
        if (status === 401) { router.push('/login'); return; }
        const parsed = readStats(body) as DashStats | null;
        if (!parsed) {
          setStats(null);
          setStatsNote(typeof body?.error === 'string' ? body.error : 'This Hub has no completion stats yet.');
          return;
        }
        setStats(parsed);
        setStatsNote('');
        setError('');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setStats(null);
        setStatsNote(e instanceof Error ? e.message : 'Could not load the dashboard');
      });
    return () => { alive = false; };
  }, [networkId, period, router, view]);

  const filtered = useMemo(() => {
    return (cards || []).filter((card) => {
      if (priority && card.priority !== priority) return false;
      return matchesRequirementQuery(card, query);
    });
  }, [cards, priority, query]);

  const abandonedCount = useMemo(
    () => filtered.filter((card) => card.column === 'abandoned').length,
    [filtered],
  );
  const visible = filtered.filter((card) => showAbandoned || status === 'abandoned' || card.column !== 'abandoned');

  const setView = (next: ViewId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'board') params.delete('view');
    else params.set('view', next);
    const qs = params.toString();
    router.push(qs ? `/board?${qs}` : '/board');
  };

  const activityRows = (events || []).filter((event) => matchesRequirementQuery(
    { id: event.requirement_id, name: event.title || '', seq: event.seq },
    query,
  ));
  const maxDaily = Math.max(1, ...(stats?.daily.slice(-14).map((day) => day.n || 0) ?? [1]));

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-5 text-[var(--fg)] sm:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Board</h1>
            <p className="text-xs text-[var(--fg-muted)]">
              Requirement tasks. A title or #id opens that task.
              {aware ? ' Abandoned is a real column on this Hub.' : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-1">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  view === item.id
                    ? 'bg-cyan-500/15 text-cyan-300'
                    : 'text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <PendingNotice>
          Creating, dragging, and editing cards is not wired yet. Everything below is what the Hub returned.
        </PendingNotice>

        {(view === 'board' || view === 'list' || view === 'activity') && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title or #id"
              aria-label="Search tasks"
              className="w-56 max-w-full rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 text-xs text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:border-cyan-500/40 focus:outline-none"
            />
            {(view === 'board' || view === 'list') && (
              <>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Filter by column"
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--fg)]"
                >
                  <option value="">All columns</option>
                  {COLUMNS.map((col) => <option key={col.id} value={col.id}>{col.label}</option>)}
                </select>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  aria-label="Filter by priority"
                  className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs text-[var(--fg)]"
                >
                  <option value="">Any priority</option>
                  {['high', 'normal', 'low', 'lowest'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </>
            )}
            {(query || status || priority) && (
              <button
                type="button"
                onClick={() => { setQuery(''); setStatus(''); setPriority(''); }}
                className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {error ? <p className="text-xs text-red-300">{error}</p> : null}

        {view === 'board' && (
          <>
            {cards === null ? <p className="text-xs text-[var(--fg-dim)]">Loading board…</p> : null}
            {abandonedCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAbandoned((value) => !value)}
                className="text-xs text-[var(--fg-muted)] underline"
              >
                {showAbandoned ? 'Hide abandoned' : `Show abandoned (${abandonedCount})`}
              </button>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {COLUMNS.filter((col) => col.id !== 'abandoned' || showAbandoned || status === 'abandoned').map((col) => {
                const rows = visible.filter((card) => card.column === col.id);
                return (
                  <section key={col.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
                    <h2 className={`text-xs font-medium ${col.id === 'abandoned' ? 'text-[var(--fg-dim)] line-through' : ''}`}>
                      {col.label} · {rows.length}
                    </h2>
                    <ul className="mt-2 space-y-2">
                      {rows.map((card) => (
                        <li key={card.id} className="rounded-md border border-[var(--border)] px-2 py-1.5 hover:border-cyan-500/30">
                          <RequirementRef
                            id={card.id}
                            seq={card.seq}
                            name={card.name}
                            struck={col.id === 'abandoned'}
                            done={col.id === 'done'}
                          />
                          {card.priority ? <div className="mt-1 text-[10px] text-[var(--fg-dim)]">{card.priority}</div> : null}
                        </li>
                      ))}
                      {cards !== null && rows.length === 0 ? (
                        <li className="px-1 py-2 text-[11px] text-[var(--fg-dim)]">None</li>
                      ) : null}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}

        {view === 'list' && (
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            {cards === null ? <p className="px-3 py-4 text-xs text-[var(--fg-dim)]">Loading list…</p> : null}
            <ul className="divide-y divide-[var(--border)]">
              {visible.map((card) => (
                <li key={card.id} className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-elevated)]">
                  <div className="min-w-0 flex-1">
                    <RequirementRef
                      id={card.id}
                      seq={card.seq}
                      name={card.name}
                      struck={card.column === 'abandoned'}
                      done={card.column === 'done'}
                    />
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--fg-dim)]">{card.column || '—'}</span>
                  <span className="w-14 shrink-0 text-right text-[10px] text-[var(--fg-dim)]">{card.priority || ''}</span>
                </li>
              ))}
            </ul>
            {cards !== null && visible.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--fg-dim)]">No tasks match.</p>
            ) : null}
          </section>
        )}

        {view === 'activity' && (
          <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            {events === null ? <p className="px-3 py-4 text-xs text-[var(--fg-dim)]">Loading activity…</p> : null}
            <ul className="divide-y divide-[var(--border)]">
              {activityRows.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {event.requirement_id ? (
                      <RequirementRef id={event.requirement_id} seq={event.seq} name={event.title || undefined} />
                    ) : (
                      <span className="text-xs text-[var(--fg-dim)]">{event.title || 'Task'}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-[var(--fg-muted)]">{personLabel(event.actor, people)}</span>
                  <span className="text-[11px] text-[var(--fg-dim)]">{eventSummary(event)}</span>
                  <span className="text-[11px] tabular-nums text-[var(--fg-dim)]">{relativeAgo(event.at) || ''}</span>
                </li>
              ))}
            </ul>
            {events !== null && activityRows.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--fg-dim)]">No recent activity.</p>
            ) : null}
          </section>
        )}

        {view === 'dashboard' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1">
              {PERIODS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPeriod(item.id)}
                  className={`rounded-md px-2.5 py-1 text-xs ${
                    period === item.id ? 'bg-cyan-500/15 text-cyan-300' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {statsNote ? <p className="text-xs text-[var(--fg-muted)]">{statsNote}</p> : null}
            {stats ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    ['Done', stats.done],
                    ['In progress', stats.doing],
                    ['Pool', stats.pool],
                    ['Abandoned', stats.abandoned],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-3">
                      <div className="text-[11px] text-[var(--fg-dim)]">{label}</div>
                      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
                    <h2 className="text-xs font-medium">Recent completions</h2>
                    <ul className="mt-2 divide-y divide-[var(--border)]">
                      {stats.recent.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                          <RequirementRef id={row.id} seq={row.seq} name={row.name} done />
                          <span className="shrink-0 text-[11px] text-[var(--fg-muted)]">
                            {personLabel(row.completed_by, people)}
                          </span>
                        </li>
                      ))}
                      {stats.recent.length === 0 ? <li className="py-3 text-xs text-[var(--fg-dim)]">Nothing completed in this period.</li> : null}
                    </ul>
                  </section>
                  <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
                    <h2 className="text-xs font-medium">Leaderboard</h2>
                    <ul className="mt-2 space-y-2">
                      {stats.leaders.slice(0, 8).map((leader, index) => (
                        <li key={`${leader.kind || 'x'}:${leader.id || index}`} className="flex items-center gap-2 text-xs">
                          <span className="w-4 tabular-nums text-[var(--fg-dim)]">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{personLabel(leader, people)}</span>
                          <span className="text-[10px] text-[var(--fg-dim)]">{leader.kind === 'node' ? 'Agent' : 'Member'}</span>
                          <span className="w-8 text-right tabular-nums">{leader.n ?? 0}</span>
                        </li>
                      ))}
                      {stats.leaders.length === 0 ? <li className="text-xs text-[var(--fg-dim)]">No completions to rank.</li> : null}
                    </ul>
                  </section>
                </div>
                {stats.daily.length > 0 ? (
                  <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
                    <h2 className="text-xs font-medium">Last 14 days</h2>
                    <div className="mt-3 flex h-24 items-end gap-1">
                      {stats.daily.slice(-14).map((day) => (
                        <div key={day.date} className="flex h-full flex-1 items-end" title={`${day.date}: ${day.n || 0}`}>
                          <div
                            className="w-full rounded-sm bg-cyan-400/70"
                            style={{ height: `${Math.max(4, ((day.n || 0) / maxDaily) * 100)}%` }}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        <p className="text-[11px] text-[var(--fg-dim)]">
          Message tasks between agents stay on <Link href="/tasks" className="text-cyan-400 hover:underline">Tasks</Link>.
        </p>
      </div>
    </main>
  );
}
