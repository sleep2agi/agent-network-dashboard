'use client';

/**
 * 军团 —— 组织架构图（#1636 / owner 2026-10-25）。
 *
 * 数据源和 /org 同一条（Hub 通讯录投影：人 → 部门 → 名下 Agent），
 * 但这里不是列表，是三层同心环：圆心是网络，第一环部门，第二环人，
 * 最外环 Agent。
 *
 * 三条硬约束（也是这页唯一的验收口径）：
 *   1. 坐标全部来自 app/lib/legion-layout.ts 的纯函数，本组件不算角度；
 *   2. 只用 globals.css 的 token，不新增硬编码色（color-ratchet 会红）；
 *   3. 空 / 401 / 500 各有独立状态，不能用「网络里没人」掩盖鉴权或故障
 *      —— 这条和 #1636 空态修的是同一个病。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { buildLegionLayout, toPixel, type LegionPerson, type LegionAgentRef, type LegionNode } from '../lib/legion-layout';
import { EmptyState } from '../components/EmptyState';

interface PeopleResponse {
  ok: boolean;
  total: number;
  people: LegionPerson[];
  agents_without_owner?: LegionAgentRef[];
  has_more: boolean;
}

interface StatusResponse {
  sessions?: { alias: string; status: string; node_id?: string }[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw Object.assign(new Error(json?.error || `hub_${res.status}`), { status: res.status });
  return json;
};

/**
 * callback ref + ResizeObserver。
 *
 * 不能写成 useEffect(() => ..., [])：图容器只在数据到达后才挂载，
 * 而那时的 effect 早就跑过了、ref.current 还是 null —— 尺寸永远停在 0，
 * SVG 宽高是 1px，整张图静默消失（节点数 0，页面其它部分看起来正常，
 * 最容易当成「布局算法坏了」）。callback ref 在节点真正挂载/卸载时都会触发。
 */
function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observer.current = ro;
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { ref, size };
}

function statusTone(status?: string) {
  if (status === 'working' || status === 'busy') return 'var(--success)';
  if (status === 'idle' || status === 'ready') return 'var(--info)';
  if (!status || status === 'offline' || status === 'unknown') return 'var(--fg-dim)';
  return 'var(--border-hover)';
}

/** 部门扇区弧带：angle 0 = 12 点、顺时针，和布局模块同一套坐标约定。 */
function arcPath(cx: number, cy: number, r: number, start: number, span: number): string {
  const end = start + span;
  const ax = cx + r * Math.sin(start);
  const ay = cy - r * Math.cos(start);
  const bx = cx + r * Math.sin(end);
  const by = cy - r * Math.cos(end);
  return `M ${ax} ${ay} A ${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${bx} ${by}`;
}

function ringLabel(node: LegionNode): string {
  if (node.kind === 'core') return '圆心';
  if (node.kind === 'group') return '部门';
  if (node.kind === 'person') return '成员';
  return 'Agent';
}

export default function LegionPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // 悬停/聚焦只影响亮度，不改布局：图不能因为鼠标划过就重排。
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const [needsLogin, setNeedsLogin] = useState(false);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const { ref, size } = useElementSize<HTMLDivElement>();

  const people = useSWR<PeopleResponse>('/api/hub/people?limit=200&offset=0', fetcher, {
    refreshInterval: 30000,
    shouldRetryOnError: false,
    onError: (err: Error & { status?: number }) => { if (err.status === 401) setNeedsLogin(true); },
  });
  const status = useSWR<StatusResponse>('/api/hub/status', fetcher, {
    refreshInterval: 15000,
    shouldRetryOnError: false,
  });

  const peopleList = people.data?.people ?? [];
  const orphans = people.data?.agents_without_owner ?? [];
  const layout = useMemo(
    () => buildLegionLayout({ people: peopleList, orphans }),
    [peopleList, orphans],
  );
  const statusByAlias = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of status.data?.sessions ?? []) map.set(s.alias, s.status);
    return map;
  }, [status.data]);

  const points = useMemo(() => {
    if (size.width === 0 || size.height === 0) return new Map<string, { x: number; y: number }>();
    const map = new Map<string, { x: number; y: number }>();
    for (const node of layout.nodes) map.set(node.id, toPixel(node, size, 0.84));
    return map;
  }, [layout, size]);

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set<string>();
    for (const node of layout.nodes) {
      if (`${node.label} ${node.sublabel ?? ''}`.toLowerCase().includes(q)) hit.add(node.id);
    }
    // 命中的人/部门把子孙节点一起点亮，否则搜「平台」只能看见一个点。
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of layout.edges) {
        if (hit.has(edge.from) && !hit.has(edge.to)) { hit.add(edge.to); grew = true; }
      }
    }
    return hit;
  }, [layout, query]);

  const { childrenOf, parentOf } = useMemo(() => {
    const children = new Map<string, string[]>();
    const parents = new Map<string, string>();
    for (const edge of layout.edges) {
      const arr = children.get(edge.from) ?? [];
      arr.push(edge.to);
      children.set(edge.from, arr);
      parents.set(edge.to, edge.from);
    }
    return { childrenOf: children, parentOf: parents };
  }, [layout]);

  /** 一个节点的「血脉」：向上到圆心，向下到所有子孙。悬停时只点亮这一支。 */
  const related = useCallback((id: string) => {
    const set = new Set<string>([id]);
    for (let cur = parentOf.get(id); cur && !set.has(cur); cur = parentOf.get(cur)) set.add(cur);
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const child of childrenOf.get(cur) ?? []) {
        if (!set.has(child)) { set.add(child); stack.push(child); }
      }
    }
    return set;
  }, [childrenOf, parentOf]);

  // 搜索优先于悬停/聚焦：正在找东西时，鼠标划过不该把命中结果盖掉。
  const activeSet = useMemo(() => {
    if (matched) return matched;
    const anchor = hovered ?? focusGroup;
    return anchor ? related(anchor) : null;
  }, [matched, hovered, focusGroup, related]);

  const selectedNode = layout.nodes.find(n => n.id === selected) ?? null;
  const selectedChildren = selected
    ? layout.nodes.filter(n => n.parentId === selected)
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelected(null);
      setFocusGroup(null);
      setHovered(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reset = useCallback(() => setView({ k: 1, tx: 0, ty: 0 }), []);
  const zoomBy = useCallback((factor: number) => {
    setView(v => {
      const k = Math.min(3, Math.max(0.5, v.k * factor));
      const cx = size.width / 2;
      const cy = size.height / 2;
      // 围绕容器中心缩放：平移量随比例同步，避免缩小时图跑出画布。
      return { k, tx: cx - (cx - v.tx) * (k / v.k), ty: cy - (cy - v.ty) * (k / v.k) };
    });
  }, [size.height, size.width]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setView(v => ({ ...v, tx: drag.current!.tx + (e.clientX - drag.current!.x), ty: drag.current!.ty + (e.clientY - drag.current!.y) }));
  };
  const onPointerUp = () => { drag.current = null; };

  const baseRadius = (Math.min(size.width, size.height) / 2) * 0.84;
  const loading = people.isLoading && !people.data;
  const error = people.error as (Error & { status?: number }) | undefined;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Legion</h1>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              军团编制：圆心是网络，外三环依次是部门、成员与名下 Agent。
            </p>
            {focusGroup && (
              <span className="mt-2 inline-flex items-center gap-2 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-[11px] text-[var(--fg)]">
                聚焦：{layout.nodes.find(n => n.id === focusGroup)?.label}
                <button type="button" onClick={() => setFocusGroup(null)} aria-label="取消聚焦" className="text-[var(--fg-muted)] hover:text-[var(--fg)]">
                  ✕
                </button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-1.5">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜索成员 / 部门 / Agent"
                aria-label="搜索军团成员"
                className="w-40 bg-transparent text-sm text-white placeholder:text-[var(--fg-dim)] focus:outline-none sm:w-56"
              />
            </div>
            <Link href="/org" className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-gray-200">
              列表视图
            </Link>
          </div>
        </div>

        {needsLogin || error?.status === 401 ? (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            会话已过期，<Link href="/login" className="underline">重新登录</Link> 后再看军团编制。
          </div>
        ) : null}
        {error && error.status !== 401 ? (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            读取失败：{error.message}
            <button type="button" onClick={() => people.mutate()} className="ml-3 underline">重试</button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex h-[62vh] min-h-[420px] items-center justify-center rounded-xl bg-[var(--bg-secondary)]">
            <div className="h-40 w-40 animate-pulse rounded-full border border-[var(--border)]" />
          </div>
        ) : !needsLogin && !error && layout.stats.people === 0 && layout.stats.orphans === 0 ? (
          <EmptyState
            variant="nodes"
            title="军团还没有成员"
            sub="成员加入网络并绑定 Agent 后，这里会自动长出编制。"
          />
        ) : needsLogin || error ? null : (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div
              ref={ref}
              className="relative h-[62vh] min-h-[420px] overflow-hidden rounded-xl bg-[var(--bg-secondary)]"
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onDoubleClick={reset}
            >
              <svg width={size.width || 1} height={size.height || 1} className="block touch-none select-none" role="img" aria-label="军团组织架构图">
                <defs>
                  <radialGradient id="legion-core" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="var(--bg-elevated)" />
                    <stop offset="100%" stopColor="var(--bg-secondary)" />
                  </radialGradient>
                </defs>
                <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
                  {layout.rings.map(ring => (
                    <circle
                      key={ring.ring}
                      cx={size.width / 2}
                      cy={size.height / 2}
                      r={(Math.min(size.width, size.height) / 2) * 0.84 * ring.radius}
                      fill="none"
                      stroke="var(--border)"
                      strokeDasharray="2 6"
                      opacity={0.7}
                    />
                  ))}

                  {/* 部门扇区：一条细弧把「这个部门占多大角度」画出来，
                      比纯圆点更容易看出编制比例，也不用引入新颜色。 */}
                  {layout.nodes.filter(n => n.kind === 'group' && n.span && n.spanStart !== undefined).map(node => {
                    const on = !activeSet || activeSet.has(node.id);
                    const focused = focusGroup === node.id;
                    return (
                      <path
                        key={`sector:${node.id}`}
                        data-role="sector"
                        d={arcPath(size.width / 2, size.height / 2, baseRadius * 0.33, node.spanStart!, node.span!)}
                        fill="none"
                        stroke={focused ? 'var(--hl)' : 'var(--border-hover)'}
                        strokeWidth={focused ? 3 : 2}
                        strokeLinecap="butt"
                        opacity={on ? (focused ? 0.95 : 0.55) : 0.08}
                      />
                    );
                  })}

                  {layout.edges.map(edge => {
                    const a = points.get(edge.from);
                    const b = points.get(edge.to);
                    if (!a || !b) return null;
                    const target = layout.nodes.find(n => n.id === edge.to);
                    const dim = activeSet && !(activeSet.has(edge.from) && activeSet.has(edge.to));
                    const working = target?.kind === 'agent' && statusByAlias.get(target.label) === 'working';
                    return (
                      <path
                        key={edge.id}
                        d={`M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2} ${b.x} ${b.y}`}
                        fill="none"
                        stroke={working ? 'var(--success)' : 'var(--border-hover)'}
                        strokeWidth={working ? 1.4 : 1}
                        strokeDasharray={working ? '4 4' : undefined}
                        className={working ? 'legion-flow' : undefined}
                        opacity={dim ? 0.08 : working ? 0.85 : 0.4}
                      />
                    );
                  })}

                  {layout.nodes.map(node => {
                    const p = points.get(node.id);
                    if (!p) return null;
                    const dim = activeSet ? !activeSet.has(node.id) : false;
                    const isSelected = selected === node.id;
                    const statusValue = node.kind === 'agent' ? statusByAlias.get(node.label) : undefined;
                    const r = node.kind === 'core' ? 42 : node.kind === 'group' ? 22 : node.kind === 'person' ? 13 : 6;
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${p.x} ${p.y})`}
                        opacity={dim ? 0.1 : 1}
                        tabIndex={0}
                        role="button"
                        aria-label={`${ringLabel(node)} ${node.label}`}
                        onMouseEnter={() => setHovered(node.id)}
                        onMouseLeave={() => setHovered(h => (h === node.id ? null : h))}
                        onFocus={() => setHovered(node.id)}
                        onBlur={() => setHovered(h => (h === node.id ? null : h))}
                        onClick={(e) => { e.stopPropagation(); setSelected(node.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(node.id); } }}
                        className="cursor-pointer outline-none focus-visible:opacity-80"
                      >
                        {/* 透明命中区：<g> 的包围盒中心常常落在圆与标签之间的空白里，
                            只靠已绘制的圆去接点击，用户点“名字”是点不中的。 */}
                        <circle
                          r={node.kind === 'core' ? 50 : node.kind === 'group' ? r + 14 : node.kind === 'person' ? r + 6 : r + 5}
                          fill="transparent"
                          style={{ pointerEvents: 'all' }}
                        />
                        {node.kind === 'core' ? (
                          <>
                            <circle r={r} fill="url(#legion-core)" stroke={isSelected ? 'var(--hl)' : 'var(--border-hover)'} strokeWidth={isSelected ? 2 : 1} />
                            <text textAnchor="middle" y={-2} className="fill-[var(--fg)] text-[11px] font-semibold">{node.label}</text>
                            <text textAnchor="middle" y={13} className="fill-[var(--fg-muted)] text-[10px]">
                              {layout.stats.people} 人 · {layout.stats.agents} Agent
                            </text>
                          </>
                        ) : node.kind === 'group' ? (
                          <>
                            <circle r={r} fill="var(--bg-elevated)" stroke={isSelected ? 'var(--hl)' : 'var(--border)'} strokeWidth={isSelected ? 2 : 1} />
                            <text textAnchor="middle" y={4} className="fill-[var(--fg)] text-[10px]">
                              {node.label.slice(0, 4)}
                            </text>
                            <text
                              textAnchor="middle"
                              x={-Math.sin(node.angle) * (r + 16)}
                              y={Math.cos(node.angle) * (r + 16) + 3}
                              className="fill-[var(--fg-muted)] text-[10px] [paint-order:stroke] [stroke:var(--bg-secondary)] [stroke-width:3px]"
                            >
                              {node.sublabel}
                            </text>
                          </>
                        ) : node.kind === 'person' ? (
                          <>
                            <circle r={r} fill="var(--bg)" stroke={isSelected ? 'var(--hl)' : 'var(--border-hover)'} strokeWidth={isSelected ? 2 : 1} />
                            <text textAnchor="middle" y={4} className="fill-[var(--fg)] text-[9px] font-medium">
                              {(node.label || '?').slice(0, 1).toUpperCase()}
                            </text>
                            <text
                              textAnchor="middle"
                              x={-Math.sin(node.angle) * (r + 22)}
                              y={Math.cos(node.angle) * (r + 22) + 3}
                              className="fill-[var(--fg)] text-[10px] [paint-order:stroke] [stroke:var(--bg-secondary)] [stroke-width:3px]"
                            >
                              {node.label.length > 8 ? `${node.label.slice(0, 8)}…` : node.label}
                            </text>

                          </>
                        ) : (
                          <>
                            <circle r={r + 3} fill="none" stroke="var(--bg-secondary)" strokeWidth={2} />
                            <circle r={r} fill={statusTone(statusValue)} stroke={isSelected ? 'var(--hl)' : 'none'} strokeWidth={isSelected ? 2 : 0} />
                            {(view.k >= 1.15 || isSelected) && (
                              <text
                                textAnchor="middle"
                                y={r + 14}
                                className="fill-[var(--fg-muted)] text-[9px]"
                              >
                                {node.label.length > 10 ? `${node.label.slice(0, 10)}…` : node.label}
                              </text>
                            )}
                          </>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>

              <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg bg-[var(--bg)]/80 p-1 backdrop-blur">
                <button type="button" onClick={() => zoomBy(1.2)} aria-label="放大" className="rounded px-2 py-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]">＋</button>
                <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="缩小" className="rounded px-2 py-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]">－</button>
                <button type="button" onClick={reset} aria-label="重置视图" className="rounded px-2 py-1 text-[10px] text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]">重置</button>
                <span className="px-1 text-[10px] tabular-nums text-[var(--fg-dim)]">{Math.round(view.k * 100)}%</span>
              </div>

              <div className="absolute right-3 top-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--bg)]/80 px-2 py-1 text-[10px] text-[var(--fg-muted)] backdrop-blur">
                <span className="inline-flex items-center gap-1"><i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} />working</span>
                <span className="inline-flex items-center gap-1"><i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--info)' }} />idle</span>
                <span className="inline-flex items-center gap-1"><i className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--fg-dim)' }} />offline</span>
              </div>
            </div>

            <aside data-testid="legion-panel" className="rounded-xl bg-[var(--bg-secondary)] p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xs uppercase tracking-wide text-[var(--fg-muted)]">
                  {selectedNode ? ringLabel(selectedNode) : '编制'}
                </h2>
                {selectedNode && (
                  <button type="button" onClick={() => setSelected(null)} className="text-[10px] text-[var(--fg-muted)] hover:text-[var(--fg)]">
                    返回全体
                  </button>
                )}
              </div>

              {selectedNode ? (
                <>
                  <p className="mt-2 text-sm font-semibold text-[var(--fg)]">{selectedNode.label}</p>
                  {selectedNode.sublabel && <p className="text-[11px] text-[var(--fg-muted)]">{selectedNode.sublabel}</p>}

                  {selectedNode.kind === 'agent' && (
                    <Link
                      href={`/nodes/${encodeURIComponent(selectedNode.label)}`}
                      className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)]"
                    >
                      打开会话
                    </Link>
                  )}
                  {selectedNode.kind === 'group' && (
                    <button
                      type="button"
                      onClick={() => setFocusGroup(f => (f === selectedNode.id ? null : selectedNode.id))}
                      className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)]"
                    >
                      {focusGroup === selectedNode.id ? '取消聚焦' : '只看这个部门'}
                    </button>
                  )}
                  {selectedChildren.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {selectedChildren.map(child => (
                        <li key={child.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(child.id)}
                            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)]"
                          >
                            <span className="truncate">{child.label}</span>
                            <span className="ml-2 shrink-0 text-[10px] text-[var(--fg-muted)]">
                              {child.kind === 'agent' ? (statusByAlias.get(child.label) ?? '—') : `${child.agentCount}`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[11px] text-[var(--fg-muted)]">
                      {selectedNode.kind === 'agent' ? `状态：${statusByAlias.get(selectedNode.label) ?? '未知'}` : '没有下级节点。'}
                    </p>
                  )}
                </>
              ) : (
                <dl className="mt-3 space-y-2 text-xs">
                  {[
                    ['部门', layout.stats.groups],
                    ['成员', layout.stats.people],
                    ['Agent', layout.stats.agents],
                    ['无主 Agent', layout.stats.orphans],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between">
                      <dt className="text-[var(--fg-muted)]">{label}</dt>
                      <dd className="tabular-nums text-[var(--fg)]">{value}</dd>
                    </div>
                  ))}
                  <p className="pt-2 text-[11px] leading-relaxed text-[var(--fg-muted)]">
                    点击任意节点查看它的下级；滚轮缩放，拖拽平移，双击复位。
                  </p>
                </dl>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
