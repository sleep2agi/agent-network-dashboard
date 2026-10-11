'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PendingNotice } from '../components/PendingNotice';
import { RequirementRef } from '../components/RequirementRef';
import {
  MetaChip,
  PriorityChip,
  SectionHeading,
  Segmented,
  TagList,
  TaskCard,
  TaskPanel,
  columnDot,
  columnLabel,
} from '../components/requirement-chrome';
import { useNetworkId } from '../lib/network-context';
import { relativeAgo } from '../lib/time';
import {
  compareRequirements,
  isRequirementOverdue,
  matchesRequirementQuery,
  normalizeRequirement,
  periodFromIso,
  personLabel,
  readStats,
  scheduleBucket,
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
  start?: string;
  assignee?: string;
  tags?: string[];
  owner?: Person | null;
  agent_owner?: Person | null;
  participants?: Person[];
  projectId?: string;
  projectName?: string;
  description?: string;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  parentId?: string;
  issues?: Array<{ repo: string; number: number; title?: string }>;
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
  { id: 'schedule', label: 'Schedule' },
  { id: 'activity', label: 'Activity' },
  { id: 'dashboard', label: 'Dashboard' },
] as const;

const SCHEDULE_BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'later', label: 'Upcoming' },
  { id: 'none', label: 'No due date' },
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
  const kind = (event.kind || 'event').replace(/[_-]+/g, ' ');
  const pretty = kind.charAt(0).toUpperCase() + kind.slice(1);
  return event.field ? `${pretty} · ${event.field}` : pretty;
}

function cardOwner(card: Card, people: Person[]): string {
  if (card.owner) return personLabel(card.owner, people);
  if (card.assignee) return card.assignee;
  if (card.agent_owner) return personLabel(card.agent_owner, people);
  return '';
}

function stamp(value?: string): string {
  if (!value) return '';
  return relativeAgo(value) || value;
}

function DueText({ card }: { card: Card }) {
  if (!card.due) return null;
  const late = isRequirementOverdue(card);
  return (
    <span className={`text-[11px] tabular-nums ${late ? 'text-[var(--danger)]' : 'text-[var(--fg-dim)]'}`}>
      {late ? 'Overdue · ' : ''}{card.due}
    </span>
  );
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
  const [tag, setTag] = useState('');
  const [project, setProject] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [topLevel, setTopLevel] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(true);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [stats, setStats] = useState<DashStats | null>(null);
  const [statsNote, setStatsNote] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [period, setPeriod] = useState<PeriodId>('week');

  useEffect(() => {
    if (view !== 'board' && view !== 'list' && view !== 'schedule') return;
    let alive = true;
    const params = new URLSearchParams();
    if (networkId) params.set('network_id', networkId);
    if (status) params.set('status', status);
    const q = query.trim();
    if (q) params.set('q', q);
    if (q && includeArchived) params.set('include_archived', '1');
    if (project && project !== '__none__') params.set('project_id', project);
    params.set('view', 'full');
    params.set('limit', '200');
    const handle = window.setTimeout(() => {
      readJson(`/api/hub/requirements?${params.toString()}`)
        .then(({ status, body }) => {
          if (!alive) return;
          if (status === 401) { router.push('/login'); return; }
          const requirements = body && Array.isArray(body.requirements) ? body.requirements : null;
          const parsed = (requirements || [])
            .map((row) => normalizeRequirement(row) as Card | null)
            .filter((row): row is Card => !!row && !!row.id);
          if (body?.ok === false) {
            setError(typeof body.error === 'string' ? body.error : 'Could not load tasks');
            setCards(parsed);
            return;
          }
          const caps = body && Array.isArray(body.capabilities) ? body.capabilities : [];
          setAware(caps.includes('column_abandoned'));
          setError('');
          setCards(parsed);
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
  }, [includeArchived, networkId, project, query, router, status, view]);

  useEffect(() => {
    if (view === 'activity' || view === 'dashboard') return;
    let alive = true;
    const net = networkId ? `?network_id=${encodeURIComponent(networkId)}` : '';
    readJson(`/api/hub/requirements/projects${net}`)
      .then(({ status, body }) => {
        if (!alive || status === 401) return;
        const rows = body && Array.isArray(body.projects) ? body.projects : [];
        setProjects(rows.flatMap((row) => {
          if (!row || typeof row !== 'object') return [];
          const id = typeof row.id === 'string' ? row.id : '';
          const name = typeof row.name === 'string' ? row.name : '';
          return id && name ? [{ id, name }] : [];
        }));
      })
      .catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, [networkId, view]);

  useEffect(() => {
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
  }, [networkId, router]);

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

  const projectName = useMemo(() => {
    const names = new Map(projects.map((item) => [item.id, item.name]));
    return (id?: string) => (id ? names.get(id) || '' : '');
  }, [projects]);

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const card of cards || []) for (const item of card.tags || []) tags.add(item);
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [cards]);

  const filtered = useMemo(() => {
    return (cards || []).filter((card) => {
      if (priority && card.priority !== priority) return false;
      if (tag && !(card.tags || []).includes(tag)) return false;
      if (project === '__none__' && card.projectId) return false;
      if (project && project !== '__none__' && card.projectId !== project) return false;
      if (overdueOnly && !isRequirementOverdue(card)) return false;
      if (topLevel && card.parentId) return false;
      return matchesRequirementQuery({ ...card, projectName: projectName(card.projectId) }, query);
    }).sort(compareRequirements);
  }, [cards, overdueOnly, priority, project, projectName, query, tag, topLevel]);

  const abandonedCount = useMemo(
    () => filtered.filter((card) => card.column === 'abandoned').length,
    [filtered],
  );
  const visible = filtered.filter((card) => {
    if (!(showAbandoned || status === 'abandoned' || card.column !== 'abandoned')) return false;
    if (hideDone && status !== 'done' && card.column === 'done') return false;
    return true;
  });

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

  const topCount = Math.max(1, ...(stats?.leaders.slice(0, 8).map((leader) => leader.n || 0) ?? [1]));
  const statCards = stats
    ? [
        { label: 'Done', value: stats.done, dot: columnDot('done') },
        { label: 'In progress', value: stats.doing, dot: columnDot('doing') },
        { label: 'Pool', value: stats.pool, dot: columnDot('pool') },
        { label: 'Abandoned', value: stats.abandoned, dot: columnDot('abandoned') },
      ]
    : [];

  return (
    <main
      className="min-h-screen bg-[var(--bg)] px-4 py-6 text-[var(--fg)] sm:px-6 lg:px-10"
      style={{ backgroundImage: 'radial-gradient(ellipse 80% 40% at 50% -10%, color-mix(in srgb, var(--info) 14%, transparent), transparent 60%)' }}
    >
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--fg-dim)]">Requirements</p>
            <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
            <p className="max-w-xl text-sm leading-relaxed text-[var(--fg-muted)]">
              Requirement tasks. A title or #id opens that task.
              {aware ? ' Abandoned is a real column on this Hub.' : ''}
            </p>
          </div>
          <Segmented label="Task views" value={view} options={VIEWS} onChange={setView} />
        </header>

        <PendingNotice>
          Creating, dragging, and editing cards is not wired yet. Everything below is what the Hub returned.
        </PendingNotice>

        {(view === 'board' || view === 'list' || view === 'schedule' || view === 'activity') && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, #id, tag, or person"
              aria-label="Search tasks"
              className="h-9 w-full max-w-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:border-[var(--info)] focus:outline-none sm:w-72"
            />
            {(view === 'board' || view === 'list' || view === 'schedule') && (
              <>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Filter by column"
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm text-[var(--fg)]"
                >
                  <option value="">All columns</option>
                  {COLUMNS.map((col) => <option key={col.id} value={col.id}>{col.label}</option>)}
                </select>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  aria-label="Filter by priority"
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm text-[var(--fg)]"
                >
                  <option value="">Any priority</option>
                  {['high', 'normal', 'low', 'lowest'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  aria-label="Filter by tag"
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm text-[var(--fg)]"
                >
                  <option value="">Any tag</option>
                  {tagOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  aria-label="Filter by project"
                  className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-sm text-[var(--fg)]"
                >
                  <option value="">All projects</option>
                  <option value="__none__">No project</option>
                  {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button
                  type="button"
                  aria-pressed={overdueOnly}
                  onClick={() => setOverdueOnly((value) => !value)}
                  className={`h-9 rounded-lg border px-2.5 text-xs ${
                    overdueOnly
                      ? 'border-[var(--danger)]/40 bg-[var(--bg-elevated)] text-[var(--danger)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  Overdue
                </button>
                <button
                  type="button"
                  aria-pressed={hideDone}
                  onClick={() => setHideDone((value) => !value)}
                  className={`h-9 rounded-lg border px-2.5 text-xs ${
                    hideDone
                      ? 'border-[var(--info)] bg-[var(--bg-elevated)] text-[var(--fg)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  Hide done
                </button>
                <button
                  type="button"
                  aria-pressed={topLevel}
                  onClick={() => setTopLevel((value) => !value)}
                  className={`h-9 rounded-lg border px-2.5 text-xs ${
                    topLevel
                      ? 'border-[var(--info)] bg-[var(--bg-elevated)] text-[var(--fg)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  Top level
                </button>
              </>
            )}
            {query.trim() ? (
              <label className="flex h-9 items-center gap-1.5 px-1 text-xs text-[var(--fg-muted)]">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                />
                Include archived
              </label>
            ) : null}
            {(view === 'board' || view === 'list' || view === 'schedule') && abandonedCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAbandoned((value) => !value)}
                className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                {showAbandoned ? 'Hide abandoned' : `Show abandoned (${abandonedCount})`}
              </button>
            ) : null}
            {(query || status || priority || tag || project || overdueOnly || hideDone || topLevel) && (
              <button
                type="button"
                onClick={() => { setQuery(''); setStatus(''); setPriority(''); setTag(''); setProject(''); setOverdueOnly(false); setHideDone(false); setTopLevel(false); }}
                className="h-9 rounded-lg px-2.5 text-xs text-[var(--fg-muted)] hover:text-[var(--fg)]"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {error ? (
          <p className="rounded-xl border border-[var(--danger)]/30 bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>
        ) : null}

        {view === 'board' && (
          <>
            {cards === null ? <p className="text-sm text-[var(--fg-dim)]">Loading board…</p> : null}
            {cards !== null ? <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-4">
              {COLUMNS.filter((col) => {
                if (col.id === 'abandoned' && !(showAbandoned || status === 'abandoned')) return false;
                if (col.id === 'done' && hideDone && status !== 'done') return false;
                return true;
              }).map((col) => {
                const rows = visible.filter((card) => card.column === col.id);
                return (
                  <TaskPanel key={col.id}>
                    <div className="mb-3 flex items-center justify-between gap-2 px-1">
                      <h2 className={`flex items-center gap-2 text-sm font-medium ${col.id === 'abandoned' ? 'text-[var(--fg-dim)] line-through' : ''}`}>
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: columnDot(col.id) }} />
                        {col.label}
                      </h2>
                      <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--fg-muted)]">{rows.length}</span>
                    </div>
                    <ul className="space-y-2.5">
                      {rows.map((card) => (
                        <li key={card.id}>
                          <TaskCard className="space-y-2.5">
                            <RequirementRef
                              id={card.id}
                              seq={card.seq}
                              name={card.name}
                              struck={col.id === 'abandoned'}
                              done={col.id === 'done'}
                            />
                            <div className="flex flex-wrap items-center gap-1.5">
                              <PriorityChip priority={card.priority} />
                              <DueText card={card} />
                              {card.archived ? <MetaChip>Archived</MetaChip> : null}
                            </div>
                            {(projectName(card.projectId) || cardOwner(card, people) || (card.tags || []).length > 0) ? (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                {projectName(card.projectId) ? <span className="text-[11px] text-[var(--fg-dim)]">{projectName(card.projectId)}</span> : null}
                                {cardOwner(card, people) ? <span className="text-[11px] text-[var(--fg-muted)]">{cardOwner(card, people)}</span> : null}
                                <TagList tags={card.tags} />
                              </div>
                            ) : null}
                          </TaskCard>
                        </li>
                      ))}
                      {cards !== null && rows.length === 0 ? (
                        <li className="rounded-xl border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--fg-dim)]">None</li>
                      ) : null}
                    </ul>
                  </TaskPanel>
                );
              })}
            </div> : null}
          </>
        )}

        {view === 'list' && (
          <TaskPanel>
            {cards === null ? <p className="px-2 py-4 text-sm text-[var(--fg-dim)]">Loading list…</p> : null}
            <ul className="space-y-2.5">
              {visible.map((card) => {
                const participants = (card.participants || []).map((person) => personLabel(person, people)).filter(Boolean);
                return (
                  <li key={card.id}>
                    <TaskCard className="space-y-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <RequirementRef
                            id={card.id}
                            seq={card.seq}
                            name={card.name}
                            struck={card.column === 'abandoned'}
                            done={card.column === 'done'}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <MetaChip>{columnLabel(card.column)}</MetaChip>
                          <PriorityChip priority={card.priority} />
                          <DueText card={card} />
                          {card.archived ? <MetaChip>Archived</MetaChip> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        {projectName(card.projectId) ? <span className="text-[11px] text-[var(--fg-dim)]">{projectName(card.projectId)}</span> : null}
                        {cardOwner(card, people) ? <span className="max-w-[12rem] truncate text-xs text-[var(--fg-muted)]">{cardOwner(card, people)}</span> : null}
                        {participants.length > 0 ? <span className="max-w-[16rem] truncate text-[11px] text-[var(--fg-muted)]">{participants.join(', ')}</span> : null}
                        {card.createdAt ? <span className="text-[11px] tabular-nums text-[var(--fg-dim)]">Created {stamp(card.createdAt)}</span> : null}
                        {card.updatedAt ? <span className="text-[11px] tabular-nums text-[var(--fg-dim)]">Updated {stamp(card.updatedAt)}</span> : null}
                        <TagList tags={card.tags} />
                        {(card.issues || []).map((issue) => (
                          <a
                            key={`${issue.repo}#${issue.number}`}
                            className="text-[11px] text-[var(--info)] hover:underline"
                            href={`https://github.com/${issue.repo}/issues/${issue.number}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {issue.repo}#{issue.number}
                          </a>
                        ))}
                      </div>
                    </TaskCard>
                  </li>
                );
              })}
            </ul>
            {cards !== null && visible.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-[var(--fg-dim)]">No tasks match.</p>
            ) : null}
          </TaskPanel>
        )}

        {view === 'schedule' && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--fg-muted)]">
              Due dates on requirement tasks. Agent dispatch schedules stay on <Link href="/scheduled-tasks" className="text-[var(--info)] hover:underline">Scheduled tasks</Link>.
            </p>
            {cards === null ? <p className="text-sm text-[var(--fg-dim)]">Loading schedule…</p> : null}
            {SCHEDULE_BUCKETS.map((bucket) => {
              const rows = visible.filter((card) => scheduleBucket(card) === bucket.id);
              if (cards !== null && rows.length === 0) return null;
              return (
                <TaskPanel key={bucket.id}>
                  <SectionHeading title={bucket.label} hint={cards === null ? undefined : String(rows.length)} />
                  <ul className="space-y-2">
                    {rows.map((card) => (
                      <li key={card.id}>
                        <TaskCard className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <div className="min-w-0 flex-1">
                            <RequirementRef
                              id={card.id}
                              seq={card.seq}
                              name={card.name}
                              struck={card.column === 'abandoned'}
                              done={card.column === 'done'}
                            />
                          </div>
                          <MetaChip>{columnLabel(card.column)}</MetaChip>
                          <DueText card={card} />
                          {cardOwner(card, people) ? <span className="text-xs text-[var(--fg-muted)]">{cardOwner(card, people)}</span> : null}
                          <TagList tags={card.tags} />
                        </TaskCard>
                      </li>
                    ))}
                  </ul>
                </TaskPanel>
              );
            })}
            {cards !== null && visible.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-[var(--fg-dim)]">No tasks match.</p>
            ) : null}
          </div>
        )}

        {view === 'activity' && (
          <TaskPanel>
            {events === null ? <p className="px-2 py-4 text-sm text-[var(--fg-dim)]">Loading activity…</p> : null}
            <ul className="space-y-2">
              {activityRows.map((event) => (
                <li key={event.id}>
                  <TaskCard className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-[12rem] flex-1">
                      {event.requirement_id ? (
                        <RequirementRef id={event.requirement_id} seq={event.seq} name={event.title || undefined} />
                      ) : (
                        <span className="text-[13px] font-medium text-[var(--fg-dim)]">{event.title || 'Task'}</span>
                      )}
                    </div>
                    <span className="text-sm font-medium text-[var(--fg)]">{personLabel(event.actor, people)}</span>
                    <MetaChip soft>{eventSummary(event)}</MetaChip>
                    <span className="text-xs tabular-nums text-[var(--fg-dim)]">{relativeAgo(event.at) || ''}</span>
                  </TaskCard>
                </li>
              ))}
            </ul>
            {events !== null && activityRows.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-[var(--fg-dim)]">No recent activity.</p>
            ) : null}
          </TaskPanel>
        )}

        {view === 'dashboard' && (
          <div className="space-y-4">
            <Segmented label="Completion period" value={period} options={PERIODS} onChange={setPeriod} />
            {statsNote ? <p className="text-sm text-[var(--fg-muted)]">{statsNote}</p> : null}
            {stats ? (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {statCards.map((card) => (
                    <div key={card.label} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-4">
                      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-dim)]">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: card.dot }} />
                        {card.label}
                      </div>
                      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{card.value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <TaskPanel>
                    <SectionHeading title="Recent completions" hint={String(stats.recent.length)} />
                    <ul className="space-y-2">
                      {stats.recent.map((row) => (
                        <li key={row.id}>
                          <TaskCard className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <RequirementRef id={row.id} seq={row.seq} name={row.name} done />
                            </div>
                            <span className="shrink-0 text-sm text-[var(--fg-muted)]">
                              {personLabel(row.completed_by, people)}
                            </span>
                          </TaskCard>
                        </li>
                      ))}
                      {stats.recent.length === 0 ? <li className="px-2 py-6 text-sm text-[var(--fg-dim)]">Nothing completed in this period.</li> : null}
                    </ul>
                  </TaskPanel>
                  <TaskPanel>
                    <SectionHeading title="Leaderboard" hint={stats.leaders.length ? `Top ${Math.min(8, stats.leaders.length)}` : undefined} />
                    <ul className="space-y-2">
                      {stats.leaders.slice(0, 8).map((leader, index) => {
                        const count = leader.n ?? 0;
                        const width = Math.max(8, Math.round((count / topCount) * 100));
                        return (
                          <li key={`${leader.kind || 'x'}:${leader.id || index}`}>
                            <TaskCard className="flex items-center gap-3">
                              <span
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums ${
                                  index < 3 ? 'bg-[var(--bg)] text-[var(--fg)]' : 'text-[var(--fg-dim)]'
                                }`}
                              >
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{personLabel(leader, people)}</div>
                                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--bg)]">
                                  <div className="h-full rounded-full bg-[var(--info)]" style={{ width: `${width}%` }} />
                                </div>
                              </div>
                              <MetaChip>{leader.kind === 'node' ? 'Agent' : 'Member'}</MetaChip>
                              <span className="w-8 text-right text-sm font-semibold tabular-nums">{count}</span>
                            </TaskCard>
                          </li>
                        );
                      })}
                      {stats.leaders.length === 0 ? <li className="px-2 py-6 text-sm text-[var(--fg-dim)]">No completions to rank.</li> : null}
                    </ul>
                  </TaskPanel>
                </div>
                {stats.daily.length > 0 ? (
                  <TaskPanel>
                    <SectionHeading title="Last 14 days" />
                    <div className="mt-2 flex h-28 items-end gap-1.5 rounded-xl bg-[var(--bg)] px-3 py-3">
                      {stats.daily.slice(-14).map((day) => (
                        <div key={day.date} className="flex h-full flex-1 items-end" title={`${day.date}: ${day.n || 0}`}>
                          <div
                            className="w-full rounded-md bg-[var(--info)]"
                            style={{ height: `${Math.max(8, ((day.n || 0) / maxDaily) * 100)}%`, opacity: 0.35 + 0.65 * ((day.n || 0) / maxDaily) }}
                          />
                        </div>
                      ))}
                    </div>
                  </TaskPanel>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        <p className="text-xs text-[var(--fg-dim)]">
          Message tasks between agents stay on <Link href="/tasks" className="text-[var(--info)] hover:underline">Tasks</Link>.
        </p>
      </div>
    </main>
  );
}
