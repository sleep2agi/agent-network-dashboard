'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EmptyState } from '../../components/EmptyState';

/**
 * One requirement — #1633 (read-only).
 *
 * Shows description, checklist, and the activity timeline. The write
 * surface (status/owner/tags/comments) is #1634 on purpose: the read
 * shape has to be right before anyone can edit against it.
 */

interface Person { kind: 'user' | 'node'; id: string; alias?: string }
interface ChecklistItem { id: string; text: string; done?: boolean }
interface Requirement {
  id: string; seq: number; name: string; column: string; priority: string;
  due?: string; start?: string; tags?: string[];
  owner?: Person | null; agent_owner?: Person | null;
  parent_id?: string | null;
  children?: { total: number; done: number };
  description?: string; checklist?: ChecklistItem[];
  createdAt?: string; updatedAt?: string;
  external_ref?: string | null; external_url?: string | null;
}
interface EventRow {
  id: string; kind: string; field?: string | null;
  actor?: Person | null;
  at?: string;
  new?: Record<string, unknown> | null;
  old?: Record<string, unknown> | null;
}

const COLUMN_CHIP: Record<string, string> = {
  pool: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  doing: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  done: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  abandoned: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

function personLabel(p?: Person | null) {
  if (!p) return '—';
  return p.alias || p.id;
}

function describeEvent(ev: EventRow) {
  if (ev.kind === 'comment') {
    const text = typeof ev.new?.text === 'string' ? ev.new.text : '';
    return { label: 'comment', body: text };
  }
  if (ev.kind === 'created') return { label: 'created', body: '' };
  if (ev.field) {
    const from = ev.old == null ? '—' : typeof ev.old === 'object' ? JSON.stringify(ev.old) : String(ev.old);
    const to = ev.new == null ? '—' : typeof ev.new === 'object' ? JSON.stringify(ev.new) : String(ev.new);
    return { label: ev.field, body: `${from.slice(0, 120)} → ${to.slice(0, 120)}` };
  }
  return { label: ev.kind, body: '' };
}

export default function RequirementDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [req, setReq] = useState<Requirement | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const [detailRes, eventsRes] = await Promise.all([
          fetch(`/api/hub/requirements/${encodeURIComponent(id)}`, { cache: 'no-store' }),
          fetch(`/api/hub/requirements/events?requirement_id=${encodeURIComponent(id)}&limit=100`, { cache: 'no-store' }),
        ]);
        if (detailRes.status === 401) { if (alive) { setNeedsLogin(true); } return; }
        const detail = await detailRes.json();
        if (!detailRes.ok || !detail.ok) { if (alive) setError(detail?.error || `hub_${detailRes.status}`); return; }
        const eventsJson = eventsRes.ok ? await eventsRes.json() : { events: [] };
        if (!alive) return;
        setReq(detail.requirement as Requirement);
        setEvents((eventsJson.events || []) as EventRow[]);
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : 'fetch failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-6 text-gray-500">
        <div className="mx-auto max-w-4xl space-y-3">
          <div className="h-6 w-2/3 animate-pulse rounded bg-[var(--bg-elevated)]" />
          <div className="h-40 animate-pulse rounded bg-[var(--bg-secondary)]" />
        </div>
      </div>
    );
  }

  if (needsLogin) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-6">
        <div className="mx-auto max-w-4xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          会话已过期，<Link href="/login" className="underline">重新登录</Link>。
        </div>
      </div>
    );
  }

  if (error || !req) {
    return (
      <div className="min-h-screen bg-[var(--bg)] p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            {error ? `读取失败：${error}` : '这条需求不存在或不可见。'}
          </div>
          <Link href="/requirements" className="text-sm text-blue-400 hover:underline">← 返回需求列表</Link>
        </div>
      </div>
    );
  }

  const checklist = req.checklist || [];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-gray-200">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <Link href="/requirements" className="text-xs text-gray-500 hover:text-gray-300">← 需求列表</Link>
        </div>

        <header className="mb-5">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            <span className="tabular-nums">#{req.seq}</span>
            <span className={`rounded border px-1.5 py-0.5 ${COLUMN_CHIP[req.column] || COLUMN_CHIP.abandoned}`}>{req.column}</span>
            <span>{req.priority}</span>
            {req.due && <span>due {String(req.due).slice(0, 10)}</span>}
            {(req.tags || []).map(t => (
              <span key={t} className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-gray-400">{t}</span>
            ))}
          </div>
          <h1 className="text-lg font-semibold text-white">{req.name}</h1>
          <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-gray-500">
            <span>负责人 {personLabel(req.owner)}</span>
            <span>负责 Agent {personLabel(req.agent_owner)}</span>
            {req.children && req.children.total > 0 && <span>子卡 {req.children.done}/{req.children.total}</span>}
            {req.external_url && (
              <a href={req.external_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                {req.external_ref || 'external'}
              </a>
            )}
          </div>
        </header>

        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-gray-500">Description</h2>
          {req.description ? (
            <div className="prose prose-invert max-w-none prose-sm prose-pre:bg-[var(--bg)] prose-pre:border prose-pre:border-[var(--border)]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{req.description}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-gray-600">（没有描述）</p>
          )}
        </section>

        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-gray-500">
            Checklist {checklist.length > 0 && <span className="ml-1 text-gray-600">{checklist.filter(c => c.done).length}/{checklist.length}</span>}
          </h2>
          {checklist.length === 0 ? (
            <p className="text-sm text-gray-600">（没有检查项）</p>
          ) : (
            <ul className="space-y-1.5">
              {checklist.map(item => (
                <li key={item.id} className="flex items-start gap-2 text-sm">
                  <span aria-hidden className={item.done ? 'text-emerald-400' : 'text-gray-600'}>{item.done ? '✓' : '○'}</span>
                  <span className={item.done ? 'text-gray-500 line-through' : 'text-gray-200'}>{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-gray-500">Activity</h2>
          {events.length === 0 ? (
            <EmptyState variant="generic" compact title="还没有动态" sub="状态变更和评论会出现在这里。" />
          ) : (
            <ul className="space-y-2">
              {events.map(ev => {
                const d = describeEvent(ev);
                return (
                  <li key={ev.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span className="text-gray-300">{personLabel(ev.actor)}</span>
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{d.label}</span>
                      {ev.at && <span>{String(ev.at).replace('T', ' ').slice(0, 16)}</span>}
                    </div>
                    {d.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-300">{d.body}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
