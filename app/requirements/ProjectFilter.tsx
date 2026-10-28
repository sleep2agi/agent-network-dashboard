'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { projectOptions, type RequirementProject } from '../lib/requirement-projects';

type Catalog =
  | { status: 'loading' }
  | { status: 'ready'; projects: RequirementProject[] }
  | { status: 'failed'; code: number };
const LOADING: Catalog = { status: 'loading' };

export function ProjectFilter({ value, supported, refreshKey, onChange }: {
  value: string;
  supported: boolean | null;
  refreshKey: number;
  onChange: (value: string) => void;
}) {
  const [retry, setRetry] = useState(0);
  const requestKey = `${refreshKey}:${retry}`;
  const [response, setResponse] = useState<{ key: string; catalog: Catalog } | null>(null);
  const catalog = response?.key === requestKey ? response.catalog : LOADING;

  useEffect(() => {
    const controller = new AbortController();
    const setCatalog = (catalog: Catalog) => setResponse({ key: requestKey, catalog });
    async function read() {
      try {
        const res = await fetch('/api/hub/requirements/projects', { cache: 'no-store', signal: controller.signal });
        if (!res.ok) {
          if (!controller.signal.aborted) setCatalog({ status: 'failed', code: res.status });
          return;
        }
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!data.ok || !Array.isArray(data.projects) || data.projects.some((p: RequirementProject) =>
          !p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || !p.name)) {
          setCatalog({ status: 'failed', code: 502 });
          return;
        }
        setCatalog({ status: 'ready', projects: data.projects });
      } catch {
        if (!controller.signal.aborted) setCatalog({ status: 'failed', code: 502 });
      }
    }
    void read();
    return () => controller.abort();
  }, [requestKey]);

  const options = useMemo(() => catalog.status === 'ready' ? projectOptions(catalog.projects) : [], [catalog]);
  const selected = options.find(p => p.id === value);
  const unknown = value && value !== 'none' && !selected;
  const selectionLabel = selected
    ? `${selected.label}${selected.archived ? '（项目已归档）' : ''}`
    : value === 'none' ? '无项目' : value ? `项目 ID：${value}` : '全部项目';
  const hint = catalog.status === 'loading'
    ? '正在读取项目列表…'
    : catalog.status === 'failed'
      ? catalog.code === 401 ? '项目列表登录已过期。'
        : catalog.code === 403 ? '没有读取项目列表的权限（403）。'
          : catalog.code === 404 ? '当前 Hub 未提供项目列表接口（404）。'
            : `项目列表读取失败（${catalog.code}），请重试。`
      : supported === false ? '当前 Hub 未提供项目筛选能力。'
        : unknown ? '此项目不在可见项目列表中，可能不存在或无权查看；仍按 URL 中的项目 ID 查询。'
          : selected?.archived ? '此项目已归档，仍按其 ID 查询；需求是否已归档由搜索选项控制。'
            : value === 'none' ? '仅显示未归属任何项目的需求。'
              : value ? '仅匹配所选项目，不包含子项目。'
                : options.some(p => !p.archived) ? '按项目精确筛选；层级路径仅用于区分项目。' : '暂无可选项目，仍可查看全部需求或无项目需求。';

  return (
    <div className="mb-4 min-w-0">
      <label className="flex max-w-full items-center gap-2 text-xs text-[var(--fg-muted)]">
        <span className="shrink-0">项目</span>
        <select
          aria-label="项目筛选"
          aria-describedby="project-filter-hint"
          value={value}
          onChange={e => onChange(e.target.value)}
          title={selectionLabel}
          className="min-h-11 min-w-0 max-w-full flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 text-sm text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hl)] sm:min-h-9 sm:max-w-80 sm:flex-none"
        >
          <option value="">全部项目</option>
          <option value="none" disabled={supported === false}>无项目</option>
          {options.filter(p => !p.archived || p.id === value).map(p => (
            <option key={p.id} value={p.id} disabled={supported === false}>
              {p.label}{p.archived ? '（项目已归档）' : ''}
            </option>
          ))}
          {unknown && <option value={value} disabled>{selectionLabel}</option>}
        </select>
      </label>
      <p id="project-filter-hint" role="status" className="mt-2 break-words text-xs text-[var(--fg-muted)]">
        {hint}
        {catalog.status === 'failed' && catalog.code === 401 && <>{' '}<Link href="/login" className="underline">重新登录</Link></>}
        {catalog.status === 'failed' && (
          <button type="button" onClick={() => setRetry(n => n + 1)} className="ml-2 inline-flex min-h-11 items-center underline sm:min-h-0">重试项目列表</button>
        )}
      </p>
    </div>
  );
}
