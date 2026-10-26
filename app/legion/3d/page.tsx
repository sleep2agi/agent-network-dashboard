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
import { useRouter } from 'next/navigation';
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
    surface: v('--bg-secondary', '#161618'),
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
  // 成员：有任意 Agent 在跑就跟着亮；否则用次级文字色。
  // 不能用 --fg —— 白芯 + 白描边等于没有描边。
  const working = node.agentCount > 0 && statusByAlias.get(node.label) === 'working';
  return working ? tk.success : tk.muted;
}

/** 光晕精灵缓存：一个颜色一张 128×128 的径向渐变贴图，按需缩放。
 *  逐帧 shadowBlur 在软件光栅下开销极大（headless 实测 30fps），
 *  预先画好再 drawImage 是同类效果里最便宜的做法。 */
const HALO_CACHE = new Map<string, HTMLCanvasElement>();
function haloFor(color: string): HTMLCanvasElement {
  const hit = HALO_CACHE.get(color);
  if (hit) return hit;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, hexToRgba(color, 0.55));
    grad.addColorStop(0.45, hexToRgba(color, 0.22));
    grad.addColorStop(1, hexToRgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  HALO_CACHE.set(color, cv);
  return cv;
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
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // 大网络提示条：一次会话里关掉就不再弹（sessionStorage）。
  const [hintDismissed, setHintDismissed] = useState(false);
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
  const hoverRef = useRef<string | null>(null);
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

  /** 部门聚焦：只保留该部门子树（含自身），其余淡出。2D 页同款语义。 */
  const focusSet = useMemo(() => {
    if (!focus) return null;
    const children = new Map<string, string[]>();
    for (const e of layout.edges) {
      const arr = children.get(e.from) ?? [];
      arr.push(e.to);
      children.set(e.from, arr);
    }
    const set = new Set<string>([focus]);
    const stack = [focus];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of children.get(cur) ?? []) {
        if (!set.has(child)) { set.add(child); stack.push(child); }
      }
    }
    return set;
  }, [focus, layout.edges]);

  /** 搜索命中：先按名字/子标题命中，再把命中节点的子孙一起点亮 ——
   *  搜「平台」只亮一个部门点没有意义，要看见这个部门的人和 Agent。 */
  const matchedSet = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set<string>();
    for (const node of layout.nodes) {
      if (`${node.label} ${node.sublabel ?? ''}`.toLowerCase().includes(q)) hit.add(node.id);
    }
    if (hit.size === 0) return hit;
    const children = new Map<string, string[]>();
    for (const e of layout.edges) {
      const arr = children.get(e.from) ?? [];
      arr.push(e.to);
      children.set(e.from, arr);
    }
    const stack = [...hit];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of children.get(cur) ?? []) {
        if (!hit.has(child)) { hit.add(child); stack.push(child); }
      }
    }
    return hit;
  }, [query, layout.edges, layout.nodes]);

  // 搜索优先于聚焦/选中：正在找东西时，别让其它高亮盖掉命中结果。
  const activeSet = matchedSet ?? related ?? focusSet;
  const noMatch = matchedSet !== null && matchedSet.size === 0;

  const ringRadii = useMemo(() => layout.rings.map(r => ({ ring: r.ring, radius: r.radius })), [layout.rings]);

  useEffect(() => {
    try {
      if (sessionStorage.getItem('legion3d-hint-dismissed') === '1') setHintDismissed(true);
    } catch { /* 隐私模式下读不到就每次都提示，无害 */ }
  }, []);

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
    let bgLayer: HTMLCanvasElement | null = null;
    let bgKey = '';
    const buildBackdrop = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(size.width * dpr);
      cv.height = Math.round(size.height * dpr);
      const g2 = cv.getContext('2d');
      if (!g2) return null;
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.fillStyle = tk.bg;
      g2.fillRect(0, 0, size.width, size.height);
      const grad = g2.createRadialGradient(
        size.width / 2, size.height * 0.5, 0,
        size.width / 2, size.height * 0.5, Math.max(size.width, size.height) * 0.7,
      );
      grad.addColorStop(0, hexToRgba(tk.accent, dark ? 0.11 : 0.06));
      grad.addColorStop(0.55, hexToRgba(tk.accent, dark ? 0.035 : 0.02));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = grad;
      g2.fillRect(0, 0, size.width, size.height);
      g2.fillStyle = tk.fg;
      for (const st of starsRef.current) {
        g2.globalAlpha = st.a;
        g2.beginPath();
        g2.arc(st.x * size.width, st.y * size.height, st.r, 0, Math.PI * 2);
        g2.fill();
      }
      g2.globalAlpha = 1;
      return cv;
    };
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

      // 大网络降级：200 个节点的网络里，逐节点 shadowBlur + 逐边光晕会把
      // 帧率打到个位数。装饰性开销按规模递减，结构和信息一律不减。
      const heavy = layout.nodes.length > 80;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const key = `${Math.round(size.width)}x${Math.round(size.height)}:${tk.bg}:${tk.accent}:${dark}`;
      if (!bgLayer || key !== bgKey) {
        bgLayer = buildBackdrop();
        bgKey = key;
      }
      if (bgLayer) ctx.drawImage(bgLayer, 0, 0);
      else {
        ctx.fillStyle = tk.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
        const lit = activeSet?.has(node.id) ?? false;
        ctx.beginPath();
        outer.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i].x, inner[i].y);
        ctx.closePath();
        ctx.fillStyle = lit ? tk.accent : tk.info;
        ctx.globalAlpha = activeSet ? (lit ? 0.22 : 0.04) : 0.085;
        ctx.fill();
        ctx.globalAlpha = activeSet ? (lit ? 0.5 : 0.08) : 0.22;
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

      // 连线（神明 cover14.mjs 的三层画法，改成 3D 屏幕空间里的二次曲线）：
      //   宽光晕 18px@.7 blur7 → 实线 5px@.95 → 白色 dash 2/22 流光。
      //   曲线控制点取法向偏移，双向交替，避免所有线朝同一边鼓成一把弓。
      const curveOf = (ax: number, ay: number, bx: number, by: number, i: number) => {
        const dx = bx - ax;
        const dy = by - ay;
        const d = Math.hypot(dx, dy) || 1;
        const off = Math.min(56, d * 0.16) * (i % 2 ? -1 : 1);
        return { cx: (ax + bx) / 2 - (dy / d) * off, cy: (ay + by) / 2 + (dx / d) * off };
      };
      const quadAt = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number, t: number) => {
        const u = 1 - t;
        return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by];
      };
      type EdgeDraw = { a: SceneNode<LegionNode>; b: SceneNode<LegionNode>; cx: number; cy: number; lit: boolean };
      const edgeDraws: EdgeDraw[] = [];
      layout.edges.forEach((edge, i) => {
        const a = byId.get(edge.from);
        const b = byId.get(edge.to);
        if (!a || !b) return;
        const lit = !activeSet || (activeSet.has(edge.from) && activeSet.has(edge.to));
        const { cx, cy } = curveOf(a.projected.x, a.projected.y, b.projected.x, b.projected.y, i);
        edgeDraws.push({ a, b, cx, cy, lit });
      });

      if (dark && (!heavy || activeSet)) {
        ctx.save();
        ctx.strokeStyle = tk.accent;
        ctx.lineWidth = 6;
        ctx.globalAlpha = activeSet ? 0.1 : 0.04;
        for (const e of edgeDraws) {
          if (!e.lit) continue;
          ctx.beginPath();
          ctx.moveTo(e.a.projected.x, e.a.projected.y);
          ctx.quadraticCurveTo(e.cx, e.cy, e.b.projected.x, e.b.projected.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const e of edgeDraws) {
        ctx.beginPath();
        ctx.moveTo(e.a.projected.x, e.a.projected.y);
        ctx.quadraticCurveTo(e.cx, e.cy, e.b.projected.x, e.b.projected.y);
        ctx.strokeStyle = e.lit && activeSet ? tk.accent : tk.border;
        ctx.globalAlpha = e.lit ? (activeSet ? 0.62 : (dark ? 0.34 : 0.45)) : 0.08;
        ctx.lineWidth = e.lit && activeSet ? 1.6 : 1;
        ctx.stroke();
      }
      // 白色短划流光（dasharray 2 22），沿线跑。
      ctx.save();
      ctx.setLineDash([2, 22]);
      ctx.strokeStyle = tk.fg;
      ctx.lineWidth = 1.1;
      ctx.globalAlpha = dark ? 0.48 : 0.4;
      const dashStride = heavy ? 3 : 1;
      edgeDraws.forEach((e, i) => {
        if (!e.lit || i % dashStride !== 0) return;
        ctx.lineDashOffset = -((now / 55) % 24) - i * 6;
        ctx.beginPath();
        ctx.moveTo(e.a.projected.x, e.a.projected.y);
        ctx.quadraticCurveTo(e.cx, e.cy, e.b.projected.x, e.b.projected.y);
        ctx.stroke();
      });
      ctx.restore();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // 双向数据包：亮头（白芯 + 彩色描边）+ 6 段渐隐尾巴，两个方向各一个。
      const cometStride = heavy ? 6 : 1;
      edgeDraws.forEach((e, i) => {
        if (!e.lit || i % cometStride !== 0) return;
        const speed = 5200;
        const base = ((now / speed) + i * 0.11) % 1;
        for (const dir of [1, -1]) {
          const t = dir === 1 ? 0.12 + base * 0.76 : 0.88 - base * 0.76;
          for (let k = 6; k >= 1; k--) {
            const tt = Math.min(1, Math.max(0, t - dir * 0.022 * k));
            const [tx, ty] = quadAt(e.a.projected.x, e.a.projected.y, e.cx, e.cy, e.b.projected.x, e.b.projected.y, tt);
            ctx.globalAlpha = Math.max(0, 0.3 - k * 0.045);
            ctx.fillStyle = tk.accent;
            ctx.beginPath();
            ctx.arc(tx, ty, Math.max(0.8, 3.2 - k * 0.35), 0, Math.PI * 2);
            ctx.fill();
          }
          const [hx, hy] = quadAt(e.a.projected.x, e.a.projected.y, e.cx, e.cy, e.b.projected.x, e.b.projected.y, t);
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = tk.fg;
          ctx.beginPath();
          ctx.arc(hx, hy, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = tk.accent;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;

      // 部门内部短弧线（神明 phalanx18 的 pr 弧）：同部门相邻成员之间一条
      // 朝圆心收的二次曲线 —— 细彩线打底 + 白色短划，比部门间连线细一档。
      {
        const kids = new Map<string, LegionNode[]>();
        for (const edge of layout.edges) {
          const to = byId.get(edge.to);
          if (!to || to.item.kind !== 'person') continue;
          const arr = kids.get(edge.from) ?? [];
          arr.push(to.item);
          kids.set(edge.from, arr);
        }
        for (const [groupId, members] of kids) {
          if (members.length < 2) continue;
          for (let i = 0; i < members.length - 1; i++) {
            const a = byId.get(members[i].id);
            const b = byId.get(members[i + 1].id);
            if (!a || !b) continue;
            const lit = !activeSet || (activeSet.has(groupId) && activeSet.has(a.item.id) && activeSet.has(b.item.id));
            if (!lit) continue;
            const mx = (a.projected.x + b.projected.x) / 2;
            const my = (a.projected.y + b.projected.y) / 2;
            const cx = mx + (size.width / 2 - mx) * 0.12;
            const cy = my + (size.height / 2 - my) * 0.12;
            ctx.globalAlpha = activeSet ? 0.34 : 0.18;
            ctx.strokeStyle = tk.accent;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(a.projected.x, a.projected.y);
            ctx.quadraticCurveTo(cx, cy, b.projected.x, b.projected.y);
            ctx.stroke();
            ctx.globalAlpha = activeSet ? 0.45 : 0.22;
            ctx.strokeStyle = tk.fg;
            ctx.lineWidth = 1.1;
            ctx.setLineDash([1.5, 11]);
            ctx.beginPath();
            ctx.moveTo(a.projected.x, a.projected.y);
            ctx.quadraticCurveTo(cx, cy, b.projected.x, b.projected.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.globalAlpha = 1;
      }

      // 节点：远→近（projectScene 已排序），近的盖住远的。
      const labelQueue: Array<{ node: LegionNode; text: string; px: number; py: number; r: number; alpha: number; dim: boolean; priority: number }> = [];
      for (const sn of nodes) {
        const node = sn.item;
        const p = sn.projected;
        const r = Math.max(1.4, WORLD_R[node.kind] * p.scale);
        const depthT = Math.min(1, Math.max(0, (p.depth - near) / (far - near)));
        const dim = activeSet && !activeSet.has(node.id);
        const offline = node.kind === 'agent' && !statusByAlias.get(node.label);
        let alpha = (1 - depthT * 0.55) * (dim ? 0.22 : 1) * (offline ? 0.5 : 1);
        if (node.kind === 'core') alpha = Math.min(1, alpha + 0.15);
        const color = nodeColor(node, tk, statusByAlias);
        // 核心轻微呼吸，整张图才有「活着」的感觉（幅度 6%，不抢注意力）。
        const pulse = node.kind === 'core' ? 1 + 0.06 * Math.sin(now / 620) : 1;
        const radiusPx = r * pulse;

        ctx.globalAlpha = alpha;
        const ring = Math.max(1.4, Math.min(3.5, radiusPx * 0.34));
        if (dark) {
          // 深底（神明 cover14 的节点画法）：彩色外晕 → 白芯 → 彩色描边。
          // 只画实心色块时深底上是一团糊光；白芯给每个节点一个硬边。
          const wantHalo = !heavy || node.kind === 'core' || node.kind === 'group' || activeSet?.has(node.id);
          if (wantHalo) {
            const halo = haloFor(color);
            const hr = radiusPx * 3.4;
            ctx.drawImage(halo, p.x - hr / 2, p.y - hr / 2, hr, hr);
          }
          ctx.fillStyle = tk.fg;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = ring;
          ctx.stroke();
        } else {
          // 浅底（神明 phalanx18 的参数）：7px 彩色 .18 外圈 + 白芯 + 3.5px 描边。
          // 浅底不要辉光，靠描边定轮廓。
          ctx.fillStyle = hexToRgba(color, 0.18);
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusPx + 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = tk.surface;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1.6, Math.min(3.5, radiusPx * 0.5));
          ctx.stroke();
        }

        // 悬停：鼠标下的节点描一圈细线，来得及看清「我点的是哪一个」。
        if (hoverRef.current === node.id && selectedRef.current !== node.id) {
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = tk.accent;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusPx + 5, 0, Math.PI * 2);
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
          (!heavy && node.kind === 'person' && (p.scale > cam.focal * 0.16 || activeSet?.has(node.id))) ||
          (heavy && activeSet?.has(node.id)) ||
          (node.kind === 'agent' && (p.scale > cam.focal * 0.2 || selectedRef.current === node.id || hoverRef.current === node.id)) ||
          hoverRef.current === node.id;
        if (showLabel) {
          labelQueue.push({
            node,
            text: node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label,
            px: p.x,
            py: p.y,
            r: radiusPx,
            alpha: Math.min(1, alpha + 0.15),
            dim: !!dim,
            priority: node.kind === 'core' ? 0 : (hoverRef.current === node.id || selectedRef.current === node.id) ? 1 : node.kind === 'group' ? 2 : 3,
          });
        }
        ctx.globalAlpha = 1;
      }

      // 标签统一绘制 + 简单避让：核心/部门/悬停优先占位，其余沿径向往外
      // 试两档，仍冲突就跳过 —— 宁可少一个名字，也不要两行字叠成一团。
      {
        labelQueue.sort((a, b) => a.priority - b.priority);
        const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const item of labelQueue) {
          const big = item.node.kind === 'core';
          ctx.font = `${big ? 600 : 400} ${big ? 13 : 11}px system-ui, -apple-system, "Noto Sans SC", sans-serif`;
          const w = ctx.measureText(item.text).width;
          const h = big ? 16 : 13;
          const dx = item.px - size.width / 2;
          const dy = item.py - size.height / 2;
          const len = Math.hypot(dx, dy) || 1;
          const ux = len > 4 ? dx / len : 0;
          const uy = len > 4 ? dy / len : 1;
          let spot: { x: number; y: number } | null = null;
          for (const extra of [12, 24, 38]) {
            const off = item.r + extra;
            const cx = item.px + ux * off;
            const cy = item.py + uy * off;
            const rect = { x1: cx - w / 2 - 4, y1: cy - h / 2 - 2, x2: cx + w / 2 + 4, y2: cy + h / 2 + 2 };
            const hit = placed.some(p => !(rect.x2 < p.x1 || rect.x1 > p.x2 || rect.y2 < p.y1 || rect.y1 > p.y2));
            if (!hit) { placed.push(rect); spot = { x: cx, y: cy }; break; }
          }
          if (!spot) continue;
          // 底衬：只有大网络（标签挤在连线里）才垫，小网络保持纯文字。
          if (heavy) {
            ctx.globalAlpha = 0.42 * item.alpha;
            ctx.fillStyle = tk.bg;
            const pad = 3;
            ctx.beginPath();
            ctx.roundRect(spot.x - w / 2 - pad, spot.y - h / 2, w + pad * 2, h, 4);
            ctx.fill();
          }
          ctx.globalAlpha = item.alpha;
          ctx.fillStyle = item.dim ? tk.dim : tk.fg;
          ctx.fillText(item.text, spot.x, spot.y);
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
            ctx.globalAlpha = 0.45 * t * t;
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
  }, [layout, ringRadii, size, statusByAlias, activeSet]);

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

    if (!dragRef.current) {
      // 没按下的移动 = 悬停：只更新 ref，不触发 React 重渲染。
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const hit = hitTest(screenRef.current, e.clientX - rect.left, e.clientY - rect.top, 18);
      const next = hit ? hit.item.id : null;
      if (next !== hoverRef.current) {
        hoverRef.current = next;
        (e.currentTarget as HTMLElement).style.cursor = next ? 'pointer' : 'grab';
      }
      return;
    }

    const drag = dragRef.current;
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

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const hit = hitTest(screenRef.current, e.clientX - rect.left, e.clientY - rect.top, 18);
    if (!hit) return;
    const n = hit.item;
    if (n.kind === 'agent') router.push(`/nodes/${encodeURIComponent(n.label)}`);
    else if (n.kind === 'person' || n.kind === 'group') router.push('/org');
  };

  const onPointerLeave = () => {
    hoverRef.current = null;
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
      // 和 2D 页一样，导出图自带标题栏、计数、图例与导出时间 ——
      // 一张裸图存到相册里过几天就说不清是谁的编制。
      const tk2 = readTokens();
      const scale = canvas.width / Math.max(1, canvas.clientWidth);
      const head = Math.round(58 * scale);
      const foot = Math.round(32 * scale);
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height + head + foot;
      const g = out.getContext('2d');
      if (!g) throw new Error('浏览器不支持 canvas');
      g.fillStyle = tk2.bg;
      g.fillRect(0, 0, out.width, out.height);
      g.drawImage(canvas, 0, head);
      const font = 'system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif';
      const px = (n: number) => Math.round(n * scale);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = tk2.fg;
      g.font = `600 ${px(18)}px ${font}`;
      g.fillText('军团 · 3D 网络拓扑', px(16), px(24));
      g.fillStyle = tk2.muted;
      g.font = `${px(12)}px ${font}`;
      g.fillText(
        `${layout.stats.groups} 个部门 · ${layout.stats.people} 名成员 · ${layout.stats.agents} 个 Agent`,
        px(16), px(44),
      );
      g.textAlign = 'right';
      g.font = `${px(11)}px ${font}`;
      g.fillText(`导出 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, out.width - px(16), px(24));

      // 底部图例：颜色语义与页面一致（深底是发光圆点，浅底是描边圆）。
      const legend: Array<[string, string]> = [
        [tk2.success, '运行中'],
        [tk2.muted, '空闲'],
        [tk2.warning, '阻塞'],
        [tk2.danger, '错误'],
      ];
      let lx = px(20);
      const ly = out.height - foot / 2;
      g.textAlign = 'left';
      for (const [color, label] of legend) {
        g.beginPath();
        g.arc(lx, ly, px(4), 0, Math.PI * 2);
        g.fillStyle = color;
        g.fill();
        g.fillStyle = tk2.muted;
        g.font = `${px(11)}px ${font}`;
        g.fillText(label, lx + px(10), ly);
        lx += px(10 + 11 * label.length + 22);
      }
      g.textAlign = 'right';
      g.fillText('ANet · Legion 3D', out.width - px(16), ly);

      const blob = await new Promise<Blob | null>(resolve => out.toBlob(resolve, 'image/png'));
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
  }, [layout.stats]);

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
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        role="img"
        aria-label="军团三维拓扑图，可拖动旋转、滚轮缩放，点击节点查看详情"
      />

      {/* 顶部信息区：手机上「标题 → 搜索 → 按钮」竖排，桌面上标题在左、按钮在右。
          之前按钮绝对定位在 top-16，加了搜索框后正好压住输入框。 */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-2 sm:inset-x-4 sm:top-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="pointer-events-none min-w-0 max-w-[62vw] sm:max-w-sm">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-[var(--fg)]">军团 · 3D</h1>
          <span className="hidden text-[11px] text-[var(--fg-dim)] sm:inline">Legion Topology</span>
        </div>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {loading ? '正在读取编制…' : `${layout.stats.groups} 个部门 · ${layout.stats.people} 名成员 · ${layout.stats.agents} 个 Agent`}
        </p>
        <div className="pointer-events-auto mt-2 flex items-center gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索成员 / 部门 / Agent"
            aria-label="搜索军团成员"
            data-testid="legion-3d-search"
            className="w-44 rounded-md bg-[var(--bg-secondary)]/85 px-2.5 py-1 text-xs text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] sm:w-56"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="清空搜索"
              className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--fg-dim)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
            >
              ✕
            </button>
          )}
        </div>
        {noMatch && (
          <p className="mt-1 text-[11px] text-[var(--fg-dim)]">没有匹配的成员或部门</p>
        )}
        {focus && (
          <button
            type="button"
            onClick={() => setFocus(null)}
            className="pointer-events-auto mt-2 inline-flex items-center gap-2 rounded-full bg-[var(--accent)]/12 px-3 py-1 text-[11px] text-[var(--accent)]"
          >
            聚焦：{layout.nodes.find(n => n.id === focus)?.label ?? '部门'}
            <span aria-hidden>✕</span>
          </button>
        )}
        {hierarchy.data === null && (
          <p className="mt-1 text-[11px] text-[var(--fg-dim)]">
            当前 Hub 没有部门树接口，按部门名扁平分组（升级 Hub 后自动分层次）。
          </p>
        )}
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
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
      </div>

      {exportError && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-lg bg-[var(--danger)]/12 px-3 py-1.5 text-xs text-[var(--danger)]">
          导出失败：{exportError}
        </div>
      )}

      {/* 大网络提示：节点多时给一条可关掉的建议，不挡图 */}
      {!hintDismissed && layout.nodes.length > 120 && (
        <div className="pointer-events-auto absolute bottom-16 left-1/2 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-lg bg-[var(--bg-secondary)]/92 px-3 py-1.5 text-[11px] text-[var(--fg-muted)] backdrop-blur sm:bottom-6" data-testid="legion-3d-scale-hint">
          <span>军团规模较大（{layout.nodes.length} 个节点）· 用搜索或点部门聚焦可缩小范围</span>
          <button
            type="button"
            onClick={() => {
              setHintDismissed(true);
              try { sessionStorage.setItem('legion3d-hint-dismissed', '1'); } catch {}
            }}
            aria-label="关闭提示"
            className="shrink-0 rounded px-1 text-[var(--fg-dim)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
          >
            ✕
          </button>
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
          {selectedNode.kind === 'group' && (
            <button
              type="button"
              onClick={() => setFocus(f => (f === selectedNode.id ? null : selectedNode.id))}
              className="mt-2 mr-3 rounded-md px-2 py-1 text-xs text-[var(--fg-muted)] hover:bg-[var(--hover-tint)] hover:text-[var(--fg)]"
            >
              {focus === selectedNode.id ? '取消聚焦' : '聚焦此部门'}
            </button>
          )}
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
