'use client';

import { useCallback, useEffect, useMemo, useReducer, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmptyState } from '../components/EmptyState';
import { initialPagingState, requirementsPaging } from '../lib/requirements-paging';

/**
 * Requirements board — #1633 (read-only first slice).
 *
 * Why this page exists: the dashboard only ever showed dispatch tasks
 * (/tasks = who asked whom). The requirement board — 需求池 / 进行中 /
 * 完成, tags, owner vs agent owner, checklist progress — is what people
 * actually work from in the client. This is the read half; the write half
 * is #1634.
 */

interface RequirementPerson { kind: 'user' | 'node'; id: string; alias?: string }
interface Requirement {
  id: string;
  seq: number;
  name: string;
  column: 'pool' | 'doing' | 'done' | 'abandoned';
  priority: 'high' | 'normal' | 'low' | 'lowest';
  due?: string;
  tags?: string[];
  owner?: RequirementPerson | null;
  agent_owner?: RequirementPerson | null;
  project_id?: string | null;
  checklist_count?: { total: number; done: number };
  children?: { total: number; done: number };
  updatedAt?: string;
  has_description?: boolean;
}

const COLUMNS: { key: Requirement['column'] | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'pool', label: '需求池' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '完成' },
  { key: 'abandoned', label: '已放弃' },
];

const COLUMN_CHIP: Record<string, string> = {
  pool: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  doing: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  done: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  abandoned: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

function priorityClass(priority: string) {
  if (priority === 'high') return 'text-red-400';
  if (priority === 'low' || priority === 'lowest') return 'text-gray-600';
  return 'text-gray-400';
}

function personLabel(p?: RequirementPerson | null) {
  if (!p) return '—';
  return p.alias || p.id;
}

function dueLabel(due?: string) {
  if (!due) return '—';
  const day = due.slice(0, 10);
  const overdue = day < new Date().toISOString().slice(0, 10);
  return overdue ? <span className="text-red-400">{day}</span> : <span className="text-gray-400">{day}</span>;
}

function RequirementsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = searchParams.get('status') || '';
  const tag = searchParams.get('tag') || '';
  const q = searchParams.get('q') || '';

  // #1636: 替换态与追加态分开，追加时已加载的行不能进骨架屏。
  const [state, dispatch] = useReducer(
    requirementsPaging<Requirement>,
    undefined,
    initialPagingState<Requirement>,
  );
  const { rows, loading, loadingMore, error, needsLogin, cursor, hasMore } = state;
  const [tagInput, setTagInput] = useState(tag);
  const [qInput, setQInput] = useState(q);

  const setParam = useCallback((patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    router.replace(qs ? `/requirements?${qs}` : '/requirements', { scroll: false });
  }, [router, searchParams]);

  const load = useCallback(async (opts: { cursor?: string | null; append?: boolean } = {}) => {
    const nextCursor = opts.cursor ?? null;
    const phase = opts.append === true ? 'append' as const : 'replace' as const;
    dispatch({ type: 'start', phase });
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (tag) params.set('tag', tag);
      if (q) params.set('q', q);
      params.set('limit', '200');
      if (nextCursor) params.set('cursor', nextCursor);
      const res = await fetch(`/api/hub/requirements?${params.toString()}`, { cache: 'no-store' });
      if (res.status === 401) { dispatch({ type: 'unauthorized', phase }); return; }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        dispatch({ type: 'failed', phase, error: data?.error || `hub_${res.status}` });
        return;
      }
      const incoming = (data.requirements || []) as Requirement[];
      const nextCursorValue = typeof data.next_cursor === 'string' ? data.next_cursor : null;
      dispatch({
        type: 'loaded',
        phase,
        incoming,
        nextCursor: nextCursorValue,
        hasMore: data.has_more === true && nextCursorValue !== null,
      });
    } catch (e: unknown) {
      dispatch({ type: 'failed', phase, error: e instanceof Error ? e.message : 'fetch failed' });
    }
  }, [status, tag, q]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) out[r.column] = (out[r.column] || 0) + 1;
    return out;
  }, [rows]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-gray-200">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Requirements</h1>
            <p className="mt-1 text-xs text-gray-500">
              需求池 / 进行中 / 完成 —— 只读视图（写面见 #1634）。任务派单在 <Link href="/tasks" className="text-blue-400 hover:underline">Tasks</Link>。
            </p>
          </div>
          <button
            type="button"
            onClick={() => load()}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
          >
            Refresh
          </button>
        </div>

        {/* Status tabs */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {COLUMNS.map(col => {
            const count = col.key ? counts[col.key] || 0 : rows.length;
            const active = status === col.key;
            return (
              <button
                key={col.key || 'all'}
                type="button"
                onClick={() => setParam({ status: col.key })}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                    : 'border-transparent text-gray-500 hover:bg-[var(--border)]/60 hover:text-gray-300'
                }`}
              >
                {col.label}
                <span className="ml-1.5 text-[10px] tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Text filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 focus-within:border-blue-500/40">
            <span className="text-[10px] uppercase tracking-wide text-gray-600">Search</span>
            <input
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setParam({ q: qInput }); }}
              onBlur={() => { if (qInput !== q) setParam({ q: qInput }); }}
              placeholder="标题 / 人 / 标签"
              className="w-40 bg-transparent text-sm text-white placeholder-gray-700 focus:outline-none sm:w-56"
            />
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 focus-within:border-blue-500/40">
            <span className="text-[10px] uppercase tracking-wide text-gray-600">Tag</span>
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setParam({ tag: tagInput }); }}
              onBlur={() => { if (tagInput !== tag) setParam({ tag: tagInput }); }}
              placeholder="exact tag"
              className="w-28 bg-transparent text-sm text-white placeholder-gray-700 focus:outline-none"
            />
          </div>
          {(status || tag || q) && (
            <button
              type="button"
              onClick={() => { setTagInput(''); setQInput(''); setParam({ status: '', tag: '', q: '' }); }}
              className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-500 hover:border-gray-600 hover:text-gray-200"
            >
              Clear filters
            </button>
          )}
        </div>

        {needsLogin && (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            会话已过期，<Link href="/login" className="underline">重新登录</Link> 后再看需求。
          </div>
        )}
        {error && !needsLogin && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            读取失败：{error}
            <button
              type="button"
              onClick={() => (rows.length > 0 && hasMore ? load({ cursor, append: true }) : load())}
              className="ml-3 underline"
            >重试</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            variant="generic"
            title={status || tag || q ? '没有符合筛选的需求' : '需求池是空的'}
            sub={status || tag || q ? '清掉筛选再试，或换一个标签。' : '客户端建一条需求后，这里就会出现。'}
            cta={status || tag || q ? { label: '清空筛选', onClick: () => setParam({ status: '', tag: '', q: '' }) } : undefined}
          />
        ) : (
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            {rows.map(row => {
              const chk = row.checklist_count;
              const kids = row.children;
              return (
                <li key={row.id} className="hover:bg-[var(--bg-secondary)]/60">
                  <Link href={`/requirements/${row.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
                    <span className="w-12 shrink-0 text-[11px] tabular-nums text-gray-600">#{row.seq}</span>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${COLUMN_CHIP[row.column] || COLUMN_CHIP.abandoned}`}>
                      {row.column}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-100">{row.name}</span>
                    {(row.tags || []).slice(0, 3).map(t => (
                      <span key={t} className="hidden shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-gray-400 sm:inline">
                        {t}
                      </span>
                    ))}
                    <span className={`shrink-0 text-[11px] ${priorityClass(row.priority)}`}>{row.priority}</span>
                    <span className="hidden w-24 shrink-0 truncate text-[11px] text-gray-500 sm:inline">{personLabel(row.agent_owner)}</span>
                    <span className="w-20 shrink-0 text-right text-[11px]">{dueLabel(row.due)}</span>
                    {chk && chk.total > 0 && (
                      <span className="hidden shrink-0 text-[10px] tabular-nums text-gray-500 sm:inline">
                        ✓ {chk.done}/{chk.total}
                      </span>
                    )}
                    {kids && kids.total > 0 && (
                      <span className="hidden shrink-0 text-[10px] tabular-nums text-gray-500 md:inline">
                        ↳ {kids.done}/{kids.total}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => load({ cursor, append: true })}
            className="mx-auto mt-4 block rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RequirementsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]" />}>
      <RequirementsContent />
    </Suspense>
  );
}
