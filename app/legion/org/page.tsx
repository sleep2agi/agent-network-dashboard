'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { deptFetcher, legionFetcher, legionReadError, scopedUrl, type DepartmentsResponse, type PeopleResponse } from '../../lib/legion-data';
import { buildPlazaDirectory, loadLegionDirectory } from '../../lib/legion-directory';
import { useNetworkId } from '../../lib/network-context';
import { NetworkRequiredNotice } from '../../components/NetworkRequiredNotice';
import type { Session } from '../../components/types';
import { plazaAgentSnapshots, type PlazaNodeMetadata } from '../plaza/plaza-perspective-metadata';
import { buildOrgScene, countsSummary, ORG_STATUS_LABEL, searchOrg, type OrgBody, type OrgScene, type OrgStatus } from '../../lib/org-3d';
import { OrgGalaxy, type OrgGalaxyHandle } from './OrgGalaxy';

/**
 * 军团 · 组织 3D（按部门聚团的人 / 部门 / Agent 三维图）。
 * 取数与 `/legion/plaza` 完全同口径（同一组 SWR key），布局见 `lib/org-3d.ts`。
 */

const control = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-xs hover:bg-[var(--hover-tint)] focus-visible:outline-2 focus-visible:outline-[var(--accent-text)]';
const KIND = { dept: '部门', person: '成员', agent: 'Agent' } as const;

function Row({ name, value }: { name: string; value: string }) {
  return <div className="contents"><dt className="text-[var(--fg-muted)]">{name}</dt><dd className="min-w-0 break-words [overflow-wrap:anywhere]">{value}</dd></div>;
}

function Details({ scene, body, onPick, snapshots }: {
  scene: OrgScene; body: OrgBody | null; onPick: (b: OrgBody) => void;
  snapshots: ReturnType<typeof plazaAgentSnapshots>;
}) {
  const deptName = (id: string) => scene.depts.find(d => d.id === id)?.name ?? '—';
  const item = (b: OrgBody, extra: string) => <li key={b.id}>
    <button type="button" onClick={() => onPick(b)} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs hover:bg-[var(--hover-tint)]">
      <span className="min-w-0 truncate">{b.name}</span><span className="shrink-0 text-[var(--fg-muted)]">{extra}</span>
    </button>
  </li>;
  if (!body) {
    const depts = [...scene.depts].sort((a, b) => b.agents - a.agents || b.people - a.people);
    return <section aria-label="部门概览" data-testid="org3d-details">
      <h2 className="text-sm font-semibold">部门概览</h2>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">点画布里的部门盘、成员或 Agent 查看详情；双击聚焦。</p>
      <ul className="mt-2 grid gap-0.5">{depts.map(d => item(d, `${d.people} 人 · ${d.agents} Agent`))}</ul>
    </section>;
  }
  if (body.kind === 'dept') {
    const parent = body.parentId ? scene.depts.find(d => d.id === body.parentId) : undefined;
    const children = scene.depts.filter(d => d.parentId === body.id);
    const members = scene.people.filter(p => p.deptId === body.id);
    const agents = scene.agents.filter(a => a.deptId === body.id);
    return <section aria-label="部门详情" data-testid="org3d-details" data-kind="dept">
      <p className="text-[11px] text-[var(--fg-muted)]">部门</p>
      <h2 className="break-words text-base font-semibold">{body.name}</h2>
      <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
        <Row name="上级部门" value={parent?.name ?? '顶层'} />
        <Row name="成员" value={`${body.people} 名`} />
        <Row name="Agent" value={`${body.agents} 个`} />
        <Row name="状态" value={countsSummary(body.counts)} />
      </dl>
      {body.unknown && <p className="mt-2 text-xs text-[var(--warning)]">该部门不在当前可见部门树中，已保留节点归属。</p>}
      {children.length > 0 && <><h3 className="mt-3 text-xs font-semibold">下级部门</h3><ul className="mt-1 grid gap-0.5">{children.map(d => item(d, `${d.agents} Agent`))}</ul></>}
      <h3 className="mt-3 text-xs font-semibold">成员</h3>
      {members.length ? <ul className="mt-1 grid gap-0.5">{members.map(p => item(p, `${p.agents} Agent`))}</ul> : <p className="mt-1 text-xs text-[var(--fg-muted)]">暂无成员</p>}
      <h3 className="mt-3 text-xs font-semibold">Agent（{agents.length}）</h3>
      {agents.length ? <ul className="mt-1 grid max-h-64 gap-0.5 overflow-auto">{agents.map(a => item(a, ORG_STATUS_LABEL[a.status]))}</ul> : <p className="mt-1 text-xs text-[var(--fg-muted)]">暂无 Agent</p>}
    </section>;
  }
  if (body.kind === 'person') {
    const agents = scene.agents.filter(a => a.ownerId === body.id);
    const elsewhere = new Set(agents.filter(a => a.deptId !== body.deptId).map(a => deptName(a.deptId)));
    return <section aria-label="成员详情" data-testid="org3d-details" data-kind="person">
      <p className="text-[11px] text-[var(--fg-muted)]">成员</p>
      <h2 className="break-words text-base font-semibold">{body.name}</h2>
      <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
        <Row name="用户名" value={body.person.username} />
        <Row name="所在部门" value={deptName(body.deptId)} />
        {body.person.role && <Row name="角色" value={body.person.role} />}
        <Row name="名下 Agent" value={`${body.agents} 个`} />
        <Row name="状态" value={countsSummary(body.counts)} />
        {elsewhere.size > 0 && <Row name="跨部门" value={[...elsewhere].join('、')} />}
      </dl>
      <h3 className="mt-3 text-xs font-semibold">名下 Agent</h3>
      {agents.length ? <ul className="mt-1 grid max-h-72 gap-0.5 overflow-auto">{agents.map(a => item(a, ORG_STATUS_LABEL[a.status]))}</ul> : <p className="mt-1 text-xs text-[var(--fg-muted)]">暂无 Agent</p>}
    </section>;
  }
  const snap = snapshots.get(body.agent.node_id);
  const owner = body.ownerId ? scene.people.find(p => p.id === body.ownerId) : undefined;
  return <section aria-label="Agent 详情" data-testid="org3d-details" data-kind="agent">
    <p className="text-[11px] text-[var(--fg-muted)]">Agent</p>
    <h2 className="break-words text-base font-semibold">{body.name}</h2>
    <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
      <Row name="节点 ID" value={body.agent.node_id} />
      <Row name="状态" value={ORG_STATUS_LABEL[body.status]} />
      <Row name="部门" value={deptName(body.deptId)} />
      <Row name="负责人" value={body.agent.owner ?? '无负责人'} />
      <Row name="模型" value={snap?.model ?? '未上报'} />
      <Row name="运行时" value={snap?.runtime ?? '未上报'} />
      <Row name="更新时间" value={body.agent.updated_at || '未上报'} />
    </dl>
    <div className="mt-3 flex flex-wrap gap-1">
      {body.agent.alias && <Link href={`/nodes/${encodeURIComponent(body.agent.alias)}`} className={`${control} bg-[var(--bg-elevated)] text-[var(--accent-text)]`}>打开节点页</Link>}
      {owner && <button type="button" className={`${control} bg-[var(--bg-elevated)]`} onClick={() => onPick(owner)}>查看负责人</button>}
    </div>
  </section>;
}

export default function LegionOrg3DPage() {
  const { networkId, ready: networkReady } = useNetworkId();
  const galaxy = useRef<OrgGalaxyHandle>(null);
  const [selection, setSelection] = useState<{ network: string; id: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrgStatus | null>(null);
  const [query, setQuery] = useState('');
  const people = useSWR<PeopleResponse>(networkReady && networkId ? scopedUrl('/api/hub/people?limit=100&offset=0', networkId) : null, loadLegionDirectory, { refreshInterval: 30000, shouldRetryOnError: false });
  const hierarchy = useSWR<DepartmentsResponse | null>(networkReady && networkId ? scopedUrl('/api/hub/departments', networkId) : null, deptFetcher, { refreshInterval: 60000, shouldRetryOnError: false });
  const nodes = useSWR<{ ok: boolean; nodes: PlazaNodeMetadata[] }>(networkReady && networkId ? scopedUrl('/api/hub/nodes', networkId) : null, legionFetcher, { refreshInterval: 15000, shouldRetryOnError: false });
  const status = useSWR<{ ok: boolean; sessions: Session[] }>(networkReady && networkId ? scopedUrl('/api/hub/status', networkId) : null, legionFetcher, { refreshInterval: 15000, shouldRetryOnError: false });
  const snapshots = useMemo(() => plazaAgentSnapshots(nodes.data?.nodes ?? [], status.data?.sessions ?? [], networkId), [nodes.data, status.data, networkId]);
  const directory = useMemo(() => buildPlazaDirectory(people.data, hierarchy.data), [people.data, hierarchy.data]);
  const scene = useMemo(() => buildOrgScene(directory.platforms, id => snapshots.get(id)?.status), [directory, snapshots]);
  const selectedId = selection?.network === networkId ? selection.id : null;
  const selected = useMemo<OrgBody | null>(() => !selectedId ? null
    : scene.depts.find(d => d.id === selectedId) ?? scene.people.find(p => p.id === selectedId) ?? scene.agents.find(a => a.id === selectedId) ?? null, [scene, selectedId]);
  const results = useMemo(() => searchOrg(scene, query), [scene, query]);
  const loading = !networkReady || people.isLoading || hierarchy.isLoading;
  const readError = legionReadError(people.error, hierarchy.error);
  const statusError = legionReadError(nodes.error, status.error);
  const fatal = readError?.status === 401 ? 'login' : networkReady && !networkId ? 'no-network' : readError ? 'error' : null;
  const select = (b: OrgBody | null) => setSelection(b ? { network: networkId, id: b.id } : null);
  const pick = (b: OrgBody) => { select(b); galaxy.current?.focus(b); };
  const empty = scene.depts.length === 0 || (scene.totals.people === 0 && scene.totals.agents === 0);

  return <div className="flex min-h-screen min-w-0 flex-col bg-[var(--bg)] p-3 text-[var(--fg)] sm:p-5" data-testid="org3d-page">
    <header className="mb-3 flex flex-wrap items-start justify-between gap-3 lg:pr-10">
      <div>
        <h1 className="text-xl font-semibold">军团 · 组织 3D</h1>
        <p className="mt-1 text-xs text-[var(--fg-muted)]" data-testid="org3d-counts">
          {loading ? '正在读取完整编制…' : `${scene.totals.depts} 个部门 · ${scene.totals.people} 名成员 · ${scene.totals.agents} 个 Agent`}
        </p>
        <p className="mt-1 text-[11px] text-[var(--fg-muted)]">每块圆盘是一个部门，盘内的小丘是同一负责人名下的 Agent，负责人悬浮在小丘上方。</p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <div className="relative">
          <label className="sr-only" htmlFor="org3d-search">搜索部门、成员或 Agent</label>
          <input id="org3d-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索部门 / 成员 / Agent" data-testid="org3d-search"
            onKeyDown={e => { if (e.key === 'Enter' && results[0]) { pick(results[0]); setQuery(''); } if (e.key === 'Escape') setQuery(''); }}
            className="min-h-11 w-60 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--fg)]" />
          {query && <ul className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg" data-testid="org3d-search-results">
            {results.length ? results.map(r => <li key={r.id}><button type="button" onClick={() => { pick(r); setQuery(''); }}
              className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-[var(--hover-tint)]">
              <span className="min-w-0 truncate">{r.name}</span><span className="shrink-0 text-[11px] text-[var(--fg-muted)]">{KIND[r.kind]}</span>
            </button></li>) : <li className="px-3 py-2 text-xs text-[var(--fg-muted)]">没有匹配项</li>}
          </ul>}
        </div>
        <nav className="flex flex-wrap items-center gap-1" aria-label="军团视图">
          <Link href="/legion/3d" className={control}>3D 拓扑</Link>
          <Link href="/legion/plaza" className={control}>平台视角</Link>
          <Link href="/legion" className={control}>2D 同心环</Link>
          <Link href="/org" className={control}>列表</Link>
        </nav>
      </div>
    </header>
    {fatal === 'no-network' && <NetworkRequiredNotice />}
    {fatal === 'login' && <p role="alert">会话已过期，<Link className="underline" href="/login">重新登录</Link> 后再看组织 3D。</p>}
    {fatal === 'error' && <p role="alert" className="text-sm text-[var(--danger)]">读取军团编制失败：{readError?.message}
      <button type="button" className={control} onClick={() => { void people.mutate(); void hierarchy.mutate(); }}>重试</button></p>}
    {!fatal && loading && <p role="status" className="py-12 text-center text-sm text-[var(--fg-muted)]">正在读取完整编制…</p>}
    {!fatal && !loading && empty && <p className="py-12 text-center text-sm text-[var(--fg-muted)]" data-testid="org3d-empty">当前网络暂无部门、成员或 Agent</p>}
    {!fatal && !loading && !empty && <>
      {directory.legacy && <p className="mb-2 text-xs text-[var(--warning)]">当前 Hub 未提供 Agent 独立部门能力，Agent 暂按负责人部门展示。</p>}
      {statusError && <p role="alert" className="mb-2 text-xs text-[var(--warning)]">{statusError.status === 401 ? '会话已过期，Agent 状态无法更新。' : 'Agent 状态读取失败，颜色显示为未上报。'}
        <button type="button" className={control} onClick={() => { void nodes.mutate(); void status.mutate(); }}>重试状态</button></p>}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="h-[72dvh] min-h-[420px] lg:h-[calc(100dvh-150px)]">
          <OrgGalaxy key={networkId} handleRef={galaxy} scene={scene} selected={selected} onSelect={select} statusFilter={statusFilter} onStatusFilter={setStatusFilter} />
        </div>
        <aside className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 lg:max-h-[calc(100dvh-140px)] lg:overflow-auto">
          {selected && <button type="button" onClick={() => select(null)} className={`${control} -ml-2 mb-1 text-[var(--fg-muted)]`} data-testid="org3d-clear">← 返回概览</button>}
          <Details scene={scene} body={selected} onPick={pick} snapshots={snapshots} />
        </aside>
      </div>
    </>}
  </div>;
}
