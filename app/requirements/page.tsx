'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { EmptyState } from '../components/EmptyState';
import { createLoadGate, initialPagingState, requirementsPaging } from '../lib/requirements-paging';
import { ProjectFilter } from './ProjectFilter';
import { CreateRequirement } from './CreateRequirement';
import { NetworkRequiredNotice } from '../components/NetworkRequiredNotice';
import { useNetworkId } from '../lib/network-context';
import { ResponsibilityFilter, useRequirementPeople } from './ResponsibilityFilter';
import { peopleOptions, responsibilityPatch, validResponsibility } from '../lib/requirement-people';

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
  archived?: boolean;
}

const COLUMNS: { key: Requirement['column'] | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'pool', label: '需求池' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '完成' },
  { key: 'abandoned', label: '已放弃' },
];

const COLUMN_CHIP: Record<string, string> = {
  pool: 'bg-[var(--bg-elevated)] text-[var(--warning)]',
  doing: 'bg-[var(--bg-elevated)] text-[var(--info)]',
  done: 'bg-[var(--bg-elevated)] text-[var(--success)]',
  abandoned: 'bg-[var(--bg-elevated)] text-[var(--fg-muted)]',
};

function priorityClass(priority: string) {
  if (priority === 'high') return 'text-red-400';
  if (priority === 'low' || priority === 'lowest') return 'text-[var(--fg-muted)]';
  return 'text-gray-400';
}

function personLabel(p: RequirementPerson | null | undefined, names: Map<string, string>) {
  if (!p) return '—';
  return names.get(`${p.kind}:${p.id}`) || p.alias || p.id;
}

function dueLabel(due?: string) {
  if (!due) return '—';
  const day = due.slice(0, 10);
  const overdue = day < new Date().toISOString().slice(0, 10);
  return overdue ? <span className="text-red-400">{day}</span> : <span className="text-gray-400">{day}</span>;
}

function RequirementsContent({ networkId }: { networkId: string }) {
  const searchParams = useSearchParams();

  const status = searchParams.get('status') || '';
  const tag = searchParams.get('tag') || '';
  const q = searchParams.get('q') || '';
  const project = searchParams.get('project_id') || '';
  const owner = searchParams.get('owner') || '';
  const agent = searchParams.get('agent_owner') || '';
  const includeArchived = searchParams.get('include_archived') !== '0';
  const searching = q.trim().length > 0;
  const board = searchParams.get('view') === 'board';

  // #1636: 替换态与追加态分开，追加时已加载的行不能进骨架屏。
  const [state, dispatch] = useReducer(
    requirementsPaging<Requirement>,
    undefined,
    initialPagingState<Requirement>,
  );
  const { rows, loading, loadingMore, error, needsLogin, cursor, hasMore } = state;
  // #1636 回归：追加只在完全空闲时放行；替换抢占旧请求并用代际号丢弃迟到回包。
  const gate = useRef(createLoadGate());
  const [tagInput, setTagInput] = useState(tag);
  const [qInput, setQInput] = useState(q);
  const [archiveSupported, setArchiveSupported] = useState<boolean | null>(null);
  const archiveSupport = useRef<boolean | null>(null);
  const pendingUrls = useRef(new Set<string>());
  const [projectSupported, setProjectSupported] = useState<boolean | null>(null);
  const [projectRefresh, setProjectRefresh] = useState(0);
  const [peopleQuery, setPeopleQuery] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState('');
  const [moveNotice, setMoveNotice] = useState('');
  const [columnOverrides, setColumnOverrides] = useState<Record<string, string>>({});
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState('');
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(new Set());
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [responsibilitySupported, setResponsibilitySupported] = useState<boolean | null>(null);
  const { catalog: peopleCatalog, retry: retryPeople } = useRequirementPeople(projectRefresh, networkId);
  const personOptions = useMemo(() => peopleCatalog.status === 'ready' ? peopleOptions(peopleCatalog.people) : [], [peopleCatalog]);
  const personNames = useMemo(() => new Map(personOptions.map(p => [p.value, p.label])), [personOptions]);

  // Our actions update drafts immediately. Their later React renders must not
  // overwrite typing made since submission. External URL navigation still syncs.
  useEffect(() => {
    const pending = pendingUrls.current;
    const url = searchParams.toString();
    if (pending.has(url)) {
      for (const entry of pending) {
        pending.delete(entry);
        if (entry === url) break;
      }
      return;
    }
    pending.clear();
    setQInput(q);
    setTagInput(tag);
  }, [searchParams, q, tag]);

  useEffect(() => {
    const restore = () => {
      // Back/Forward is external even if it matches an unobserved local write.
      pendingUrls.current.clear();
      const params = new URLSearchParams(window.location.search);
      setQInput(params.get('q') || '');
      setTagInput(params.get('tag') || '');
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('anet-requirements-board-collapsed');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setCollapsedColumns(new Set(parsed.filter(key => typeof key === 'string')));
    } catch { /* ignore malformed preferences */ }
  }, []);

  const toggleBulkMode = () => {
    setBulkMode(value => {
      if (value) { setSelectedIds(new Set()); setBulkMessage(''); setBulkError(''); }
      return !value;
    });
  };

  const toggleColumn = useCallback((key: string) => {
    setCollapsedColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem('anet-requirements-board-collapsed', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const setParam = useCallback((patch: Record<string, string>) => {
    setSelectedIds(new Set());
    // This page fetches on the client. Next's native history integration makes
    // the real URL authoritative immediately, without a cancellable RSC trip.
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const qs = next.toString();
    if ('q' in patch) setQInput(patch.q);
    if ('tag' in patch) setTagInput(patch.tag);
    pendingUrls.current.delete(qs);
    pendingUrls.current.add(qs);
    window.history.replaceState(null, '', qs ? `/requirements?${qs}` : '/requirements');
  }, []);

  const clearFilters = () => {
    setPeopleQuery('');
    setParam({ status: '', tag: '', q: '', project_id: '', owner: '', agent_owner: '' });
  };


  const load = useCallback(async (opts: { cursor?: string | null; append?: boolean; silent?: boolean } = {}) => {
    const nextCursor = opts.cursor ?? null;
    let phase: 'append' | 'replace' = opts.append === true ? 'append' : 'replace';
    // 闸门在 dispatch 之前：被拒绝的追加不进入加载态，也不发请求。
    const gen = gate.current.begin(phase);
    if (gen === null) return;
    // 静默刷新（看板移动后的对账）不出骨架屏，也不在失败时清空已加载行。
    if (!opts.silent) dispatch({ type: 'start', phase });
    try {
      if (!validResponsibility(owner, agent)) throw new Error('URL 中的负责人或 Agent 角色格式无效，请清空责任归属');
      const params = new URLSearchParams({ network_id: networkId });
      if (status) params.set('status', status);
      if (tag) params.set('tag', tag);
      if (q) params.set('q', q);
      if (project) params.set('project_id', project);
      if (owner) params.set('owner', owner);
      if (agent) params.set('agent_owner', agent);
      const wantsArchives = searching && includeArchived;
      if (wantsArchives && archiveSupport.current === true) params.set('include_archived', '1');
      params.set('limit', '200');
      if (nextCursor) params.set('cursor', nextCursor);
      let res = await fetch(`/api/hub/requirements?${params.toString()}`, { cache: 'no-store' });
      // 已被更新的一次加载取代（换筛选/重复刷新）：这个回包整份作废。
      if (!gate.current.isCurrent(gen)) return;
      if (res.status === 401) { dispatch({ type: 'unauthorized', phase }); return; }
      let data = await res.json();
      if (!gate.current.isCurrent(gen)) return;
      if (!res.ok || !data.ok) {
        if (opts.silent) return;
        dispatch({ type: 'failed', phase, error: data?.error || `hub_${res.status}` });
        return;
      }
      const checkProjects = (caps: unknown) => {
        const supported = Array.isArray(caps) && caps.includes('projects');
        setProjectSupported(supported);
        // A legacy Hub may ignore unknown filters. Never label all rows as a
        // successful project-filtered result, including a direct URL visit.
        if (project && !supported) throw new Error('当前 Hub 未提供项目筛选能力，请清空项目筛选后重试');
        const roles = Array.isArray(caps) && caps.includes('agent_owner');
        setResponsibilitySupported(roles);
        if ((owner || agent) && !roles) throw new Error('当前 Hub 未提供双角色筛选能力，请清空责任归属后重试');
      };
      checkProjects(data.capabilities);
      const supportsArchives = (caps: unknown) => Array.isArray(caps) && caps.includes('archived') && caps.includes('search');
      const supported = supportsArchives(data.capabilities);
      archiveSupport.current = supported;
      setArchiveSupported(supported);
      // Learn capability from a normal read before sending the archive option.
      // Negotiate inside this generation so the preliminary page is never shown
      // as an archive-inclusive result, and late responses cannot change the UI.
      if (params.has('include_archived') !== (wantsArchives && supported)) {
        if (wantsArchives && supported) params.set('include_archived', '1');
        else params.delete('include_archived');
        // A changed capability also changes the query: never reuse its cursor.
        params.delete('cursor');
        phase = 'replace';
        dispatch({ type: 'start', phase });
        res = await fetch(`/api/hub/requirements?${params.toString()}`, { cache: 'no-store' });
        if (!gate.current.isCurrent(gen)) return;
        if (res.status === 401) { dispatch({ type: 'unauthorized', phase }); return; }
        data = await res.json();
        if (!gate.current.isCurrent(gen)) return;
        if (!res.ok || !data.ok) {
          if (!opts.silent) dispatch({ type: 'failed', phase, error: data?.error || `hub_${res.status}` });
          return;
        }
        checkProjects(data.capabilities);
        const confirmed = supportsArchives(data.capabilities);
        archiveSupport.current = confirmed;
        setArchiveSupported(confirmed);
        if (confirmed !== supported) throw new Error('搜索能力已变化，请重试');
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
      if (!gate.current.isCurrent(gen)) return;
      if (opts.silent) return;
      dispatch({ type: 'failed', phase, error: e instanceof Error ? e.message : 'fetch failed' });
    } finally {
      gate.current.settle(gen);
    }
  }, [networkId, status, tag, q, project, owner, agent, searching, includeArchived]);

  useEffect(() => {
    void load();
    const currentGate = gate.current;
    // Unmounting on a network change also invalidates a pending archive
    // negotiation, so it cannot issue a follow-up read for the old network.
    return () => { currentGate.begin('replace'); };
  }, [load]);

  const columnOf = useCallback((row: Requirement) => columnOverrides[row.id] ?? row.column, [columnOverrides]);

  const moveCard = useCallback(async (row: Requirement, column: Requirement['column']) => {
    const from = columnOverrides[row.id] ?? row.column;
    if (column === from) return;
    setMovingId(row.id);
    setMoveError('');
    setMoveNotice('');
    setColumnOverrides(prev => ({ ...prev, [row.id]: column }));
    const revert = () => setColumnOverrides(prev => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    try {
      const res = await fetch(`/api/hub/requirements/${encodeURIComponent(row.id)}?network_id=${encodeURIComponent(networkId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ column }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        revert();
        setMoveError(`移动失败：${data?.error || `hub_${res.status}`}`);
        return;
      }
      revert();
      setMoveNotice(`已移到 ${COLUMNS.find(item => item.key === column)?.label ?? column}`);
      // 静默对账：不闪骨架屏，也不掩盖后续读取失败。
      await load({ silent: true });
    } catch {
      revert();
      setMoveError('移动失败：网络错误');
    } finally {
      setMovingId(null);
    }
  }, [columnOverrides, load, networkId]);

  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const live = new Set(rows.map(row => row.id));
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkPatch = async (fields: Record<string, unknown>) => {
    const ids = [...selectedIds];
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    setBulkMessage('');
    setBulkError('');
    const results = await Promise.all(ids.map(async id => {
      try {
        const res = await fetch(`/api/hub/requirements/${encodeURIComponent(id)}?network_id=${encodeURIComponent(networkId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        });
        const data = await res.json().catch(() => ({}));
        return { id, error: res.ok && data.ok !== false ? null : (data?.message || data?.error || `hub_${res.status}`) };
      } catch {
        return { id, error: '网络错误' };
      }
    }));
    const failures = results.filter(result => result.error);
    if (failures.length) {
      setBulkError(`成功 ${ids.length - failures.length} 项，失败 ${failures.length} 项：${failures[0].error}`);
      setSelectedIds(new Set(failures.map(item => item.id)));
    } else {
      setBulkMessage(`已更新 ${ids.length} 项`);
      setSelectedIds(new Set());
    }
    if (failures.length < ids.length) await load({ silent: true });
    setBulkBusy(false);
  };

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
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              只读视图。派单在 <Link href="/tasks" className="text-[var(--hl)] hover:underline">Tasks</Link>。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CreateRequirement
              networkId={networkId}
              onCreated={seq => {
                setCreateNotice(seq ? `已创建需求 #${seq}` : '已创建需求');
                void load();
              }}
            />
            <div role="group" aria-label="视图切换" className="flex items-center gap-0.5 rounded-md border border-[var(--border)] p-0.5">
              {[{ key: '', label: '列表', test: 'list' }, { key: 'board', label: '看板', test: 'board' }].map(option => {
                const active = (option.key === 'board') === board;
                return (
                  <button
                    key={option.test}
                    type="button"
                    aria-pressed={active}
                    data-testid={`requirements-view-${option.test}`}
                    onClick={() => setParam({ view: option.key })}
                    className={`rounded px-2.5 py-1 text-xs transition-colors ${active ? 'bg-[var(--bg-elevated)] text-gray-100' : 'text-[var(--fg-muted)] hover:text-gray-200'}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          <button
            type="button"
            onClick={() => { setProjectRefresh(n => n + 1); void load(); }}
            className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--hover-tint)] hover:text-gray-200"
          >
            Refresh
          </button>
          </div>
        </div>

        {/* Status tabs */}
        <div className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="状态筛选，数量为当前已加载结果">
          {COLUMNS.map(col => {
            const count = col.key ? counts[col.key] || 0 : rows.length;
            const active = status === col.key;
            return (
              <button
                key={col.key || 'all'}
                type="button"
                onClick={() => setParam({ status: col.key })}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'bg-[var(--bg-elevated)] text-gray-100'
                    : 'text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-gray-200'
                }`}
              >
                {col.label}
                <span className="ml-1.5 text-[10px] tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        <ProjectFilter
          networkId={networkId}
          value={project}
          supported={projectSupported}
          refreshKey={projectRefresh}
          onChange={value => setParam({ project_id: value, q: qInput, tag: tagInput })}
        />

        <ResponsibilityFilter owner={owner} agent={agent} supported={responsibilitySupported}
          query={peopleQuery} onQueryChange={setPeopleQuery}
          catalog={peopleCatalog} options={personOptions} onRetry={retryPeople}
          onChange={value => setParam({ ...responsibilityPatch(value), q: qInput, tag: tagInput })} />

        {/* Text filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 focus-within:border-[var(--border-hover)]">
            <input
              value={qInput}
              onChange={e => setQInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setParam({ q: qInput }); }}
              onBlur={() => { if (qInput !== q) setParam({ q: qInput }); }}
              placeholder="搜索标题 / 人 / 标签"
              aria-label="搜索需求"
              className="w-40 bg-transparent text-sm text-white placeholder-gray-700 focus:outline-none sm:w-56"
            />
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5 focus-within:border-[var(--border-hover)]">
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') setParam({ tag: tagInput }); }}
              onBlur={() => { if (tagInput !== tag) setParam({ tag: tagInput }); }}
              placeholder="精确标签"
              aria-label="精确标签"
              className="w-28 bg-transparent text-sm text-white placeholder-gray-700 focus:outline-none"
            />
          </div>
          {archiveSupported === true && (
            <label className={`flex min-h-11 items-center gap-2 rounded-md px-2.5 text-xs sm:min-h-9 ${searching ? 'cursor-pointer text-[var(--fg)]' : 'text-[var(--fg-muted)]'}`}>
              <input
                type="checkbox"
                checked={includeArchived}
                disabled={!searching}
                onChange={e => setParam({ q: qInput, tag: tagInput, include_archived: e.target.checked ? '1' : '0' })}
                aria-describedby="archive-search-hint"
                className="h-4 w-4 accent-[var(--hl)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hl)]"
              />
              包含已归档
            </label>
          )}
          {(status || tag || q || project || owner || agent) && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md px-2.5 py-1.5 text-[11px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-gray-200"
            >
              Clear filters
            </button>
          )}
        </div>

        <p id="archive-search-hint" role="status" className="mb-4 text-xs text-[var(--fg-muted)]">
          {needsLogin
            ? '登录后可继续读取需求。'
            : error
              ? '本次读取未完成，请重试。'
              : archiveSupported === false
            ? '当前 Hub 未提供归档搜索能力，仅显示普通需求。'
            : !searching
              ? '输入搜索词后可查找已归档需求。'
              : loading
                ? '正在读取搜索结果…'
                : archiveSupported === true && includeArchived
                  ? '搜索包含已归档需求，归档项单独标记。'
                  : '搜索仅包含未归档需求。'}
          {!loading && !error && !needsLogin && ` 已加载 ${rows.length} 条${hasMore ? '，可继续加载。' : '。'}`}
        </p>

        {createNotice && (
          <p role="status" data-testid="requirements-create-notice" className="mb-4 text-xs text-[var(--fg-muted)]">
            {createNotice}
            <button type="button" onClick={() => setCreateNotice('')} className="ml-2 underline">知道了</button>
          </p>
        )}

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
        ) : rows.length === 0 && !needsLogin && !error ? (
          // 空态只代表“这个筛选真的没有数据”。未登录或读失败时 rows 也会是空的，
          // 那时说「需求池是空的」就是把鉴权/故障说成没数据，用户会以为需求丢了。
          <EmptyState
            variant="generic"
            title={status || tag || q || project || owner || agent ? '没有符合筛选的需求' : '需求池是空的'}
            sub={status || tag || q || project || owner || agent ? '清掉筛选再试，或换一个项目、责任归属或标签。' : '客户端建一条需求后，这里就会出现。'}
            cta={status || tag || q || project || owner || agent ? { label: '清空筛选', onClick: clearFilters } : undefined}
          />
        ) : board ? (
          <>
            {(moveError || moveNotice) && (
              <p
                role={moveError ? 'alert' : 'status'}
                data-testid="requirements-move-status"
                className={`mb-2 text-xs ${moveError ? 'text-red-400' : 'text-[var(--fg-muted)]'}`}
              >
                {moveError || moveNotice}
              </p>
            )}
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              data-testid="requirements-bulk-toggle"
              aria-pressed={bulkMode}
              onClick={toggleBulkMode}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${bulkMode ? 'bg-[var(--bg-elevated)] text-[var(--fg)]' : 'text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-gray-200'}`}
            >
              {bulkMode ? '退出批量' : '批量'}
            </button>
            {status !== 'abandoned' && (
              <button
                type="button"
                data-testid="requirements-abandoned-toggle"
                aria-label={showAbandoned ? '收起已放弃列' : '展开已放弃列'}
                aria-pressed={showAbandoned}
                onClick={() => setShowAbandoned(value => !value)}
                className="rounded-md px-2.5 py-1 text-[11px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--hover-tint)] hover:text-gray-200"
              >
                {showAbandoned ? '收起已放弃' : `已放弃 ${counts.abandoned || 0}`}
              </button>
            )}
          </div>
          {bulkMode && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-xs" data-testid="requirements-bulk-bar">
              <span className="text-[var(--fg-muted)]">已选 {selectedIds.size} 项</span>
              <select
                aria-label="批量移动到状态"
                value=""
                disabled={bulkBusy || selectedIds.size === 0}
                onChange={event => { if (event.target.value) void bulkPatch({ column: event.target.value }); }}
                className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs text-[var(--fg)] disabled:opacity-50"
              >
                <option value="">移到…</option>
                {COLUMNS.filter(item => item.key).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
              <select
                aria-label="批量设置优先级"
                value=""
                disabled={bulkBusy || selectedIds.size === 0}
                onChange={event => { if (event.target.value) void bulkPatch({ priority: event.target.value }); }}
                className="rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-xs text-[var(--fg)] disabled:opacity-50"
              >
                <option value="">优先级…</option>
                {(['high', 'normal', 'low', 'lowest'] as const).map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <button type="button" onClick={() => setSelectedIds(new Set())} disabled={bulkBusy || selectedIds.size === 0} className="text-[11px] text-[var(--fg-muted)] underline disabled:opacity-50">清空选择</button>
              {bulkBusy && <span className="text-[11px] text-[var(--fg-muted)]">批量写入中…</span>}
              {bulkMessage && <span role="status" className="text-[11px] text-[var(--fg-muted)]">{bulkMessage}</span>}
              {bulkError && <span role="alert" className="text-[11px] text-[var(--danger)]">{bulkError}</span>}
            </div>
          )}
          <div className="-mx-1 min-w-0 overflow-x-auto pb-1" data-testid="requirements-board">
            <div className="flex snap-x gap-3 px-1">
              {COLUMNS.filter(col => col.key)
                .filter(col => (!status || col.key === status) && (col.key !== 'abandoned' || showAbandoned || status === 'abandoned'))
                .map(col => {
                const items = rows.filter(row => columnOf(row) === col.key);
                const isCollapsed = collapsedColumns.has(col.key);
                return (
                  <section
                    key={col.key}
                    aria-label={`${col.label}列`}
                    data-testid={`requirements-column-${col.key}`}
                    className={`snap-start shrink-0 rounded-xl border bg-[var(--bg-secondary)]/60 transition-colors ${isCollapsed ? 'w-12' : 'w-72 sm:w-[19rem]'} ${dragOverColumn === col.key ? 'border-[var(--hl)] bg-[var(--hover-tint)]' : 'border-[var(--border)]'}`}
                    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverColumn(col.key); }}
                    onDragLeave={event => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) setDragOverColumn(null); }}
                    onDrop={event => {
                      event.preventDefault();
                      setDragOverColumn(null);
                      const id = event.dataTransfer.getData('text/plain');
                      const row = rows.find(item => item.id === id);
                      if (row) void moveCard(row, col.key as Requirement['column']);
                    }}
                  >
                    {isCollapsed ? (
                      <button
                        type="button"
                        onClick={() => toggleColumn(col.key)}
                        aria-label={`${col.label} 展开`}
                        data-testid={`requirements-column-expand-${col.key}`}
                        className="flex h-44 w-full flex-col items-center justify-between gap-2 px-1 py-3"
                      >
                        <span className={`rounded px-1 py-0.5 text-[11px] tabular-nums ${COLUMN_CHIP[col.key]}`}>{items.length}</span>
                        <span className="text-[11px] text-[var(--fg-muted)]" style={{ writingMode: 'vertical-rl' }}>{col.label}</span>
                      </button>
                    ) : (
                    <>
                    <header className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${COLUMN_CHIP[col.key]}`}>{col.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[10px] tabular-nums text-[var(--fg-muted)]">{items.length}</span>
                        <button
                          type="button"
                          onClick={() => toggleColumn(col.key)}
                          aria-label={`${col.label} 折叠`}
                          data-testid={`requirements-column-collapse-${col.key}`}
                          className="rounded px-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
                        >−</button>
                      </span>
                    </header>
                    <div className="space-y-2 px-2 pb-3">
                      {items.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-[11px] text-[var(--fg-muted)]">
                          这一列没有需求
                        </p>
                      ) : items.map(row => {
                        const chk = row.checklist_count;
                        const kids = row.children;
                        return (
                          <div
                            key={row.id}
                            className={`rounded-lg border border-[var(--border)] bg-[var(--bg)] transition-opacity ${movingId === row.id ? 'opacity-60' : ''}`}
                          >
                            <Link
                              href={`/requirements/${row.id}`}
                              draggable
                              onDragStart={event => {
                                event.dataTransfer.setData('text/plain', row.id);
                                event.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={() => setDragOverColumn(null)}
                              className="block rounded-t-lg px-3 pb-1 pt-2.5 hover:bg-[var(--hover-tint)]"
                            >
                              <span className="flex items-center justify-between gap-2 text-[10px] text-[var(--fg-muted)]">
                                <span className="tabular-nums">#{row.seq}</span>
                                <span className="flex items-center gap-2">
                                  <span className={priorityClass(row.priority)}>{row.priority}</span>
                                  {row.due && <span>{dueLabel(row.due)}</span>}
                                </span>
                              </span>
                              <span className="mt-1 block text-sm text-gray-100">
                                <span className="line-clamp-2" title={row.name}>{row.name}</span>
                              </span>
                              {row.archived === true && (
                                <span className="mt-1 inline-flex rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] leading-4 text-[var(--fg-muted)]">已归档</span>
                              )}
                              {(row.tags || []).length > 0 && (
                                <span className="mt-2 flex flex-wrap gap-1">
                                  {(row.tags || []).slice(0, 3).map(tag => (
                                    <span key={tag} className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-gray-400">{tag}</span>
                                  ))}
                                </span>
                              )}
                              <span
                                data-responsibility
                                className="mt-2 block text-[11px] leading-4 text-[var(--fg-muted)]"
                                title={`负责人：${personLabel(row.owner, personNames)}；负责 Agent：${personLabel(row.agent_owner, personNames)}`}
                              >
                                <span className="block truncate">人 · {personLabel(row.owner, personNames)}</span>
                                <span className="block truncate">Agent · {personLabel(row.agent_owner, personNames)}</span>
                              </span>
                              {(chk || kids) && (
                                <span className="mt-1 flex gap-3 text-[10px] tabular-nums text-[var(--fg-muted)]">
                                  {chk && chk.total > 0 && <span>✓ {chk.done}/{chk.total}</span>}
                                  {kids && kids.total > 0 && <span>↳ {kids.done}/{kids.total}</span>}
                                </span>
                              )}
                            </Link>
                            <div className="flex items-center justify-end gap-2 px-2 pb-1.5">
                              {bulkMode && (
                                <label className="mr-auto flex items-center gap-1 text-[10px] text-[var(--fg-muted)]">
                                  <input
                                    type="checkbox"
                                    aria-label={`选择 #${row.seq} ${row.name}`}
                                    checked={selectedIds.has(row.id)}
                                    disabled={bulkBusy}
                                    onChange={() => toggleSelected(row.id)}
                                    className="h-3.5 w-3.5 accent-[var(--hl)]"
                                  />
                                  选择
                                </label>
                              )}
                              <select
                                aria-label={`移动到状态 ${row.seq}`}
                                value={columnOf(row)}
                                disabled={movingId === row.id}
                                onChange={event => void moveCard(row, event.target.value as Requirement['column'])}
                                title="移动到其它状态（键盘/触屏可用）"
                                className="rounded border border-[var(--border)] bg-transparent px-1 py-0.5 text-[10px] text-[var(--fg-muted)] disabled:opacity-50"
                              >
                                {COLUMNS.filter(item => item.key).map(item => (
                                  <option key={item.key} value={item.key}>{item.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
          </>
        ) : (
          <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl bg-[var(--bg-secondary)]">
            {rows.map(row => {
              const chk = row.checklist_count;
              const kids = row.children;
              return (
                <li key={row.id} className="hover:bg-[var(--bg-secondary)]/60">
                  <Link href={`/requirements/${row.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:px-4">
                    <span className="w-12 shrink-0 text-[11px] tabular-nums text-[var(--fg-muted)]">#{row.seq}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${COLUMN_CHIP[row.column] || COLUMN_CHIP.abandoned}`}>
                      {row.column}
                    </span>
                    <span className="min-w-0 flex-1 basis-32 text-sm text-gray-100 sm:basis-0">
                      <span className="block truncate" title={row.name}>{row.name}</span>
                      {row.archived === true && (
                        <span className="mt-1 inline-flex rounded border border-[var(--border)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] leading-4 text-[var(--fg-muted)]">已归档</span>
                      )}
                    </span>
                    {(row.tags || []).slice(0, 3).map(t => (
                      <span key={t} className="hidden shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-gray-400 sm:inline">
                        {t}
                      </span>
                    ))}
                    <span className={`shrink-0 text-[11px] ${priorityClass(row.priority)}`}>{row.priority}</span>
                    <span data-responsibility className="hidden w-36 shrink-0 text-[11px] leading-4 text-[var(--fg-muted)] sm:block"
                      title={`负责人：${personLabel(row.owner, personNames)}；负责 Agent：${personLabel(row.agent_owner, personNames)}`}>
                      <span className="block truncate">人 · {personLabel(row.owner, personNames)}</span>
                      <span className="block truncate">Agent · {personLabel(row.agent_owner, personNames)}</span>
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px]">{dueLabel(row.due)}</span>
                    {chk && chk.total > 0 && (
                      <span className="hidden shrink-0 text-[10px] tabular-nums text-[var(--fg-muted)] sm:inline">
                        ✓ {chk.done}/{chk.total}
                      </span>
                    )}
                    {kids && kids.total > 0 && (
                      <span className="hidden shrink-0 text-[10px] tabular-nums text-[var(--fg-muted)] md:inline">
                        ↳ {kids.done}/{kids.total}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && !loading && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => load({ cursor, append: true })}
            className="mx-auto mt-4 block rounded-md px-4 py-2 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-gray-200 disabled:opacity-50"
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function RequirementsPage() {
  const { networkId, ready } = useNetworkId();
  if (!ready) return <div role="status" className="px-6 py-8 text-sm text-[var(--fg-muted)]">正在确认当前网络…</div>;
  if (!networkId) return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <NetworkRequiredNotice />
    </div>
  );
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]" />}>
      {/* A new network owns new rows, cursors, capabilities and catalog reads. */}
      <RequirementsContent key={networkId} networkId={networkId} />
    </Suspense>
  );
}
