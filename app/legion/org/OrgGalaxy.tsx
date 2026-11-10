'use client';

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import {
  DEFAULT_ORG_VIEW, MAX_PITCH, MIN_PITCH, ORG_STATUSES, ORG_STATUS_LABEL, clampZoom, countsSummary, fitOrgView, focusView, hitOrg,
  layoutOrgLabels, makeProjector, projectOrgScene, relatedIds, screenDeltaToGround, type LabelRequest, type OrgBody, type OrgScene,
  type OrgStatus, type OrgView, type PlacedLabel,
} from '../../lib/org-3d';

/**
 * 组织 3D 画布。坐标、投影、避让、命中全部来自 `lib/org-3d.ts`（有单测），
 * 这里只负责画和交互。只在视图或数据变化时重画；自转时才跑 rAF，
 * 标签页隐藏时停。颜色全部取自主题 token。
 */

export interface OrgGalaxyHandle {
  focus(body: OrgBody): void;
  reset(): void;
}

interface Tokens {
  bg: string; fg: string; muted: string; accent: string; border: string; elevated: string; secondary: string;
  status: Record<OrgStatus, string>;
}

const FONT = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const SAFE = { top: 36, right: 24, bottom: 64, left: 24 };
const TRANSITION_MS = 520;
const SPIN_RAD_PER_SEC = 0.05;

function rgba(color: string, alpha: number): string {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readTokens(host: HTMLElement): Tokens {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const get = (name: string) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color; };
  const t: Tokens = {
    bg: get('--bg'), fg: get('--fg'), muted: get('--fg-muted'), accent: get('--accent'), border: get('--border'),
    elevated: get('--bg-elevated'), secondary: get('--bg-secondary'),
    status: { working: get('--success'), idle: get('--info'), blocked: get('--warning'), error: get('--danger'), offline: get('--fg-muted') },
  };
  probe.remove();
  return t;
}

/** 每种状态预渲染一个带高光的小球，画的时候 drawImage 缩放即可（几百个节点不必每帧建渐变）。 */
function makeSprites(t: Tokens): Record<OrgStatus, HTMLCanvasElement> {
  const out = {} as Record<OrgStatus, HTMLCanvasElement>;
  for (const s of ORG_STATUSES) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const base = t.status[s];
    const grad = g.createRadialGradient(24, 22, 2, 32, 32, 30);
    grad.addColorStop(0, rgba(t.fg, s === 'offline' ? 0.55 : 0.9));
    grad.addColorStop(0.28, base);
    grad.addColorStop(1, rgba(base, s === 'offline' ? 0.35 : 0.75));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(32, 32, 30, 0, Math.PI * 2);
    g.fill();
    out[s] = c;
  }
  return out;
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function OrgGalaxy({ scene, selected, onSelect, statusFilter, onStatusFilter, handleRef }: {
  scene: OrgScene;
  selected: OrgBody | null;
  onSelect: (body: OrgBody | null) => void;
  statusFilter: OrgStatus | null;
  onStatusFilter: (s: OrgStatus | null) => void;
  handleRef?: Ref<OrgGalaxyHandle>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<OrgView>({ ...DEFAULT_ORG_VIEW });
  const sizeRef = useRef({ width: 0, height: 0 });
  const tokensRef = useRef<Tokens | null>(null);
  const spritesRef = useRef<Record<OrgStatus, HTMLCanvasElement> | null>(null);
  const frameRef = useRef(0);
  const animRef = useRef<{ from: OrgView; to: OrgView; start: number } | null>(null);
  const labelsRef = useRef<PlacedLabel[]>([]);
  const projectedRef = useRef<ReturnType<typeof projectOrgScene> | null>(null);
  const widthCache = useRef(new Map<string, number>());
  const [hover, setHover] = useState<{ body: OrgBody; x: number; y: number; maxX: number } | null>(null);
  const hoverRef = useRef<OrgBody | null>(null);
  const [spinning, setSpinning] = useState(false);
  const spinRef = useRef(false);
  const lastTick = useRef(0);
  const userMoved = useRef(false);
  const fitted = useRef(false);

  const related = useMemo(() => relatedIds(scene, selected), [scene, selected]);
  const stateRef = useRef({ scene, selected, related, statusFilter });

  const drawRef = useRef<(() => void) | null>(null);
  useEffect(() => {
  const draw = () => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const t = tokensRef.current;
    const sprites = spritesRef.current;
    if (!canvas || !t || !sprites) return;
    const now = performance.now();
    const anim = animRef.current;
    if (anim) {
      const k = Math.min(1, (now - anim.start) / TRANSITION_MS);
      const e = ease(k);
      viewRef.current = {
        yaw: anim.from.yaw + (anim.to.yaw - anim.from.yaw) * e,
        pitch: anim.from.pitch + (anim.to.pitch - anim.from.pitch) * e,
        zoom: Math.exp(Math.log(anim.from.zoom) + (Math.log(anim.to.zoom) - Math.log(anim.from.zoom)) * e),
        target: { x: anim.from.target.x + (anim.to.target.x - anim.from.target.x) * e, z: anim.from.target.z + (anim.to.target.z - anim.from.target.z) * e },
      };
      if (k >= 1) animRef.current = null;
    }
    if (spinRef.current && !animRef.current) {
      const dt = lastTick.current ? Math.min(0.1, (now - lastTick.current) / 1000) : 0;
      viewRef.current = { ...viewRef.current, yaw: viewRef.current.yaw + dt * SPIN_RAD_PER_SEC };
    }
    lastTick.current = now;

    const { scene, related, statusFilter } = stateRef.current;
    const { width, height } = sizeRef.current;
    if (!fitted.current && width > 0 && height > 0) {
      viewRef.current = fitOrgView(scene, DEFAULT_ORG_VIEW, { width, height }, SAFE);
      fitted.current = true;
    }
    const dpr = window.devicePixelRatio || 1;
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const view = viewRef.current;
    const proj = makeProjector(scene, view, { width, height }, SAFE);
    const glow = g.createRadialGradient(width / 2, height * 0.55, 0, width / 2, height * 0.55, Math.max(width, height) * 0.7);
    glow.addColorStop(0, rgba(t.accent, 0.09));
    glow.addColorStop(1, rgba(t.accent, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, width, height);
    const projected = projectOrgScene(scene, proj);
    projectedRef.current = projected;
    const hovered = hoverRef.current;
    const visibleAlpha = (id: string, status?: OrgStatus) => {
      if (statusFilter && status && status !== statusFilter) return 0.12;
      if (related && !related.has(id)) return 0.16;
      return 1;
    };

    // 地面：部门盘（远 → 近），再画盘内每个负责人的小团轮廓。
    const ring = (cx: number, cz: number, r: number, y = 0, n = 56) => {
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = proj.project({ x: cx + r * Math.cos(a), y, z: cz + r * Math.sin(a) });
        if (!p) continue;
        if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      g.closePath();
    };
    for (const pd of projected.depts) {
      const d = pd.body.kind === 'dept' ? pd.body : null;
      if (!d) continue;
      const a = visibleAlpha(d.id);
      const isSel = stateRef.current.selected?.id === d.id || hovered?.id === d.id;
      ring(d.center.x, d.center.z, d.radius);
      const k = (isSel ? 1.8 : 1) * (a < 1 ? 0.5 : 1);
      const fill = g.createRadialGradient(pd.x, pd.y, 0, pd.x, pd.y, Math.max(1, pd.r));
      fill.addColorStop(0, rgba(t.accent, 0.13 * k));
      fill.addColorStop(1, rgba(t.accent, 0.04 * k));
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = isSel ? 2 : 1.2;
      g.strokeStyle = rgba(t.accent, (isSel ? 0.85 : 0.38) * (a < 1 ? 0.45 : 1));
      g.stroke();
    }
    g.lineWidth = 1;
    for (const grp of scene.groups) {
      if (proj.pixelsPerUnit * grp.radius < 6) continue;
      ring(grp.center.x, grp.center.z, grp.radius, 0, 32);
      g.strokeStyle = rgba(t.muted, related && !related.has(grp.deptId) ? 0.05 : 0.16);
      g.stroke();
    }

    // 父 → 子部门：贴地的弧线，读得出编制。
    g.setLineDash([5, 5]);
    for (const d of scene.depts) {
      if (!d.parentId) continue;
      const parent = scene.depts.find(p => p.id === d.parentId);
      if (!parent) continue;
      const dx = d.center.x - parent.center.x, dz = d.center.z - parent.center.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const from = { x: parent.center.x + ux * parent.radius, z: parent.center.z + uz * parent.radius };
      const to = { x: d.center.x - ux * d.radius, z: d.center.z - uz * d.radius };
      g.beginPath();
      for (let i = 0; i <= 16; i++) {
        const k = i / 16;
        const p = proj.project({ x: from.x + (to.x - from.x) * k, y: Math.sin(k * Math.PI) * Math.min(3, len * 0.12), z: from.z + (to.z - from.z) * k });
        if (!p) continue;
        if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
      }
      const a = related && !(related.has(d.id) || related.has(parent.id)) ? 0.12 : 0.5;
      g.strokeStyle = rgba(t.accent, a);
      g.lineWidth = 1.4;
      g.stroke();
    }
    g.setLineDash([]);

    // 选中成员：把他名下跨部门的 Agent 用细线连回来。
    const sel = stateRef.current.selected;
    if (sel?.kind === 'person') {
      const sp = proj.project(sel.pos);
      if (sp) {
        g.strokeStyle = rgba(t.accent, 0.28);
        g.lineWidth = 0.8;
        g.beginPath();
        for (const a of scene.agents) {
          if (a.ownerId !== sel.id) continue;
          const ap = proj.project(a.pos);
          if (!ap) continue;
          g.moveTo(sp.x, sp.y);
          g.lineTo(ap.x, ap.y);
        }
        g.stroke();
      }
    }

    // 节点（远 → 近）：Agent 小球、成员悬浮头像 + 立柱。
    for (const n of projected.nodes) {
      const b = n.body;
      if (b.kind === 'agent') {
        const a = visibleAlpha(b.id, b.status);
        g.globalAlpha = a * (b.status === 'offline' ? 0.7 : 1);
        const s = n.r * 2;
        g.drawImage(sprites[b.status], n.x - n.r, n.y - n.r, s, s);
        if (hovered?.id === b.id || sel?.id === b.id) {
          g.globalAlpha = 1;
          g.strokeStyle = t.fg;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
          g.stroke();
        }
      } else if (b.kind === 'person') {
        const a = visibleAlpha(b.id);
        g.globalAlpha = a;
        const base = proj.project(b.base);
        if (base) {
          g.strokeStyle = rgba(t.accent, 0.55);
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(n.x, n.y + n.r);
          g.lineTo(base.x, base.y);
          g.stroke();
        }
        g.fillStyle = t.elevated;
        g.beginPath();
        g.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = hovered?.id === b.id || sel?.id === b.id ? 3 : 2;
        g.strokeStyle = b.counts.working > 0 ? t.status.working : t.accent;
        g.stroke();
        g.fillStyle = t.fg;
        g.font = `600 ${Math.round(n.r * 0.95)}px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(Array.from(b.name)[0]?.toUpperCase() ?? '?', n.x, n.y + 0.5);
      }
    }
    g.globalAlpha = 1;

    // 标签：部门与成员必出，Agent 只在放得下（拉近）时出。
    const measure = (text: string, font: string) => {
      const key = `${font}|${text}`;
      let w = widthCache.current.get(key);
      if (w == null) { g.font = font; w = g.measureText(text).width; widthCache.current.set(key, w); }
      return w;
    };
    const deptFont = `600 12px ${FONT}`;
    const subFont = `11px ${FONT}`;
    const requests: LabelRequest[] = [];
    for (const pd of projected.depts) {
      const d = pd.body;
      if (d.kind !== 'dept') continue;
      // 锚点取盘的「远端」边缘：标签像立在盘后方的路牌，不压住盘里的节点。
      const sub = `${d.people} 人 · ${d.agents} Agent`;
      const w = Math.max(measure(d.name, deptFont), measure(sub, subFont)) + 16;
      requests.push({ id: d.id, body: d, x: pd.x, y: pd.y - pd.r * Math.sin(view.pitch), r: 2, w, h: 34, priority: 1000 + d.agents + d.people * 10, required: true });
    }
    for (const n of projected.nodes) {
      if (n.body.kind !== 'person') continue;
      const p = n.body;
      const text = `${p.name} · ${p.agents}`;
      requests.push({ id: p.id, body: p, x: n.x, y: n.y, r: n.r, w: measure(text, deptFont) + 14, h: 20, priority: 900 + p.agents, required: true });
    }
    const agentLabels = proj.pixelsPerUnit >= 22;
    if (agentLabels) {
      let budget = 160;
      for (let i = projected.nodes.length - 1; i >= 0 && budget > 0; i--) {
        const n = projected.nodes[i];
        if (n.body.kind !== 'agent' || n.x < 0 || n.y < 0 || n.x > width || n.y > height) continue;
        if (related && !related.has(n.body.id)) continue;
        if (statusFilter && n.body.status !== statusFilter) continue;
        budget--;
        requests.push({ id: n.body.id, body: n.body, x: n.x, y: n.y, r: n.r, w: measure(n.body.name, subFont) + 10, h: 16, priority: 10 - n.depth, required: false });
      }
    }
    const labels = layoutOrgLabels(requests, { width, height });
    labelsRef.current = labels;
    for (const l of labels) {
      const a = l.body.kind === 'agent' ? 1 : visibleAlpha(l.body.id) < 1 ? 0.45 : 1;
      g.globalAlpha = a;
      if (l.leader) {
        g.strokeStyle = rgba(t.muted, 0.6);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(l.anchorX, l.anchorY);
        g.lineTo(Math.max(l.x, Math.min(l.x + l.w, l.anchorX)), Math.max(l.y, Math.min(l.y + l.h, l.anchorY)));
        g.stroke();
      }
      const isSel = sel?.id === l.body.id || hovered?.id === l.body.id;
      g.fillStyle = rgba(l.body.kind === 'agent' ? t.bg : t.secondary, l.body.kind === 'agent' ? 0.78 : 0.92);
      g.strokeStyle = isSel ? t.accent : rgba(l.body.kind === 'dept' ? t.accent : t.border, l.body.kind === 'dept' ? 0.55 : 1);
      g.lineWidth = isSel ? 1.5 : 1;
      g.beginPath();
      g.roundRect(l.x, l.y, l.w, l.h, l.body.kind === 'agent' ? 4 : 8);
      g.fill();
      g.stroke();
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      if (l.body.kind === 'dept') {
        g.fillStyle = t.fg;
        g.font = deptFont;
        g.fillText(l.body.name, l.x + 8, l.y + 11);
        g.fillStyle = t.muted;
        g.font = subFont;
        g.fillText(`${l.body.people} 人 · ${l.body.agents} Agent`, l.x + 8, l.y + 24);
      } else if (l.body.kind === 'person') {
        g.fillStyle = t.fg;
        g.font = deptFont;
        g.fillText(`${l.body.name} · ${l.body.agents}`, l.x + 7, l.y + l.h / 2);
      } else {
        g.fillStyle = t.fg;
        g.font = subFont;
        g.fillText(l.body.name, l.x + 5, l.y + l.h / 2);
      }
    }
    g.globalAlpha = 1;

    canvas.dataset.labels = String(labels.length);
    canvas.dataset.forced = String(labels.filter(l => l.forced).length);
    canvas.dataset.agentLabels = String(labels.filter(l => l.body.kind === 'agent').length);
    canvas.dataset.zoom = view.zoom.toFixed(2);

    if (animRef.current || spinRef.current) frameRef.current = requestAnimationFrame(draw);
  };
  drawRef.current = draw;
  return () => { drawRef.current = null; };
  }, []);

  const requestDraw = useCallback(() => {
    const draw = drawRef.current;
    if (!frameRef.current && draw) frameRef.current = requestAnimationFrame(draw);
  }, []);

  const animateTo = useCallback((to: OrgView) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { viewRef.current = to; animRef.current = null; requestDraw(); return; }
    animRef.current = { from: { ...viewRef.current }, to, start: performance.now() };
    requestDraw();
  }, [requestDraw]);

  const resetView = useCallback(() => {
    userMoved.current = false;
    animateTo(fitOrgView(stateRef.current.scene, { ...DEFAULT_ORG_VIEW, yaw: viewRef.current.yaw }, sizeRef.current, SAFE));
  }, [animateTo]);

  useImperativeHandle(handleRef, () => ({
    focus: (body: OrgBody) => { userMoved.current = true; animateTo(focusView(scene, body, viewRef.current)); },
    reset: resetView,
  }), [animateTo, resetView, scene]);

  useLayoutEffect(() => {
    stateRef.current = { scene, selected, related, statusFilter };
    requestDraw();
  }, [scene, selected, statusFilter, related, requestDraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const refreshTokens = () => {
      tokensRef.current = readTokens(wrap);
      spritesRef.current = makeSprites(tokensRef.current);
      requestDraw();
    };
    refreshTokens();
    const themeObs = new MutationObserver(refreshTokens);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (!userMoved.current) fitted.current = false;
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(frameRef.current); frameRef.current = 0; } else { lastTick.current = 0; requestDraw(); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      themeObs.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [requestDraw]);

  useEffect(() => {
    spinRef.current = spinning;
    lastTick.current = 0;
    requestDraw();
  }, [spinning, requestDraw]);

  // ─── 交互 ───
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean; id: number } | null>(null);
  const pick = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    return { x, y, body: projectedRef.current ? hitOrg(projectedRef.current, x, y, viewRef.current.pitch, labelsRef.current) : null };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey || e.button === 2, id: e.pointerId };
    animRef.current = null;
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      const v = viewRef.current;
      userMoved.current = true;
      if (d.pan) {
        const shift = screenDeltaToGround(v, makeProjector(scene, v, sizeRef.current, SAFE).pixelsPerUnit, -dx, -dy);
        viewRef.current = { ...v, target: { x: v.target.x + shift.x, z: v.target.z + shift.z } };
      } else {
        viewRef.current = { ...v, yaw: v.yaw + dx * 0.006, pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, v.pitch - dy * 0.004)) };
      }
      if (hoverRef.current) { hoverRef.current = null; setHover(null); }
      requestDraw();
      return;
    }
    const { x, y, body } = pick(e.clientX, e.clientY);
    if (body?.id !== hoverRef.current?.id) { hoverRef.current = body; requestDraw(); }
    setHover(body ? { body, x, y, maxX: sizeRef.current.width - 270 } : null);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const { body } = pick(e.clientX, e.clientY);
    onSelect(body && body.id === selected?.id ? null : body);
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { body } = pick(e.clientX, e.clientY);
    if (body) { userMoved.current = true; onSelect(body); animateTo(focusView(scene, body, viewRef.current)); }
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      animRef.current = null;
      userMoved.current = true;
      const v = viewRef.current;
      viewRef.current = { ...v, zoom: clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0015)) };
      requestDraw();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [requestDraw]);
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    const step: Record<string, Partial<OrgView>> = {
      ArrowLeft: { yaw: v.yaw - 0.12 }, ArrowRight: { yaw: v.yaw + 0.12 },
      ArrowUp: { pitch: Math.min(MAX_PITCH, v.pitch + 0.08) }, ArrowDown: { pitch: Math.max(MIN_PITCH, v.pitch - 0.08) },
      '+': { zoom: clampZoom(v.zoom * 1.25) }, '=': { zoom: clampZoom(v.zoom * 1.25) }, '-': { zoom: clampZoom(v.zoom / 1.25) },
    };
    if (step[e.key]) { e.preventDefault(); userMoved.current = true; viewRef.current = { ...v, ...step[e.key] }; requestDraw(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); resetView(); return; }
    if (e.key === 'Escape') { if (statusFilter) onStatusFilter(null); else onSelect(null); }
  };

  const tooltip = hover && (() => {
    const b = hover.body;
    const lines = b.kind === 'dept'
      ? [b.name, `${b.people} 名成员 · ${b.agents} 个 Agent`, countsSummary(b.counts)]
      : b.kind === 'person'
        ? [b.name, `名下 ${b.agents} 个 Agent`, countsSummary(b.counts)]
        : [b.name, ORG_STATUS_LABEL[b.status], `负责人：${b.agent.owner ?? '无'}`];
    return lines;
  })();

  const summary = `组织 3D：${scene.totals.depts} 个部门、${scene.totals.people} 名成员、${scene.totals.agents} 个 Agent。拖动旋转，滚轮缩放，Shift+拖动平移，点击查看详情，双击聚焦，R 重置视角。`;
  return <div ref={wrapRef} className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]" data-testid="org3d-stage">
    <canvas ref={canvasRef} tabIndex={0} role="img" aria-label={summary} data-testid="org3d-canvas"
      data-depts={scene.totals.depts} data-people={scene.totals.people} data-agents={scene.totals.agents}
      className="absolute inset-0 block cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent-text)] active:cursor-grabbing"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerLeave={() => { if (!drag.current) { hoverRef.current = null; setHover(null); requestDraw(); } }}
      onDoubleClick={onDoubleClick} onKeyDown={onKeyDown} onContextMenu={e => e.preventDefault()} />
    {tooltip && hover && <div role="tooltip" data-testid="org3d-tooltip"
      className="pointer-events-none absolute z-10 max-w-[260px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-xs shadow-lg"
      style={{ left: Math.min(hover.x + 14, hover.maxX), top: Math.max(8, hover.y - 64) }}>
      <div className="font-semibold text-[var(--fg)]">{tooltip[0]}</div>
      {tooltip.slice(1).map(l => <div key={l} className="text-[var(--fg-muted)]">{l}</div>)}
    </div>}
    <div className="absolute right-3 top-3 flex gap-1">
      <button type="button" onClick={() => setSpinning(s => !s)} aria-pressed={spinning} data-testid="org3d-spin"
        className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)]">{spinning ? '停止自转' : '自转'}</button>
      <button type="button" onClick={resetView} data-testid="org3d-reset"
        className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)]">重置视角</button>
    </div>
    <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-1" role="group" aria-label="按状态筛选 Agent" data-testid="org3d-legend">
      {ORG_STATUSES.map(s => <button key={s} type="button" aria-pressed={statusFilter === s} onClick={() => onStatusFilter(statusFilter === s ? null : s)}
        className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs ${statusFilter === s ? 'border-[var(--accent-text)] bg-[var(--bg-elevated)]' : 'border-[var(--border)] bg-[var(--bg-secondary)]'} text-[var(--fg)] hover:bg-[var(--hover-tint)]`}>
        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--${({ working: 'success', idle: 'info', blocked: 'warning', error: 'danger', offline: 'fg-muted' } as const)[s]})` }} />
        {ORG_STATUS_LABEL[s]} {scene.totals.counts[s]}
      </button>)}
      <span className="ml-auto hidden text-[11px] text-[var(--fg-muted)] md:inline">拖动旋转 · 滚轮缩放 · Shift+拖动平移 · 双击聚焦 · R 重置</span>
    </div>
  </div>;
}
