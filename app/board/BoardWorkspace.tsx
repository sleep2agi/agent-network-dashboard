'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AliasAvatar } from '../components/AliasAvatar';
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
  leaders: Array<{ kind?: string; id?: string; n?: number; spark?: number[]; display_name?: string; name?: string; alias?: string }>;
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

function dashboardIsEmpty(stats: DashStats): boolean {
  return stats.done === 0 && stats.doing === 0 && stats.pool === 0 && stats.abandoned === 0
    && stats.recent.length === 0 && stats.leaders.length === 0;
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
  const [statsAttempt, setStatsAttempt] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [period, setPeriod] = useState<PeriodId>('week');
  const [leaderKind, setLeaderKind] = useState<'all' | 'user' | 'node'>('all');

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
  }, [networkId, period, router, statsAttempt, view]);

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

  const openColumn = (column: string) => {
    setStatus(column);
    if (column === 'abandoned') setShowAbandoned(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('view');
    params.set('status', column);
    const qs = params.toString();
    router.push(qs ? `/board?${qs}` : '/board');
  };

  return (
    <main className="anet-page min-h-screen min-w-0 overflow-x-hidden bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto min-w-0 max-w-[1200px] space-y-6 xl:max-w-[1360px]">
        <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold leading-7">Board</h1>
              <PendingNotice>
                Creating, dragging, and editing cards is not wired yet. Everything below is what the Hub returned.
              </PendingNotice>
            </div>
            <p className="max-w-xl text-xs leading-4 text-[var(--fg-dim)]">
              Requirement tasks. A title or #id opens that task.
              {aware ? ' Abandoned is a real column on this Hub.' : ''}
            </p>
          </div>
          <div className="min-w-0 max-w-full">
            <Segmented label="Task views" value={view} options={VIEWS} onChange={setView} />
          </div>
        </header>

        {(view === 'board' || view === 'list' || view === 'schedule' || view === 'activity') && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, #id, tag, or person"
              aria-label="Search tasks"
              className="h-9 w-full max-w-xs rounded-[10px] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--fg)] shadow-[var(--ds-shadow-card)] placeholder:text-[var(--fg-dim)] focus:shadow-[var(--focus-ring)] focus:outline-none sm:w-72"
            />
            {(view === 'board' || view === 'list' || view === 'schedule') && (
              <>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Filter by column"
                  className="h-9 rounded-[10px] bg-[var(--bg-secondary)] px-2.5 text-sm text-[var(--fg)] shadow-[var(--ds-shadow-card)] focus:shadow-[var(--focus-ring)] focus:outline-none"
                >
                  <option value="">All columns</option>
                  {COLUMNS.map((col) => <option key={col.id} value={col.id}>{col.label}</option>)}
                </select>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  aria-label="Filter by priority"
                  className="h-9 rounded-[10px] bg-[var(--bg-secondary)] px-2.5 text-sm text-[var(--fg)] shadow-[var(--ds-shadow-card)] focus:shadow-[var(--focus-ring)] focus:outline-none"
                >
                  <option value="">Any priority</option>
                  {['high', 'normal', 'low', 'lowest'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  aria-label="Filter by tag"
                  className="h-9 rounded-[10px] bg-[var(--bg-secondary)] px-2.5 text-sm text-[var(--fg)] shadow-[var(--ds-shadow-card)] focus:shadow-[var(--focus-ring)] focus:outline-none"
                >
                  <option value="">Any tag</option>
                  {tagOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  aria-label="Filter by project"
                  className="h-9 rounded-[10px] bg-[var(--bg-secondary)] px-2.5 text-sm text-[var(--fg)] shadow-[var(--ds-shadow-card)] focus:shadow-[var(--focus-ring)] focus:outline-none"
                >
                  <option value="">All projects</option>
                  <option value="__none__">No project</option>
                  {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <button
                  type="button"
                  aria-pressed={overdueOnly}
                  onClick={() => setOverdueOnly((value) => !value)}
                  className={`h-9 rounded-[10px] px-3 text-[13px] font-medium shadow-[var(--ds-shadow-card)] ${
                    overdueOnly
                      ? 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  Overdue
                </button>
                <button
                  type="button"
                  aria-pressed={hideDone}
                  onClick={() => setHideDone((value) => !value)}
                  className={`h-9 rounded-[10px] px-3 text-[13px] font-medium shadow-[var(--ds-shadow-card)] ${
                    hideDone
                      ? 'bg-[var(--accent-tonal)] text-[var(--accent)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  Hide done
                </button>
                <button
                  type="button"
                  aria-pressed={topLevel}
                  onClick={() => setTopLevel((value) => !value)}
                  className={`h-9 rounded-[10px] px-3 text-[13px] font-medium shadow-[var(--ds-shadow-card)] ${
                    topLevel
                      ? 'bg-[var(--accent-tonal)] text-[var(--accent)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
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
                className="h-9 rounded-[10px] bg-[var(--bg-secondary)] px-3 text-[13px] font-medium text-[var(--fg-muted)] shadow-[var(--ds-shadow-card)] hover:text-[var(--fg)]"
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
          <p className="text-sm text-[var(--error)]">{error}</p>
        ) : null}

        {view === 'board' && (
          <>
            {cards === null ? <p className="text-sm text-[var(--fg-dim)]">Loading board…</p> : null}
            {cards !== null ? <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
              {COLUMNS.filter((col) => {
                if (col.id === 'abandoned' && !(showAbandoned || status === 'abandoned')) return false;
                if (col.id === 'done' && hideDone && status !== 'done') return false;
                return true;
              }).map((col) => {
                const rows = visible.filter((card) => card.column === col.id);
                return (
                  <section key={col.id} className="w-[85vw] shrink-0 snap-start md:w-auto">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h2 className={`flex items-center gap-2 text-[15px] font-semibold leading-[22px] ${col.id === 'abandoned' ? 'text-[var(--fg-dim)] line-through' : ''}`}>
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: columnDot(col.id) }} />
                        {col.label}
                      </h2>
                      <span className="text-xs tabular-nums text-[var(--fg-dim)]">{rows.length}</span>
                    </div>
                    <ul className="space-y-2">
                      {rows.map((card) => (
                        <li key={card.id}>
                          <TaskCard className="space-y-2">
                            <RequirementRef
                              id={card.id}
                              seq={card.seq}
                              name={card.name}
                              struck={col.id === 'abandoned'}
                              done={col.id === 'done'}
                              lines={2}
                            />
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--fg-dim)]">
                              <PriorityChip priority={card.priority} />
                              <DueText card={card} />
                              {card.archived ? <MetaChip>Archived</MetaChip> : null}
                              {cardOwner(card, people) ? <span className="ml-auto max-w-[8rem] truncate text-[var(--fg-muted)]">{cardOwner(card, people)}</span> : null}
                            </div>
                            {(projectName(card.projectId) || (card.tags || []).length > 0) ? (
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                {projectName(card.projectId) ? <span className="text-[11px] text-[var(--fg-dim)]">{projectName(card.projectId)}</span> : null}
                                <TagList tags={card.tags} />
                              </div>
                            ) : null}
                          </TaskCard>
                        </li>
                      ))}
                      {cards !== null && rows.length === 0 ? (
                        <li className="px-1 py-6 text-center text-xs text-[var(--fg-dim)]">None</li>
                      ) : null}
                    </ul>
                  </section>
                );
              })}
            </div> : null}
          </>
        )}

        {view === 'list' && (
          <TaskPanel>
            {cards === null ? <p className="px-2 py-4 text-sm text-[var(--fg-dim)]">Loading list…</p> : null}
            <ul>
              {visible.map((card) => {
                const participants = (card.participants || []).map((person) => personLabel(person, people)).filter(Boolean);
                return (
                  <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--border)] px-1 py-2.5 first:border-t-0 hover:bg-[var(--bg-elevated)]">
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
                    <PriorityChip priority={card.priority} />
                    <DueText card={card} />
                    {card.archived ? <MetaChip>Archived</MetaChip> : null}
                    {cardOwner(card, people) ? <span className="max-w-[12rem] truncate text-xs text-[var(--fg-dim)]">{cardOwner(card, people)}</span> : null}
                    {participants.length > 0 ? <span className="max-w-[16rem] truncate text-[11px] text-[var(--fg-dim)]">{participants.join(', ')}</span> : null}
                    {projectName(card.projectId) ? <span className="text-[11px] text-[var(--fg-dim)]">{projectName(card.projectId)}</span> : null}
                    {card.updatedAt ? <span className="text-[11px] tabular-nums text-[var(--fg-dim)]">{stamp(card.updatedAt)}</span> : null}
                    <TagList tags={card.tags} />
                    {(card.issues || []).map((issue) => (
                      <a
                        key={`${issue.repo}#${issue.number}`}
                        className="text-[11px] text-[var(--fg)] hover:text-[var(--accent)] hover:underline"
                        href={`https://github.com/${issue.repo}/issues/${issue.number}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {issue.repo}#{issue.number}
                      </a>
                    ))}
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
              Due dates on requirement tasks. Agent dispatch schedules stay on <Link href="/scheduled-tasks" className="text-[var(--fg)] hover:text-[var(--accent)] hover:underline">Scheduled tasks</Link>.
            </p>
            {cards === null ? <p className="text-sm text-[var(--fg-dim)]">Loading schedule…</p> : null}
            {SCHEDULE_BUCKETS.map((bucket) => {
              const rows = visible.filter((card) => scheduleBucket(card) === bucket.id);
              if (cards !== null && rows.length === 0) return null;
              return (
                <TaskPanel key={bucket.id}>
                  <SectionHeading title={bucket.label} hint={cards === null ? undefined : String(rows.length)} />
                  <ul>
                    {rows.map((card) => (
                      <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--border)] px-1 py-2.5 first:border-t-0 hover:bg-[var(--bg-elevated)]">
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
                        {cardOwner(card, people) ? <span className="text-xs text-[var(--fg-dim)]">{cardOwner(card, people)}</span> : null}
                        <TagList tags={card.tags} />
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
            <ul>
              {activityRows.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--border)] px-1 py-2.5 first:border-t-0 hover:bg-[var(--bg-elevated)]">
                  <div className="min-w-[12rem] flex-1">
                    {event.requirement_id ? (
                      <RequirementRef id={event.requirement_id} seq={event.seq} name={event.title || undefined} />
                    ) : (
                      <span className="text-sm font-medium text-[var(--fg)]">{event.title || 'Task'}</span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--fg-dim)]">{personLabel(event.actor, people)}</span>
                  <MetaChip soft>{eventSummary(event)}</MetaChip>
                  <span className="text-xs tabular-nums text-[var(--fg-dim)]">{relativeAgo(event.at) || ''}</span>
                </li>
              ))}
            </ul>
            {events !== null && activityRows.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-[var(--fg-dim)]">No recent activity.</p>
            ) : null}
          </TaskPanel>
        )}

        {view === 'dashboard' && (
          <div className="min-w-0 space-y-6">
            <Segmented label="Completion period" value={period} options={PERIODS} onChange={setPeriod} />
            {!stats && statsNote ? (
              <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
                <svg aria-hidden className="h-6 w-6 text-[var(--error)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v5" strokeLinecap="round" />
                  <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
                </svg>
                <p className="max-w-sm text-sm text-[var(--fg)]">{statsNote}</p>
                <button
                  type="button"
                  onClick={() => { setStatsNote(''); setStatsAttempt((n) => n + 1); }}
                  className="inline-flex h-8 items-center rounded-[10px] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--fg)]"
                >
                  重试
                </button>
              </div>
            ) : null}
            {!stats && !statsNote ? (
              <div
                aria-hidden
                className="space-y-4 opacity-0"
                style={{ animation: 'anet-skeleton-reveal 1ms linear 300ms forwards' }}
              >
                <div className="anet-skeleton-pulse grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div className="col-span-2 h-28 rounded-[10px] bg-[var(--bg-elevated)]" />
                  <div className="h-28 rounded-[10px] bg-[var(--bg-elevated)]" />
                  <div className="h-28 rounded-[10px] bg-[var(--bg-elevated)]" />
                </div>
                <div className="anet-skeleton-pulse grid gap-4 lg:grid-cols-12">
                  <div className="h-64 rounded-[10px] bg-[var(--bg-elevated)] lg:col-span-8" />
                  <div className="h-64 rounded-[10px] bg-[var(--bg-elevated)] lg:col-span-4" />
                </div>
              </div>
            ) : null}
            {stats && dashboardIsEmpty(stats) ? (
              <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
                <svg aria-hidden className="h-6 w-6 text-[var(--fg-dim)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <rect x="4" y="5" width="16" height="14" rx="2" />
                  <path d="M8 10h8M8 14h5" strokeLinecap="round" />
                </svg>
                <p className="text-sm text-[var(--fg)]">这段时间还没有任务</p>
                <Link href="/board" className="inline-flex h-8 items-center rounded-[10px] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--fg)]">
                  打开看板
                </Link>
              </div>
            ) : null}
            {stats && !dashboardIsEmpty(stats) ? (
              <>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <div className="col-span-2 rounded-[10px] bg-[var(--bg-secondary)] p-4 shadow-[var(--ds-shadow-card)] transition-colors hover:bg-[var(--bg-elevated)]">
                    <button
                      type="button"
                      onClick={() => openColumn('done')}
                      className="w-full text-left transition-colors hover:opacity-90"
                    >
                      <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--fg-muted)]">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: 'var(--success)' }} />
                        完成
                      </div>
                      <div className="mt-2 text-[32px] font-semibold leading-[38px] tabular-nums">{stats.done}</div>
                    </button>
                    {stats.abandoned > 0 ? (
                      <button
                        type="button"
                        onClick={() => openColumn('abandoned')}
                        className="mt-2 text-xs text-[var(--fg-dim)] hover:text-[var(--fg)]"
                      >
                        另有 {stats.abandoned} 个已废弃
                      </button>
                    ) : null}
                  </div>
                  {([
                    { id: 'doing', label: '进行中', value: stats.doing, dot: 'var(--info)' },
                    { id: 'pool', label: '需求池', value: stats.pool, dot: 'var(--offline)' },
                  ] as const).map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => openColumn(card.id)}
                      className="rounded-[10px] bg-[var(--bg-secondary)] p-4 text-left shadow-[var(--ds-shadow-card)] transition-colors hover:bg-[var(--bg-elevated)]"
                    >
                      <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--fg-muted)]">
                        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: card.dot }} />
                        {card.label}
                      </div>
                      <div className="mt-2 text-[24px] font-semibold leading-8 tabular-nums">{card.value}</div>
                    </button>
                  ))}
                </div>
                <div className="grid min-w-0 gap-4 lg:grid-cols-12">
                  <TaskPanel className="min-w-0 lg:col-span-8">
                    <SectionHeading title="Recent completions" hint={String(Math.min(8, stats.recent.length))} />
                    <ul className="space-y-1">
                      {stats.recent.slice(0, 8).map((row) => (
                        <li key={row.id} className="flex h-11 min-w-0 items-center gap-2 overflow-hidden rounded-[10px] bg-[var(--bg-elevated)] px-2">
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <RequirementRef id={row.id} seq={row.seq} name={row.name} done />
                          </div>
                          <span className="max-w-[38%] shrink-0 truncate text-xs text-[var(--fg-dim)]">
                            {personLabel(row.completed_by, people)}
                          </span>
                        </li>
                      ))}
                      {stats.recent.length === 0 ? <li className="px-1 py-6 text-sm text-[var(--fg-dim)]">Nothing completed in this period.</li> : null}
                    </ul>
                    {stats.recent.length > 8 ? (
                      <button type="button" onClick={() => openColumn('done')} className="mt-2 text-xs text-[var(--fg-muted)] hover:text-[var(--accent)] hover:underline">
                        查看全部 →
                      </button>
                    ) : null}
                  </TaskPanel>
                  <TaskPanel className="min-w-0 lg:col-span-4">
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <SectionHeading title="Leaderboard" />
                      <div className="min-w-0 max-w-full">
                        <Segmented
                          label="Leaderboard filter"
                          value={leaderKind}
                          options={[{ id: 'all', label: '全部' }, { id: 'user', label: '人' }, { id: 'node', label: 'Agent' }]}
                          onChange={setLeaderKind}
                        />
                      </div>
                    </div>
                    <ul className="space-y-1">
                      {stats.leaders
                        .filter((leader) => leaderKind === 'all' || (leaderKind === 'node' ? leader.kind === 'node' : leader.kind !== 'node'))
                        .slice(0, 8)
                        .map((leader, index) => {
                          const name = personLabel(leader, people);
                          return (
                          <li key={`${leader.kind || 'x'}:${leader.id || index}`} className="flex min-h-[52px] min-w-0 items-center gap-3 overflow-hidden rounded-[10px] bg-[var(--bg-elevated)] px-3 py-2">
                            <span className={`w-4 shrink-0 text-center text-[13px] font-medium tabular-nums ${index < 3 ? 'font-semibold text-[var(--fg)]' : 'text-[var(--fg-dim)]'}`}>
                              {index + 1}
                            </span>
                            <AliasAvatar alias={leader.alias || leader.display_name || leader.name || name} size={28} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium leading-[22px] text-[var(--fg)]">{name}</span>
                              <span className="block text-[11px] leading-4 text-[var(--fg-dim)]">{leader.kind === 'node' ? 'Agent' : '成员'}</span>
                            </span>
                            {Array.isArray(leader.spark) && leader.spark.length > 1 ? (
                              <span className="hidden h-4 w-12 shrink-0 items-end gap-px sm:flex" aria-hidden>
                                {leader.spark.slice(-14).map((n, sparkIndex, days) => {
                                  const peak = Math.max(1, ...days);
                                  return (
                                    <span
                                      key={sparkIndex}
                                      className="min-w-0 flex-1 rounded-[1px]"
                                      style={{
                                        height: `${Math.max(12, (n / peak) * 100)}%`,
                                        background: sparkIndex === days.length - 1 ? 'var(--accent)' : 'var(--fg-dim)',
                                      }}
                                    />
                                  );
                                })}
                              </span>
                            ) : null}
                            <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--fg)]">{leader.n ?? 0}</span>
                          </li>
                          );
                        })}
                      {stats.leaders.length === 0 ? <li className="px-1 py-6 text-sm text-[var(--fg-dim)]">No completions to rank.</li> : null}
                    </ul>
                  </TaskPanel>
                </div>
                {stats.daily.length > 0 ? (
                  <TaskPanel>
                    <SectionHeading title="14 天完成趋势" />
                    <div className="mt-3 flex h-[120px] items-end gap-1">
                      {stats.daily.slice(-14).map((day, index, days) => {
                        const last = index === days.length - 1;
                        return (
                          <div key={day.date} className="flex h-full flex-1 items-end" title={`${day.date}: ${day.n || 0}`}>
                            <div
                              className="w-full rounded-sm"
                              style={{
                                height: `${Math.max(4, ((day.n || 0) / maxDaily) * 100)}%`,
                                background: last ? 'var(--accent)' : 'var(--fg-dim)',
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </TaskPanel>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        <p className="text-xs text-[var(--fg-dim)]">
          Message tasks between agents stay on <Link href="/tasks" className="text-[var(--fg)] hover:text-[var(--accent)] hover:underline">Tasks</Link>.
        </p>
      </div>
    </main>
  );
}
