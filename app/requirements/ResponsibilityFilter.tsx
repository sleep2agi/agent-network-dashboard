'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { readRequirementPeople, responsibilityValue, type PersonOption, type RequirementPersonChoice } from '../lib/requirement-people';

type Catalog = { status: 'loading' } | { status: 'failed'; code: number } | { status: 'ready'; people: RequirementPersonChoice[] };
const LOADING: Catalog = { status: 'loading' };

export function useRequirementPeople(refreshKey: number, networkId: string) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([networkId, refreshKey, attempt]);
  const [response, setResponse] = useState<{ key: string; catalog: Catalog } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const setCatalog = (catalog: Catalog) => { if (!controller.signal.aborted) setResponse({ key, catalog }); };
    async function read() {
      try {
        const params = new URLSearchParams({ network_id: networkId });
        const res = await fetch(`/api/hub/requirements/people?${params}`, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) { setCatalog({ status: 'failed', code: res.status }); return; }
        const people = readRequirementPeople(await res.json());
        setCatalog({ status: 'ready', people });
      } catch { setCatalog({ status: 'failed', code: 502 }); }
    }
    void read();
    return () => controller.abort();
  }, [key, networkId]);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { catalog: response?.key === key ? response.catalog : LOADING, retry };
}

export function ResponsibilityFilter({ owner, agent, supported, catalog, options, query, onQueryChange, onChange, onRetry }: {
  owner: string;
  agent: string;
  supported: boolean | null;
  catalog: Catalog;
  options: PersonOption[];
  query: string;
  onQueryChange: (value: string) => void;
  onChange: (value: string) => void;
  onRetry: () => void;
}) {
  const value = responsibilityValue(owner, agent);
  const names = new Map(options.map(p => [p.value, p.label]));
  const label = (ref: string) => ref === 'none' ? '未指定' : names.get(ref) || ref;
  const title = value === '' ? '全部责任归属' : value === 'none' ? '未分配'
    : [owner && `负责人：${label(owner)}`, agent && `负责 Agent：${label(agent)}`].filter(Boolean).join('；');
  const unknown = [owner, agent].filter(r => r && r !== 'none' && !names.has(r));
  const needle = query.trim().toLocaleLowerCase();
  const matches = options.filter(p => p.search.includes(needle));
  const visible = options.filter(p => p.search.includes(needle) || p.value === value);
  const hint = catalog.status === 'loading' ? '正在读取人选…'
    : catalog.status === 'failed' ? catalog.code === 401 ? '人员目录登录已过期。'
      : catalog.code === 403 ? '没有读取人员目录的权限（403）。'
        : catalog.code === 404 ? '当前 Hub 未提供人员目录接口（404）。'
          : `人员目录读取失败（${catalog.code}），请重试。`
      : value === 'invalid' ? 'URL 中的负责人或 Agent 角色格式无效，请清空责任归属。'
        : supported === false ? '当前 Hub 未提供双角色筛选能力。'
          : unknown.length ? '部分身份不在可见人员目录中，仍按 URL 的精确 ID 查询。'
            : value === 'none' ? '仅显示负责人和负责 Agent 均未分配的需求。'
              : value === 'combined' ? '同时匹配 URL 中的负责人和负责 Agent 条件（交集）。'
                : value === 'owner:none' ? '仅负责人未指定，仍可能有负责 Agent。'
                  : value === 'agent:none' ? '仅负责 Agent 未指定，仍可能有人类负责人。'
                    : owner ? '按人类负责人精确筛选。'
                      : agent ? '按负责 Agent 的身份 ID 精确筛选。'
                        : options.length ? '人类负责人和负责 Agent 分组选择。' : '暂无可见人选，仍可查看全部或未分配需求。';
  const fallback = value === 'combined' || value === 'invalid' || (value.startsWith('user:') || value.startsWith('node:')) && !names.has(value);

  return (
    <div className="mb-4 min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex w-full min-w-0 items-center gap-2 text-xs text-[var(--fg-muted)] sm:w-auto">
          <span className="shrink-0">责任归属</span>
          <select aria-label="责任归属筛选" aria-describedby="responsibility-filter-hint" value={value} title={title}
            onChange={e => onChange(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 text-sm text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hl)] sm:min-h-9 sm:w-80 sm:flex-none">
            <option value="">全部责任归属</option>
            <option value="none" disabled={supported === false}>未分配（人和 Agent 均为空）</option>
            <option value="owner:none" disabled={supported === false}>未指定人类负责人</option>
            <option value="agent:none" disabled={supported === false}>未指定负责 Agent</option>
            {(['user', 'node'] as const).map(kind => (
              <optgroup key={kind} label={kind === 'user' ? '人类负责人' : '负责 Agent'}>
                {visible.filter(p => p.kind === kind).map(p => <option key={p.value} value={p.value} disabled={supported === false}>{p.label}</option>)}
              </optgroup>
            ))}
            {fallback && <option value={value} disabled>{title}</option>}
          </select>
        </label>
        <input aria-label="查找人选" aria-describedby="people-search-hint" value={query} onChange={e => onQueryChange(e.target.value)}
          placeholder="查找人或 Agent" type="search"
          className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 text-sm text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hl)] sm:min-h-9 sm:w-44" />
        <span id="people-search-hint" className="text-xs text-[var(--fg-muted)]">仅查找人选，不筛选需求</span>
      </div>
      <p id="responsibility-filter-hint" role="status" className="mt-2 break-words text-xs text-[var(--fg-muted)]">
        {hint}
        {catalog.status === 'failed' && catalog.code === 401 && <>{' '}<Link href="/login" className="underline">重新登录</Link></>}
        {catalog.status === 'failed' && <button type="button" onClick={onRetry} className="ml-2 inline-flex min-h-11 items-center underline sm:min-h-0">重试人员目录</button>}
        {catalog.status === 'ready' && needle && <span className="ml-2">{matches.length ? `匹配人选 ${matches.length} 个。` : '没有匹配的人选，当前筛选保持不变。'}</span>}
      </p>
    </div>
  );
}
