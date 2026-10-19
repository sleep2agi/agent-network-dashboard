'use client';

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { EmptyState } from '../components/EmptyState';

/**
 * Organization — #1635 (read-only first slice).
 *
 * Data comes from the Hub's own directory projection (the same one MCP
 * `requirements_people` returns): people, their department, and the Agents
 * each person owns. No editing here — departments/membership are a human
 * admin concern and live elsewhere.
 */

interface DirectoryAgent { node_id: string; alias: string }
interface DirectoryPerson {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  department: { id: string; name: string } | null;
  agents: DirectoryAgent[];
}
interface DirectoryResponse {
  ok: boolean;
  network_id: string;
  total: number;
  people: DirectoryPerson[];
  agents_without_owner?: DirectoryAgent[];
  has_more: boolean;
  next_offset: number | null;
}

const PAGE = 50;

function OrgContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q') || '';

  const [data, setData] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [offset, setOffset] = useState(0);
  const [qInput, setQInput] = useState(q);

  const load = useCallback(async (nextOffset = 0, merge = false) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('limit', String(PAGE));
      params.set('offset', String(nextOffset));
      const res = await fetch(`/api/hub/people?${params.toString()}`, { cache: 'no-store' });
      if (res.status === 401) { setNeedsLogin(true); setData(null); return; }
      const json = await res.json();
      if (!res.ok || !json.ok) { setError(json?.error || `hub_${res.status}`); return; }
      setNeedsLogin(false);
      setOffset(nextOffset);
      setData(prev => (merge && prev && nextOffset > 0
        ? { ...json, people: [...prev.people, ...json.people] }
        : json));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => { load(0, false); }, [load]);

  const setQuery = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set('q', value); else next.delete('q');
    router.replace(next.toString() ? `/org?${next.toString()}` : '/org', { scroll: false });
  };

  const withoutOwner = data?.agents_without_owner ?? [];
  const people = data?.people ?? [];
  const departments = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of data?.people ?? []) {
      if (p.department) map.set(p.department.name, (map.get(p.department.name) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-gray-200">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Organization</h1>
            <p className="mt-1 text-xs text-gray-500">
              人、部门与他们名下的 Agent（只读）。数据来自 Hub 通讯录投影，和 MCP <code className="text-gray-400">requirements_people</code> 同源。
            </p>
          </div>
          <button
            type="button"
            onClick={() => load(offset, true)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
          >
            Refresh
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 focus-within:border-blue-500/40">
            <span className="text-[10px] uppercase tracking-wide text-gray-600">Search</span>
            <input
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setQuery(qInput); }}
              onBlur={() => { if (qInput !== q) setQuery(qInput); }}
              placeholder="人 / 部门 / Agent 别名"
              className="w-44 bg-transparent text-sm text-white placeholder-gray-700 focus:outline-none sm:w-64"
            />
          </div>
          {q && (
            <button
              type="button"
              onClick={() => { setQInput(''); setQuery(''); }}
              className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-[11px] text-gray-500 hover:border-gray-600 hover:text-gray-200"
            >
              Clear
            </button>
          )}
          {data && <span className="text-[11px] text-gray-600">{data.total} 人 · {departments.length} 个部门</span>}
        </div>

        {needsLogin && (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            会话已过期，<Link href="/login" className="underline">重新登录</Link> 后再看组织架构。
          </div>
        )}
        {error && !needsLogin && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            读取失败：{error}
            <button type="button" onClick={() => load(0, false)} className="ml-3 underline">重试</button>
          </div>
        )}

        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)]" />
            ))}
          </div>
        ) : people.length === 0 && !error ? (
          <EmptyState
            variant="nodes"
            title={q ? '没有匹配的成员' : '通讯录是空的'}
            sub={q ? '换一个关键词试试。' : '成员加入网络后会自动出现在这里。'}
          />
        ) : (
          <>
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
              {people.map(person => (
                <li key={person.user_id} className="px-3 py-3 sm:px-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-gray-100">{person.display_name || person.username}</span>
                    <span className="text-[11px] text-gray-600">@{person.username}</span>
                    <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-gray-400">{person.role}</span>
                    {person.department && (
                      <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-gray-400">{person.department.name}</span>
                    )}
                    <span className="ml-auto text-[11px] text-gray-600">{person.agents.length} 个 Agent</span>
                  </div>
                  {person.agents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {person.agents.map(agent => (
                        <span key={agent.node_id} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-gray-300">
                          {agent.alias}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {data?.has_more && (
              <button
                type="button"
                disabled={loading}
                onClick={() => load(offset + PAGE, true)}
                className="mx-auto mt-4 block rounded-lg border border-[var(--border)] px-4 py-2 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
              >
                {loading ? '加载中…' : '加载更多'}
              </button>
            )}

            {offset === 0 && withoutOwner.length > 0 && (
              <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <h2 className="mb-2 text-xs uppercase tracking-wide text-gray-500">Agents without an owner in this network</h2>
                <div className="flex flex-wrap gap-1.5">
                  {withoutOwner.map(agent => (
                    <span key={agent.node_id} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-gray-300">
                      {agent.alias}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function OrgPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]" />}>
      <OrgContent />
    </Suspense>
  );
}
