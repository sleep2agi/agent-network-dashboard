'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PlazaDepartment } from '../../lib/legion-directory';
import type { PlazaAgentSnapshot } from './plaza-perspective-metadata';
import { buildPlazaWorld, constrainPlazaCamera, fitPlazaWorld, PLAZA_CAMERA, plazaFlowPhase, plazaFlowStreak,
  plazaPath, plazaPlateCorners, projectPlazaPoint, type PlazaCamera, type PlazaVec3 } from './plaza-perspective';
import { layoutPlazaLabels } from './plaza-label-layout';
import styles from './plaza-perspective.module.css';

const control = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-xs hover:bg-[var(--hover-tint)] focus-visible:outline-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-50';
const statusColor = (status?: string) => status === 'working' ? 'var(--success)' : status === 'blocked' ? 'var(--warning)' : status === 'error' ? 'var(--danger)' : 'var(--fg-muted)';
const STATUS_LABEL: Record<string, string> = { working: '运行中', idle: '空闲', blocked: '阻塞', error: '错误', offline: '离线' };
const statusLabel = (status?: string) => STATUS_LABEL[status ?? ''] ?? status ?? '未上报';

/** Geometry is projected from XYZ; upright screen-space labels keep real aliases readable. */
export function PlazaPerspective({ platforms, selected, snapshots, onSelect }: {
  platforms: PlazaDepartment[]; selected: string | null; snapshots: Map<string, PlazaAgentSnapshot>; onSelect: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 680 });
  const [camera, setCamera] = useState<PlazaCamera>({ ...PLAZA_CAMERA });
  const [flow, setFlow] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const clock = useRef(0);
  const drag = useRef<{ id: number; x: number; y: number; camera: PlazaCamera; moved: boolean; pan: boolean } | null>(null);
  const suppressClick = useRef(false);
  const streaks = useRef(new Map<string, SVGPathElement>());
  const world = useMemo(() => buildPlazaWorld(platforms), [platforms]);
  const frame = useMemo(() => fitPlazaWorld(world, size), [world, size]);
  const current = useRef({ camera, frame, world });
  const id = useId().replaceAll(':', '');
  const helpId = `${id}-help`;

  useEffect(() => { current.current = { camera, frame, world }; }, [camera, frame, world]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    resize.observe(svg);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? heightOf(svg) : 1);
      setCamera(c => constrainPlazaCamera({ ...c, zoom: c.zoom * Math.exp(-Math.max(-150, Math.min(150, delta)) * 0.002) }));
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => { resize.disconnect(); svg.removeEventListener('wheel', wheel); };
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media.matches);
    change(); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  // The animation owns only the illuminated path, never camera, fit, or department geometry.
  useEffect(() => {
    let request = 0, previous: number | null = null, painted = 0;
    const paint = () => {
      const { world, camera, frame } = current.current;
      for (const link of world.links) {
        const element = streaks.current.get(link.id);
        if (!element) continue;
        element.setAttribute('d', plazaPath(plazaFlowStreak(link, clock.current).map(p => projectPlazaPoint(p, camera, frame))));
        element.setAttribute('data-flow-phase', plazaFlowPhase(link, clock.current).toFixed(6));
      }
    };
    paint();
    if (!flow || reducedMotion) return;
    const tick = (now: number) => {
      if (previous != null && !document.hidden) clock.current += Math.min(0.1, (now - previous) / 1000);
      previous = now;
      if (now - painted >= 32) { paint(); painted = now; }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [flow, reducedMotion, world]);
  // A paused streak still follows its world position when the camera moves.
  useEffect(() => {
    for (const link of world.links) {
      const element = streaks.current.get(link.id);
      element?.setAttribute('d', plazaPath(plazaFlowStreak(link, clock.current).map(p => projectPlazaPoint(p, camera, frame))));
      element?.setAttribute('data-flow-phase', plazaFlowPhase(link, clock.current).toFixed(6));
    }
  }, [camera, frame, world]);

  const project = (point: PlazaVec3) => projectPlazaPoint(point, camera, frame);
  const path = (points: PlazaVec3[], close = false) => plazaPath(points.map(project), close);
  const corePoint = project(world.core);
  const coreRadius = Math.max(23, Math.min(42, 68 * corePoint.scale));
  const labelLayout = layoutPlazaLabels(world.platforms.map(({ department, center }) => ({
    id: department.id, ...project(center), agents: department.agents.length,
  })), size, { x: corePoint.x - coreRadius - 30, y: corePoint.y - coreRadius - 10,
    width: coreRadius * 2 + 60, height: coreRadius * 2 + 58 }, selected);
  const reset = () => { drag.current = null; setCamera({ ...PLAZA_CAMERA }); };
  const zoom = (factor: number) => setCamera(c => constrainPlazaCamera({ ...c, zoom: c.zoom * factor }));
  const selectedWorld = world.platforms.find(p => p.department.id === selected);
  const focusSelected = () => {
    if (!selectedWorld) return;
    const p = projectPlazaPoint(selectedWorld.center, { ...camera, zoom: Math.max(1.15, camera.zoom), panX: 0, panY: 0 }, frame);
    setCamera(c => ({ ...c, zoom: Math.max(1.15, c.zoom), panX: size.width / 2 - p.x, panY: size.height / 2 + 90 - p.y }));
  };
  const objects = [
    ...world.platforms.map(platform => ({ kind: 'platform' as const, id: platform.department.id, depth: project(platform.center).depth, platform })),
    { kind: 'core' as const, id: 'network', depth: project(world.core).depth },
  ].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  return <div className={styles.scene} data-testid="plaza-perspective-scene">
    <div className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--border)] px-2 py-1">
      <span className="px-2 text-xs text-[var(--fg-muted)]">3D 平台 · {platforms.length} 个部门{labelLayout.dense ? ' · 密集概览' : ''}</span>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="3D 平台控制">
        <button type="button" className={control} onClick={() => zoom(1 / 1.2)} aria-label="缩小平台" disabled={camera.zoom <= 0.3}>−</button>
        <output className="min-w-10 text-center text-xs tabular-nums" aria-label="平台缩放">{Math.round(camera.zoom * 100)}%</output>
        <button type="button" className={control} onClick={() => zoom(1.2)} aria-label="放大平台" disabled={camera.zoom >= 4}>＋</button>
        <button type="button" className={control} onClick={focusSelected} disabled={!selectedWorld}>定位所选</button>
        <button type="button" className={control} onClick={reset} data-testid="plaza-perspective-reset" title="重置视角 (R)">重置视角</button>
        <button type="button" className={control} onClick={() => setFlow(v => !v)} disabled={reducedMotion} aria-pressed={flow && !reducedMotion} data-testid="plaza-perspective-flow">{reducedMotion ? '减少动态效果' : flow ? '暂停光流' : '播放光流'}</button>
      </div>
    </div>
    <svg ref={svgRef} viewBox={`0 0 ${size.width} ${size.height}`} className={styles.viewport}
      role="group" tabIndex={0} aria-label="可旋转的三维部门平台" aria-describedby={helpId}
      data-testid="plaza-perspective-svg" data-yaw={camera.yaw} data-pitch={camera.pitch} data-zoom={camera.zoom} data-pan-x={camera.panX} data-pan-y={camera.panY}
      data-flow-running={flow && !reducedMotion}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const key = event.key.toLowerCase();
        if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', '+', '=', '-', 'r', 'home'].includes(key)) return;
        event.preventDefault();
        if (key === 'r' || key === 'home') reset();
        else if (key === '+' || key === '=') zoom(1.2);
        else if (key === '-') zoom(1 / 1.2);
        else setCamera(c => constrainPlazaCamera(event.shiftKey
          ? { ...c, panX: c.panX + (key === 'arrowleft' ? -40 : key === 'arrowright' ? 40 : 0), panY: c.panY + (key === 'arrowup' ? -40 : key === 'arrowdown' ? 40 : 0) }
          : { ...c, yaw: c.yaw + (key === 'arrowleft' ? -0.12 : key === 'arrowright' ? 0.12 : 0), pitch: c.pitch + (key === 'arrowup' ? 0.08 : key === 'arrowdown' ? -0.08 : 0) }));
      }}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        suppressClick.current = false;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camera, moved: false, pan: event.shiftKey };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        if (!(event.buttons & 1)) { drag.current = null; return; }
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 5) return;
        start.moved = true; suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        setCamera(constrainPlazaCamera(start.pan
          ? { ...start.camera, panX: start.camera.panX + dx, panY: start.camera.panY + dy }
          : { ...start.camera, yaw: start.camera.yaw + dx * 0.005, pitch: start.camera.pitch + dy * 0.004 }));
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null;
      }}
      onPointerCancel={() => { drag.current = null; }}
      onPointerLeave={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      <defs>
        <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3" /></filter>
        <linearGradient id={`${id}-plate`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--bg-elevated)" /><stop offset="1" stopColor="var(--bg-secondary)" /></linearGradient>
        <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 8 5 L 0 10" fill="none" stroke="var(--accent-text)" strokeWidth="2" /></marker>
      </defs>
      <g aria-hidden="true" fill="none" stroke="var(--border-hover)" strokeWidth="1" opacity="0.45">
        {[-2, -1, 0, 1, 2].map(n => <path key={`x${n}`} d={path([{ x: n * 400, y: -65, z: -1200 }, { x: n * 400, y: -65, z: 1200 }])} />)}
        {[-2, -1, 0, 1, 2].map(n => <path key={`z${n}`} d={path([{ x: -1200, y: -65, z: n * 400 }, { x: 1200, y: -65, z: n * 400 }])} />)}
      </g>
      <g aria-hidden="true" fill="none" stroke="var(--accent-text)" data-testid="plaza-perspective-links">
        {world.links.map(link => <g key={link.id} data-from={link.from} data-to={link.to} data-world-length={link.length}>
          <path d={path(link.points)} strokeWidth="7" opacity="0.16" filter={`url(#${id}-glow)`} />
          <path d={path(link.points)} strokeWidth="1.2" opacity="0.65" />
          <path d={path(link.points.slice(14, 18))} strokeWidth="1.2" markerEnd={`url(#${id}-arrow)`} />
          <path ref={element => { if (element) streaks.current.set(link.id, element); else streaks.current.delete(link.id); }} strokeWidth="3" strokeLinecap="round" data-testid="plaza-perspective-streak" />
        </g>)}
      </g>
      {objects.map(object => {
        if (object.kind === 'core') {
          const p = corePoint, radius = coreRadius, markSize = radius * 1.3;
          const ring = Array.from({ length: 49 }, (_, i) => ({ x: world.core.x + Math.cos(i / 48 * Math.PI * 2) * 140, y: world.core.y - 55, z: world.core.z + Math.sin(i / 48 * Math.PI * 2) * 140 }));
          return <g key="network" aria-label="ANet 当前网络" data-testid="plaza-perspective-core">
            <path d={path(ring)} fill="none" stroke="var(--accent-text)" opacity="0.4" />
            <circle cx={p.x} cy={p.y} r={radius + 5} fill="var(--accent)" opacity="0.12" filter={`url(#${id}-glow)`} />
            <circle cx={p.x} cy={p.y} r={radius} fill="var(--bg)" stroke="var(--accent-text)" strokeWidth="1.5" />
            {(['dark', 'light'] as const).map(theme => <image key={theme} className={theme === 'dark' ? styles.darkMark : styles.lightMark}
              href={`/brand/mark-${markSize <= 32 ? 'small-' : ''}${theme}.png`} x={p.x - markSize / 2} y={p.y - markSize / 2} width={markSize} height={markSize} preserveAspectRatio="xMidYMid meet" />)}
            <text x={p.x} y={p.y + radius + 18} textAnchor="middle" fill="var(--fg-muted)" fontSize="11">ANet · 当前网络</text>
          </g>;
        }
        const { department, center } = object.platform, p = project(center), active = department.id === selected;
        const top = plazaPlateCorners(center), bottom = plazaPlateCorners(center, true);
        const faces = top.map((_, i) => [top[i], top[(i + 1) % 4], bottom[(i + 1) % 4], bottom[i]])
          .sort((a, b) => a.reduce((sum, q) => sum + project(q).depth, 0) - b.reduce((sum, q) => sum + project(q).depth, 0));
        return <g key={department.id} data-testid="plaza-perspective-department" data-department-id={department.id} onClick={() => onSelect(department.id)}
          data-world-x={center.x} data-world-y={center.y} data-world-z={center.z} data-screen-x={p.x} data-screen-y={p.y} data-depth={p.depth} data-agent-count={department.agents.length}>
          <g aria-hidden="true" style={{ cursor: 'pointer' }} stroke={active ? 'var(--accent-text)' : 'var(--border-hover)'} strokeWidth={active ? 1.8 : 1}>
            {faces.map((face, i) => <path key={i} d={path(face, true)} fill="var(--bg-elevated)" />)}
            <path d={path(top, true)} fill={`url(#${id}-plate)`} data-testid="plaza-perspective-plate" />
            <path d={path(top, true)} fill="var(--accent)" opacity={active ? 0.16 : 0.06} stroke="none" />
          </g>
        </g>;
      })}
      {/* Labels are a separate screen-space layer, so a nearer plate cannot cover the selected card. */}
      <g data-testid="plaza-perspective-labels">
        {world.platforms.map(({ department, center }) => {
          const label = labelLayout.labels.get(department.id);
          if (!label) return null;
          const p = project(center), active = department.id === selected;
          const shown = department.agents.slice(0, label.rows);
          const edgeX = Math.max(label.x, Math.min(label.x + label.width, p.x));
          const edgeY = Math.max(label.y, Math.min(label.y + label.height, p.y));
          return <g key={department.id} data-department-id={department.id} onClick={() => onSelect(department.id)}>
          <path d={plazaPath([{ x: edgeX, y: edgeY }, { x: p.x, y: p.y + 10 }])} fill="none" stroke="var(--accent-text)" opacity={active ? '0.8' : '0.35'} pointerEvents="none" aria-hidden="true" />
          <foreignObject x={label.x} y={label.y} width={label.width} height={label.height} style={{ overflow: 'visible' }}>
            <button type="button" className={styles.board} aria-pressed={active}
              aria-label={`查看${department.name}：${department.people.length}人，${department.agents.length}个Agent`} data-testid="plaza-perspective-select"
              title={`${department.name} · ${department.people.length} 名成员 · ${department.agents.length} 个 Agent · 查看全部节点与属性`}>
              <span className={styles.heading}><span className={styles.name}>{department.name}</span><span className={styles.count}>{department.agents.length} Agent</span></span>
              {shown.map(agent => {
                const snapshot = snapshots.get(agent.node_id);
                const metadata = `${snapshot?.model || '模型未上报'} · ${snapshot?.runtime || '运行时未上报'}`;
                const compactMetadata = `${snapshot?.model?.split('/').at(-1) || '模型未上报'} · ${snapshot?.runtime || '运行时未上报'}`;
                return <span key={agent.node_id} className={styles.agent} data-testid="plaza-perspective-namecard" data-node-id={agent.node_id}
                  data-session-status={snapshot?.status ?? ''} title={`${agent.alias || agent.node_id}\n任务状态：${snapshot?.status || '未上报'}\n${metadata}\n负责人：${agent.owner ?? '无负责人'}`}>
                  <span className={styles.agentText}><span className={styles.alias}>{agent.alias || agent.node_id}</span></span>
                  <span className={styles.status}><span className={styles.statusDot} style={{ background: statusColor(snapshot?.status) }} /><span className={styles.statusText}>{statusLabel(snapshot?.status)}</span></span>
                  <span className={styles.metadata}>{compactMetadata}</span>
                </span>;
              })}
              {!shown.length && <span className={styles.empty}>{department.people.length ? `${department.people.length} 名成员 · 暂无 Agent` : '暂无成员或 Agent'}</span>}
              <span className={styles.more}><span>{department.people.length} 名成员{department.unknown ? ' · 部门未可见' : ''}</span><span>{department.agents.length > shown.length ? `+${department.agents.length - shown.length} · ` : ''}查看全部 →</span></span>
            </button>
          </foreignObject>
          </g>;
        })}
      </g>
    </svg>
    <p id={helpId} className="border-t border-[var(--border)] px-3 py-2 text-[11px] leading-5 text-[var(--fg-muted)]">拖动 / 方向键旋转 · 滚轮 / ＋− 缩放 · Shift + 拖动平移 · R 重置。部门列表可键盘选择。{labelLayout.dense && '密集概览保留节点摘要，选中部门展开名片。'}{labelLayout.hidden > 0 && <span data-testid="plaza-label-overflow">{labelLayout.hidden} 个部门名片暂未展开，可放大或从部门列表选择。</span>}光流仅表示编制方向，不代表任务活动；卡片状态来自会话上报。</p>
  </div>;
}

function heightOf(svg: SVGSVGElement) { return svg.getBoundingClientRect().height; }
