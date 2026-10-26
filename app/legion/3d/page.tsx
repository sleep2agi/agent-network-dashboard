'use client';

/**
 * 军团 · 3D 网络拓扑（owner 2026-10-26、与神明共同打磨视觉）。
 *
 * 和 `/legion` 同一份数据、同一套布局（legion-layout.ts），区别只在渲染：
 * 2D 是平铺的同心环，这里是把每层环抬到不同高度的「轨道塔」，用透视投影
 * 画在 Canvas 上 —— 斜着看是一叠错开的轨道，转起来有纵深。
 *
 * 三条硬约束（沿用 2D 页）：
 *   1. 坐标全部来自纯函数（legion-layout.ts + legion-3d.ts），组件不自己
 *      算角度/投影；3D 的旋转矩阵、深度排序、命中测试都有单测钉住。
 *   2. 颜色只读 globals.css 的 token（--accent / --success / --warning /
 *      --danger / --fg-*），深色、浅色、薄荷主题各自成立，不新增硬编码色。
 *   3. 空 / 加载 / 401 / 500 各有独立状态，绝不用「军团没人」掩盖故障。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { buildLegionLayout, type LegionNode } from '../../lib/legion-layout';
import { legionFetcher, deptFetcher, type PeopleResponse, type DepartmentsResponse, type StatusResponse } from '../../lib/legion-data';
import { hitTest, nodeToVec3, projectPoint, projectScene, ringPath, RING_HEIGHT, type SceneNode } from '../../lib/legion-3d';
import { EmptyState } from '../../components/EmptyState';

// 神明给的参数（PPT 首页 3D 图，admin 已认可）：俯仰约 25–30°、柔和透视
// （别用强广角，远景缩成点就没有军团体量感）、自转 0.02–0.03 rad/s。
// 实现上把「透视强度」和「缩放」拆开：dist 固定大一点 = 透视更平，
// 滚轮改的是 zoom（scale），不再同时改变透视。
const DEFAULT_VIEW = { yaw: 0.62, pitch: 0.52, dist: 6.0, zoom: 1.12 };
const MIN_ZOOM = 0.62;
const MAX_ZOOM = 2.4;
const SPIN_RAD_PER_SEC = 0.027;
const IDLE_BEFORE_SPIN = 3000;

const KIND_LABEL: Record<LegionNode['kind'], string> = {
  core: '网络',
  group: '部门',
  person: '成员',
  agent: 'Agent',
};

/** 世界坐标里的节点半径（屏幕半径 = 世界半径 × 透视缩放）。 */
const WORLD_R: Record<LegionNode['kind'], number> = {
  core: 0.085,
  group: 0.052,
  person: 0.033,
  agent: 0.021,
};

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--bg', '#0b0b0d'),
    fg: v('--fg', '#e5e7eb'),
    muted: v('--fg-muted', '#9ca3af'),
    dim: v('--fg-dim', '#6b7280'),
    border: v('--border', '#26262b'),
    accent: v('--accent', '#8b5cf6'),
    success: v('--success', '#10b981'),
    warning: v('--warning', '#f59e0b'),
    danger: v('--danger', '#ef4444'),
    info: v('--info', '#3b82f6'),
  };
}

type Tokens = ReturnType<typeof readTokens>;

/** 底色是不是深色。浅底上「辉光」会变成一圈脏灰，必须换画法：
 *  深底靠 shadowBlur 发光，浅底靠实心 + 描边。 */
function isDarkBg(hex: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return true;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/** token 颜色 → 带 alpha 的 rgba（Canvas 渐变要 alpha 停靠点）。
 *  token 目前都是 #rrggbb；万一主题换成 rgb()/oklch，退回一个中性紫，
 *  不让一个颜色格式把整张图搞成透明。 */
function hexToRgba(color: string, alpha: number): string {
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(hex);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map(v => parseFloat(v));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(139,92,246,${alpha})`;
}

function statusColor(status: string | undefined, tk: Tokens): string {
  if (status === 'working') return tk.success;
  if (status === 'blocked') return tk.warning;
  if (status === 'error') return tk.danger;
  // 神明：深底上灰色会「消失」，离线/空闲不要换成灰，改用主色降透明度。
  if (status === 'idle') return tk.fg;
  return tk.fg;
}

function nodeColor(node: LegionNode, tk: Tokens, statusByAlias: Map<string, string>): string {
  if (node.kind === 'core') return tk.accent;
  if (node.kind === 'group') return tk.info;
  if (node.kind === 'agent') return statusColor(statusByAlias.get(node.label), tk);
  // 成员：有任意 Agent 在跑就跟着亮，否则用主文字色。
  const working = node.agentCount > 0 && statusByAlias.get(node.label) === 'working';
  return working ? tk.success : tk.fg;
}

/** 确定性星空（同一块画布每次刷新星位一致，不会「闪」成噪点）。 */
function makeStars(count: number) {
  let seed = 20261026;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    r: 0.4 + rand() * 1.1,
    a: 0.08 + rand() * 0.32,
    speed: 0.3 + rand() * 1.4,
  }));
}

export default function Legion3DPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [spin, setSpin] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  // 舞台高度按「窗口底 − 舞台顶 − 父级底部安全区」算：顶部有 HealthBanner、
  // 手机底部有 5rem 安全区，写死 100vh 一定会多出一条滚动条。
  const [stageHeight, setStageHeight] = useState<number | null>(null);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ ...DEFAULT_VIEW });
  const spinRef = useRef(true);
  const selectedRef = useRef<string | null>(null);
  const lastInteract = useRef(0);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ span: number; dist: number } | null>(null);
  const screenRef = useRef<Array<SceneNode<LegionNode>>>([]);
  const starsRef = useRef(makeStars(160));

  const people = useSWR<PeopleResponse>('/api/hub/people?limit=200&offset=0', legionFetcher, {
    refreshInterval: 30000,
    shouldRetryOnError: false,
    onError: (err: Error & { status?: number }) => { if (err.status === 401) setNeedsLogin(true); },
  });
  const hierarchy = useSWR<DepartmentsResponse | null>('/api/hub/departments', deptFetcher, {
    refreshInterval: 60000,
    shouldRetryOnError: false,
  });
  const status = useSWR<StatusResponse>('/api/hub/status', legionFetcher, {
    refreshInterval: 15000,
    shouldRetryOnError: false,
  });

  const peopleList = people.data?.people ?? [];
  const orphans = people.data?.agents_without_owner ?? [];
  const layout = useMemo(
    () => buildLegionLayout({
      people: peopleList,
      orphans,
      departments: hierarchy.data?.departments,
      members: hierarchy.data?.members,
    }),
    [peopleList, orphans, hierarchy.data],
  );

  const statusByAlias = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of status.data?.sessions ?? []) map.set(s.alias, s.status);
    return map;
  }, [status.data]);

  const selectedNode = useMemo(
    () => (selected ? layout.nodes.find(n => n.id === selected) ?? null : null),
    [layout.nodes, selected],
  );

  /** 选中节点的「血脉」：向上到圆心、向下到子孙，与 2D 页高亮口径一致。 */
  const related = useMemo(() => {
    if (!selected) return null;
    const children = new Map<string, string[]>();
    const parent = new Map<string, string>();
    for (const e of layout.edges) {
      const arr = children.get(e.from) ?? [];
      arr.push(e.to);
      children.set(e.from, arr);
      parent.set(e.to, e.from);
    }
    const set = new Set<string>([selected]);
    for (let cur = parent.get(selected); cur && !set.has(cur); cur = parent.get(cur)) set.add(cur);
    const stack = [selected];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of children.get(cur) ?? []) {
        if (!set.has(child)) { set.add(child); stack.push(child); }
      }
    }
    return set;
  }, [layout.edges, selected]);

  const ringRadii = useMemo(() => layout.rings.map(r => ({ ring: r.ring, radius: r.radius })), [layout.rings]);

  useEffect(() => { spinRef.current = spin; }, [spin]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const padB = parseFloat(getComputedStyle(el.parentElement ?? document.body).paddingBottom) || 0;
      setStageHeight(Math.max(480, Math.round(window.innerHeight - top - padB)));
    };
    // 首帧时 HealthBanner / 侧栏可能还没定高，直接读 top 会读到 0；
    // 放到下一帧再量，并补一次 300ms 后的校正（字体/横幅落位）。
    const raf = requestAnimationFrame(fit);
    const t = setTimeout(fit, 300);
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setSize({ width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) });
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  /* ── 渲染循环 ───────────────────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width < 2 || size.height < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const tk = readTokens();
    // 主题切换后 canvas 不会重建，每帧读一次 token 并重算明暗（成本可忽略）。
    let dark = isDarkBg(tk.bg);
    let raf = 0;
    let stopped = false;
    let lastFrame = performance.now();

    let frame = 0;
    const draw = (now: number) => {
      if (stopped) return;
      // 每 30 帧重读一次 token 就够跟手（主题切换不是逐帧事件）。
      if (frame++ % 30 === 0) {
        Object.assign(tk, readTokens());
        dark = isDarkBg(tk.bg);
      }
      const view = viewRef.current;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      if (spinRef.current && now - lastInteract.current > IDLE_BEFORE_SPIN) {
        view.yaw += SPIN_RAD_PER_SEC * dt;
      }
      // 小屏用更长的焦距把图放大：375 宽时 min(w,h) 只有 375，
      // 按桌面系数算整张图只有硬币大，留白像坏了。
      const narrow = size.width < 640;
      const cam = {
        yaw: view.yaw,
        pitch: view.pitch,
        dist: view.dist,
        focal: Math.min(size.width, size.height) * (narrow ? 2.4 : 1.73) * view.zoom,
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);

      // 底：径向渐变（圆心略亮，向外沉入底色），不靠纯色块。
      const g = ctx.createRadialGradient(
        size.width / 2, size.height * 0.5, 0,
        size.width / 2, size.height * 0.5, Math.max(size.width, size.height) * 0.7,
      );
      g.addColorStop(0, dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)');
      g.addColorStop(0.55, dark ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.008)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = tk.bg;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size.width, size.height);

      // 星野：轻微闪烁，给自转一个参照系。
      ctx.save();
      for (const s of starsRef.current) {
        const tw = 0.65 + 0.35 * Math.sin((now / 1000) * s.speed + s.x * 12);
        ctx.globalAlpha = s.a * tw;
        ctx.fillStyle = tk.fg;
        ctx.beginPath();
        ctx.arc(s.x * size.width, s.y * size.height, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 轨道环：每层一个，最外层用虚线，观感上更像「边界」而不是实体墙。
      ctx.lineWidth = 1;
      for (const ring of ringRadii) {
        const pts = ringPath(ring.radius, RING_HEIGHT[ring.ring] ?? 0, cam, size, 120);
        if (pts.length < 2) continue;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.setLineDash(ring.ring === 3 ? [3, 6] : []);
        ctx.strokeStyle = ring.ring === 3 ? tk.border : tk.fg;
        ctx.globalAlpha = ring.ring === 3 ? 0.45 : 0.09;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([]);

      // 地面网格：最底层再铺三圈同心环，给纵深一个参照（否则上下层会糊在一起）。
      for (const r of [0.34, 0.67, 1.0]) {
        const pts = ringPath(r, (RING_HEIGHT[3] ?? 0) - 0.12, cam, size, 96);
        if (pts.length < 2) continue;
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = tk.border;
        ctx.globalAlpha = 0.22;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const toPoint = (n: LegionNode) => nodeToVec3({ ...n });
      const nodes = projectScene(layout.nodes, toPoint, cam, size);
      screenRef.current = nodes;
      const byId = new Map(nodes.map(n => [n.item.id, n]));
      const core = byId.get('core');
      const byIdProbe = () => (core ? { x: core.projected.x, y: core.projected.y } : null);

      const near = Math.max(0.2, cam.dist - 1.1);
      const far = cam.dist + 1.6;

      // 部门扇区：把每个部门在环上占的弧度画成一段半透明弧带。
      // 只有一层环没有层级感；有了扇区，一眼能看出「这块是哪个部门」。
      for (const node of layout.nodes) {
        if (node.kind !== 'group' || !node.span || node.span < 0.22) continue;
        const rOuter = node.radius;
        const rInner = Math.max(0.08, node.radius - 0.042);
        const y = RING_HEIGHT[1] ?? 0;
        const steps = Math.max(6, Math.round(node.span * 18));
        const outer: Array<{ x: number; y: number }> = [];
        const inner: Array<{ x: number; y: number }> = [];
        for (let i = 0; i <= steps; i++) {
          const a = (node.spanStart ?? 0) + node.span * (i / steps);
          const po = projectPoint({ x: Math.sin(a) * rOuter, y, z: Math.cos(a) * rOuter }, cam, size);
          const pi = projectPoint({ x: Math.sin(a) * rInner, y, z: Math.cos(a) * rInner }, cam, size);
          if (po) outer.push({ x: po.x, y: po.y });
          if (pi) inner.push({ x: pi.x, y: pi.y });
        }
        if (outer.length < 2 || inner.length < 2) continue;
        const lit = related?.has(node.id) ?? false;
        ctx.beginPath();
        outer.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i].x, inner[i].y);
        ctx.closePath();
        ctx.fillStyle = lit ? tk.accent : tk.info;
        ctx.globalAlpha = related ? (lit ? 0.22 : 0.04) : 0.085;
        ctx.fill();
        ctx.globalAlpha = related ? (lit ? 0.5 : 0.08) : 0.22;
        ctx.strokeStyle = lit ? tk.accent : tk.info;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // 圆心光晕：给整张图一个视觉重心，不然四周的环会散掉。
      const coreCenter = byIdProbe();
      if (coreCenter) {
        const halo = ctx.createRadialGradient(coreCenter.x, coreCenter.y, 0, coreCenter.x, coreCenter.y, Math.min(size.width, size.height) * 0.34);
        halo.addColorStop(0, hexToRgba(tk.accent, dark ? 0.16 : 0.08));
        halo.addColorStop(0.45, hexToRgba(tk.accent, dark ? 0.05 : 0.025));
        halo.addColorStop(1, hexToRgba(tk.accent, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, size.width, size.height);
      }

      // 连线：三层画法（神明参数）——先把所有线铺一层模糊光晕，再压实线，
      // 最后才是流动光点。只有实线时深底上会「断」，加光晕才有发光感。
      if (dark) {
      ctx.save();
      ctx.shadowColor = tk.accent;
      ctx.shadowBlur = 9;
      for (const edge of layout.edges) {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) continue;
        const lit = !related || (related.has(edge.from) && related.has(edge.to));
        if (!lit) continue;
        ctx.beginPath();
        ctx.moveTo(a.projected.x, a.projected.y);
        ctx.lineTo(b.projected.x, b.projected.y);
        ctx.strokeStyle = tk.accent;
        ctx.globalAlpha = related ? 0.16 : 0.1;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      }

      for (const edge of layout.edges) {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) continue;
        const lit = !related || (related.has(edge.from) && related.has(edge.to));
        ctx.beginPath();
        ctx.moveTo(a.projected.x, a.projected.y);
        ctx.lineTo(b.projected.x, b.projected.y);
        ctx.strokeStyle = lit && related ? tk.accent : tk.border;
        ctx.globalAlpha = lit ? (related ? 0.8 : 0.42) : 0.1;
        ctx.lineWidth = lit && related ? 1.3 : 1;
        ctx.stroke();
      }
      // 流动光点：每条连线上一个小点沿边移动，让静态的图「有心跳」。
      const phase = (now / 2600) % 1;
      for (let i = 0; i < layout.edges.length; i++) {
        const edge = layout.edges[i];
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) continue;
        if (related && !(related.has(edge.from) && related.has(edge.to))) continue;
        const t = (phase + (i * 0.37) % 1) % 1;
        const x = a.projected.x + (b.projected.x - a.projected.x) * t;
        const y = a.projected.y + (b.projected.y - a.projected.y) * t;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = tk.fg;
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 节点：远→近（projectScene 已排序），近的盖住远的。
      for (const sn of nodes) {
        const node = sn.item;
        const p = sn.projected;
        const r = Math.max(1.4, WORLD_R[node.kind] * p.scale);
        const depthT = Math.min(1, Math.max(0, (p.depth - near) / (far - near)));
        const dim = related && !related.has(node.id);
        const offline = node.kind === 'agent' && !statusByAlias.get(node.label);
        let alpha = (1 - depthT * 0.55) * (dim ? 0.22 : 1) * (offline ? 0.5 : 1);
        if (node.kind === 'core') alpha = Math.min(1, alpha + 0.15);
        const color = nodeColor(node, tk, statusByAlias);
        // 核心轻微呼吸，整张图才有「活着」的感觉（幅度 6%，不抢注意力）。
        const pulse = node.kind === 'core' ? 1 + 0.06 * Math.sin(now / 620) : 1;
        const radiusPx = r * pulse;

        ctx.globalAlpha = alpha;
        if (dark) {
          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = Math.min(node.kind === 'core' ? 26 : 16, r * 2.4);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          // 浅底：辉光=脏灰。改成半透明实心 + 同色描边，靠轮廓读层级。
          ctx.fillStyle = hexToRgba(color, 0.28);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // 选中/高亮节点加一圈描边，别只靠亮度差（截图上容易看不出来）。
        if (selectedRef.current === node.id) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = tk.fg;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusPx + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        // 标签：Agent 太多，只有近处或高亮时才画，避免糊成一片。
        const showLabel =
          node.kind === 'core' ||
          node.kind === 'group' ||
          (node.kind === 'person' && (p.scale > cam.focal * 0.16 || related?.has(node.id))) ||
          (node.kind === 'agent' && (p.scale > cam.focal * 0.2 || selectedRef.current === node.id));
        if (showLabel) {
          ctx.globalAlpha = Math.min(1, alpha + 0.15);
          ctx.fillStyle = dim ? tk.dim : tk.fg;
          ctx.font = `${node.kind === 'core' ? 600 : 400} ${node.kind === 'core' ? 13 : 11}px system-ui, -apple-system, "Noto Sans SC", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const label = node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label;
          // 标签沿「圆心 → 节点」方向朝外放；统一放正下方会在密集区域糊成一团。
          const dx = p.x - size.width / 2;
          const dy = p.y - size.height / 2;
          const len = Math.hypot(dx, dy) || 1;
          const off = r + 12;
          ctx.fillText(label, p.x + (dx / len) * off, p.y + (dy / len) * off);
        }
        ctx.globalAlpha = 1;
      }

      // 环上彗星：头亮、尾巴 6 段渐隐，双向各一颗（神明参数：比虚线更有「通信」感）。
      for (const ring of ringRadii) {
        const y = RING_HEIGHT[ring.ring] ?? 0;
        for (let k = 0; k < 2; k++) {
          const dir = k === 0 ? 1 : -1;
          const head = (now / 1000) * 0.28 * dir + ring.ring * 1.7 + k * Math.PI;
          for (let seg = 6; seg >= 0; seg--) {
            const a = head - dir * seg * 0.05;
            const pt = projectPoint({ x: Math.sin(a) * ring.radius, y, z: Math.cos(a) * ring.radius }, cam, size);
            if (!pt) continue;
            const t = 1 - seg / 7;
            ctx.globalAlpha = 0.62 * t * t;
            ctx.fillStyle = seg === 0 ? tk.fg : tk.accent;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 2.1 * t + 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [layout, ringRadii, size, statusByAlias, related]);

  /* ── 交互 ───────────────────────────────────────────────────────── */

  const resetView = useCallback(() => {
    viewRef.current = { ...DEFAULT_VIEW };
    lastInteract.current = performance.now();
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteract.current = performance.now();
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { span: Math.hypot(a.x - b.x, a.y - b.y), dist: viewRef.current.zoom };
      dragRef.current = null;
      return;
    }
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      yaw: viewRef.current.yaw,
      pitch: viewRef.current.pitch,
      moved: 0,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteract.current = performance.now();

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const span = Math.hypot(a.x - b.x, a.y - b.y);
      if (span > 4 && pinchRef.current.span > 4) {
        const ratio = span / pinchRef.current.span;
        viewRef.current.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchRef.current.dist * ratio));
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    viewRef.current.yaw = drag.yaw + dx * 0.008;
    viewRef.current.pitch = Math.min(1.45, Math.max(0.12, drag.pitch + dy * 0.005));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    lastInteract.current = performance.now();
    if (!drag) return;
    dragRef.current = null;
    if (drag.moved > 6) return; // 拖动不是点击

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const hit = hitTest(screenRef.current, e.clientX - rect.left, e.clientY - rect.top, 16);
    setSelected(hit ? hit.item.id : null);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    lastInteract.current = performance.now();
    const next = viewRef.current.zoom * (e.deltaY > 0 ? 1 / 1.08 : 1.08);
    viewRef.current.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    lastInteract.current = performance.now();
    const v = viewRef.current;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); v.yaw -= 0.12; break;
      case 'ArrowRight': e.preventDefault(); v.yaw += 0.12; break;
      case 'ArrowUp': e.preventDefault(); v.pitch = Math.min(1.45, v.pitch + 0.08); break;
      case 'ArrowDown': e.preventDefault(); v.pitch = Math.max(0.12, v.pitch - 0.08); break;
      case '+': case '=': e.preventDefault(); v.zoom = Math.min(MAX_ZOOM, v.zoom * 1.1); break;
      case '-': e.preventDefault(); v.zoom = Math.max(MIN_ZOOM, v.zoom / 1.1); break;
      case 'r': case 'R': resetView(); break;
      case 'Escape': setSelected(null); break;
      default: break;
    }
  };

  /* ── 导出 ───────────────────────────────────────────────────────── */

  const exportPng = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setExporting(true);
    setExportError('');
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG 编码失败');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `legion-3d-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, []);

  /* ── 页面 ───────────────────────────────────────────────────────── */

  const loading = people.isLoading || status.isLoading;
  const peopleError = people.error as (Error & { status?: number }) | undefined;
  const fatal = needsLogin || peopleError?.status === 401 ? 'login' : peopleError ? 'error' : null;
  const isEmpty = !loading && !fatal && people.data != null && layout.nodes.length <= 1;

  const path = useMemo(() => {
    if (!selectedNode) return [] as string[];
    const byId = new Map(layout.nodes.map(n => [n.id, n]));
    const out: string[] = [];
    for (let cur: LegionNode | undefined = selectedNode; cur && cur.parentId; cur = byId.get(cur.parentId)) {
      const parent = byId.get(cur.parentId);
      if (!parent || parent.kind === 'core') break; // 圆心是网络本身，不写进部门路径
      out.unshift(parent.label);
    }
    return out;
  }, [layout.nodes, selectedNode]);

  const detailHref = selectedNode?.kind === 'agent' ? `/nodes/${encodeURIComponent(selectedNode.label)}` : '/org';

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ height: stageHeight ?? 'calc(100dvh - 7.5rem)' }}
      className="relative w-full overflow-hidden bg-[var(--bg)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      aria-label="军团 3D 网络拓扑"
      data-testid="legion-3d-stage"
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        role="img"
        aria-label="军团三维拓扑图，可拖动旋转、滚轮缩放，点击节点查看详情"
      />

      {/* 标题与计数 */}
      <div className="pointer-events-none absolute left-4 top-4 max-w-[52vw] sm:max-w-sm">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-[var(--fg)]">军团 · 3D</h1>
          <span className="hidden text-[11px] text-[var(--fg-dim)] sm:inline">Legion Topology</span>
        </div>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {loading ? '正在读取编制…' : `${layout.stats.groups} 个部门 · ${layout.stats.people} 名成员 · ${layout.stats.agents} 个 Agent`}
        </p>
        {hierarchy.data === null && (
          <p className="mt-1 text-[11px] text-[var(--fg-dim)]">
            当前 Hub 没有部门树接口，按部门名扁平分组（升级 Hub 后自动分层次）。
          </p>
        )}
      </div>

      {/* 右上操作区 */}
      <div className="absolute right-3 top-16 flex flex-wrap items-center justify-end gap-1.5 sm:top-3">
        <button
          type="button"
          onClick={() => setSpin(v => !v)}
          aria-pressed={spin}
          data-testid="legion-3d-spin"
          className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${spin ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]'}`}
        >
          {spin ? '自转中' : '已暂停'}
        </button>
        <button
          type="button"
          onClick={resetView}
          className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
        >
          重置视角
        </button>
        <button
          type="button"
          onClick={exportPng}
          disabled={exporting}
          data-testid="legion-3d-export"
          className="rounded-md bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)] disabled:opacity-50"
        >
          {exporting ? '导出中…' : '导出 PNG'}
        </button>
        <Link
          href="/legion"
          className="rounded-md px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
        >
          2D 视图
        </Link>
      </div>

      {exportError && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg bg-[var(--danger)]/12 px-3 py-1.5 text-xs text-[var(--danger)]">
          导出失败：{exportError}
        </div>
      )}

      {/* 底部左：图例与操作提示 */}
      <div className={`pointer-events-none absolute bottom-4 left-4 space-y-1 text-[11px] text-[var(--fg-dim)] ${selectedNode ? 'hidden sm:block' : ''}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {([
            ['运行中', 'var(--success)'],
            ['空闲', 'var(--fg-muted)'],
            ['阻塞', 'var(--warning)'],
            ['错误', 'var(--danger)'],
          ] as const).map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
        <p>拖动环绕 · 滚轮/双指缩放 · 点节点看详情 · R 重置</p>
      </div>

      {/* 选中节点详情 */}
      {selectedNode && (
        <div
          data-testid="legion-3d-detail"
          className="absolute inset-x-3 bottom-3 rounded-xl bg-[var(--bg-secondary)]/95 p-3 backdrop-blur sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-72"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] text-[var(--fg-dim)]">{KIND_LABEL[selectedNode.kind]}{path.length > 0 ? ` · ${path.join(' / ')}` : ''}</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-[var(--fg)]">{selectedNode.label}</p>
              {selectedNode.kind === 'group' && (
                <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
                  {selectedNode.leader ? `负责人 ${selectedNode.leader} · ` : '未设负责人 · '}
                  {selectedNode.memberCount} 人（含下级） · 第 {selectedNode.depth} 层
                </p>
              )}
              {selectedNode.kind === 'person' && (
                <p className="mt-1 text-[11px] text-[var(--fg-muted)]">名下 {selectedNode.agentCount} 个 Agent</p>
              )}
              {selectedNode.kind === 'agent' && (
                <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
                  {statusByAlias.get(selectedNode.label) ?? '未上报状态'}
                </p>
              )}
              {selectedNode.kind === 'core' && (
                <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
                  {layout.stats.people} 名成员 · {layout.stats.agents} 个 Agent
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="关闭详情"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-[var(--fg-dim)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
            >
              ✕
            </button>
          </div>
          {(selectedNode.kind === 'agent' || selectedNode.kind === 'person' || selectedNode.kind === 'group') && (
            <Link
              href={detailHref}
              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              {selectedNode.kind === 'agent' ? '打开节点详情' : '在部门列表里看'} →
            </Link>
          )}
        </div>
      )}

      {/* 三态：只在真·空/真·错时覆盖画布，不用空态掩盖故障 */}
      {fatal === 'login' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)]/92 px-6 text-center">
          <p className="text-sm text-[var(--warning)]">
            会话已过期，<Link href="/login" className="underline">重新登录</Link> 后再看军团。
          </p>
        </div>
      )}
      {fatal === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)]/92 px-6">
          <div className="max-w-sm text-center">
            <p className="text-sm text-[var(--danger)]">读取军团编制失败：{peopleError?.message ?? '未知错误'}</p>
            <button
              type="button"
              onClick={() => { void people.mutate(); void hierarchy.mutate(); void status.mutate(); }}
              className="mt-3 rounded-md bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg)] hover:bg-[var(--hover-tint)]"
            >
              重试
            </button>
          </div>
        </div>
      )}
      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)]/92 px-6">
          <EmptyState
            variant="nodes"
            title="军团还没有成员"
            sub="成员加入网络并绑定 Agent 后，这里会自动长出三维编制。"
            cta={{ label: '去部门列表', href: '/org' }}
          />
        </div>
      )}
    </div>
  );
}
