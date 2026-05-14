'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Session } from './types';
import { aliasAvatarColors, aliasInitial } from './AliasAvatar';

interface MessageFlow {
  from_alias: string;
  to_alias: string;
  content: string;
  created_at: string;
}

interface TopoGraphProps {
  sessions: Session[];
  sseSessions: Record<string, number>;
}

interface Point {
  x: number;
  y: number;
}

interface FlowLink {
  key: string;
  from: string;
  to: string;
  count: number;
  content: string;
}

const cx = 500;
const cy = 330;
const onlineRadius = 220;
// Round 97 (issue #50): tier into two rings when N > 8; round 98
// (issue #61): tier into three rings when N > 14. At N=22 (Vincent's
// network) two rings still leave 11 nodes per ring → inner chord of
// 88px can't fit a 100px label; three rings give ~⌈N/3⌉ per ring so
// every tier has enough arc room.
const onlineTierThreshold = 8;
const onlineTripleThreshold = 14;
const onlineInnerRadius = 175;
const onlineOuterRadius = 260;
const onlineTripleInnerR = 145;
const onlineTripleMidR = 215;
const onlineTripleOuterR = 285;
const offlineRadius = 325;

/** Polar coordinate for a node on a ring. `rotateBy` lets the caller offset
 *  the whole ring so two stacked rings don't align radially (round 25: the
 *  offline ring gets a half-step rotation so its nodes sit in the gaps
 *  between online ones). */
function polarPoint(index: number, total: number, radius: number, rotateBy = 0) {
  const spread = total <= 2 ? Math.PI : Math.PI * 1.78;
  const start = -Math.PI / 2 - spread / 2;
  const angle = total <= 1 ? -Math.PI / 2 : start + (spread * index) / (total - 1) + rotateBy;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function curvePath(from: Point, to: Point, lift = 0) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const control = {
    x: mx + normalX * lift,
    y: my + normalY * lift,
  };

  return `M${from.x},${from.y} Q${control.x},${control.y} ${to.x},${to.y}`;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function nodeStatus(session: Session, isOnline: boolean, isLight: boolean) {
  if (!isOnline) {
    return {
      label: 'offline',
      primary: isLight ? '#94a3b8' : '#6b7280',
      halo:    isLight ? '#e2e8f0' : '#111827',
      text:    isLight ? '#475569' : '#9ca3af',
    };
  }
  if (session.status === 'working') {
    return {
      label: 'working',
      primary: isLight ? '#059669' : '#22c55e',
      halo:    isLight ? '#d1fae5' : '#14532d',
      text:    isLight ? '#065f46' : '#dcfce7',
    };
  }
  if (session.status === 'idle') {
    return {
      label: 'idle',
      primary: isLight ? '#0d9488' : '#2dd4bf',
      halo:    isLight ? '#ccfbf1' : '#134e4a',
      text:    isLight ? '#115e59' : '#ccfbf1',
    };
  }
  return {
    label: session.status || 'online',
    primary: isLight ? '#0284c7' : '#38bdf8',
    halo:    isLight ? '#dbeafe' : '#0c4a6e',
    text:    isLight ? '#0c4a6e' : '#e0f2fe',
  };
}

/** Theme-aware color palette for the topology SVG. */
interface Palette {
  panelStops: [string, string, string];
  radarStops: { color: string; opacity: number }[];
  arrowFill: string;
  ringStroke: string;
  spokeStroke: { active: string; idle: string };
  flowEdge: string;
  flowPath: string;
  flowParticle: string;
  nodeFill: { online: string; offline: string };
  labelBox: { fill: string; stroke: string };
  legendBox: { fill: string; stroke: string };
  legendText: string;
  legendHeadline: string;
  legendAccent: string;
  containerBg: string;
  containerBorder: string;
  topRailGradient: string;
}

const DARK_PALETTE: Palette = {
  panelStops: ['#0b1220', '#080814', '#101018'],
  radarStops: [
    { color: '#22d3ee', opacity: 0.18 },
    { color: '#22c55e', opacity: 0.045 },
    { color: '#020617', opacity: 0 },
  ],
  arrowFill: '#67e8f9',
  ringStroke: '#164e63',
  spokeStroke: { active: '#22d3ee', idle: '#155e75' },
  flowEdge: '#67e8f9',
  flowPath: '#e0f2fe',
  flowParticle: '#fef08a',
  nodeFill: { online: '#020617', offline: '#080814' },
  labelBox: { fill: '#020617', stroke: '#1f2937' },
  legendBox: { fill: '#020617', stroke: '#1f2937' },
  legendText: '#94a3b8',
  legendHeadline: '#e5e7eb',
  legendAccent: '#67e8f9',
  containerBg: '#080814',
  containerBorder: '#2a2a4a',
  topRailGradient: 'from-transparent via-cyan-400/70 to-transparent',
};

const LIGHT_PALETTE: Palette = {
  panelStops: ['#f8fafc', '#ffffff', '#f1f5f9'],
  radarStops: [
    { color: '#10b981', opacity: 0.06 },
    { color: '#3b82f6', opacity: 0.03 },
    { color: '#ffffff', opacity: 0 },
  ],
  arrowFill: '#10b981',
  ringStroke: '#cbd5e1',
  spokeStroke: { active: '#10b981', idle: '#cbd5e1' },
  flowEdge: '#10b981',
  flowPath: '#475569',
  flowParticle: '#f59e0b',
  nodeFill: { online: '#ffffff', offline: '#f8fafc' },
  labelBox: { fill: '#ffffff', stroke: '#e2e8f0' },
  legendBox: { fill: '#ffffff', stroke: '#e2e8f0' },
  legendText: '#475569',
  legendHeadline: '#0f172a',
  legendAccent: '#0d9488',
  containerBg: '#ffffff',
  containerBorder: '#e3e6eb',
  topRailGradient: 'from-transparent via-emerald-500/40 to-transparent',
};

function useTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const read = () => {
      const t = document.documentElement.getAttribute('data-theme') || 'cyber';
      setTheme(t === 'light' || t === 'mint' ? 'light' : 'dark');
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/** Round 100 (issue #79): brand showcase mode. Activate via `?brand=intern`
 *  on any dashboard page — TopoGraph nodes show the 书小生 mascot instead
 *  of alias initials. Stored in localStorage so the flag persists across
 *  navigation. Clears with `?brand=none` or `?brand=` (empty). */
function useBrand(): string | null {
  const [brand, setBrand] = useState<string | null>(null);
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const param = url.searchParams.get('brand');
      if (param !== null) {
        if (param === '' || param === 'none') {
          localStorage.removeItem('anet-brand');
          setBrand(null);
        } else {
          localStorage.setItem('anet-brand', param);
          setBrand(param);
        }
      } else {
        setBrand(localStorage.getItem('anet-brand'));
      }
    } catch {}
  }, []);
  return brand;
}

/** Round 106 (issue #83): cluster agents by shared alias prefix so a team
 *  reads as one unit in the topology. Adjacent (sorted) aliases that share
 *  a ≥2-char prefix join the same group; the group key is the prefix common
 *  to every member. Singletons map to their own alias (no hue shift). The
 *  group key feeds aliasAvatarColors() so e.g. all 通信* nodes get one hue,
 *  all 研究员* another — the "同色相 tint" clustering option from #83. */
function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

function computeGroupKeys(aliases: string[]): Record<string, string> {
  const sorted = [...aliases].sort((a, b) => a.localeCompare(b));
  const keys: Record<string, string> = {};
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    let prefix = sorted[i];
    while (j + 1 < sorted.length) {
      const lcp = commonPrefix(prefix, sorted[j + 1]);
      if (lcp.length < 2) break;
      prefix = lcp;
      j++;
    }
    const key = j > i ? prefix : sorted[i];
    for (let k = i; k <= j; k++) keys[sorted[k]] = key;
    i = j + 1;
  }
  return keys;
}

function buildFlowLinks(messages: MessageFlow[], positions: Record<string, Point>) {
  const links = new Map<string, FlowLink>();

  messages.forEach(message => {
    if (
      !positions[message.from_alias] ||
      !positions[message.to_alias] ||
      message.from_alias === message.to_alias
    ) {
      return;
    }

    const key = `${message.from_alias}->${message.to_alias}`;
    const current = links.get(key);

    links.set(key, {
      key,
      from: message.from_alias,
      to: message.to_alias,
      count: (current?.count || 0) + 1,
      content: current?.content || message.content,
    });
  });

  return [...links.values()].slice(0, 18);
}

export function TopoGraph({ sessions, sseSessions }: TopoGraphProps) {
  const theme = useTheme();
  const isLight = theme === 'light';
  const pal = isLight ? LIGHT_PALETTE : DARK_PALETTE;
  const brand = useBrand();
  const isIntern = brand === 'intern';
  const [messages, setMessages] = useState<MessageFlow[]>([]);

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await fetch('/api/hub/messages?limit=50');
        if (res.status === 401) {
          window.location.assign('/login');
          return;
        }

        const data = await res.json();
        setMessages(data.messages || []);
      } catch {}
    };
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, []);

  const {
    onlineNodes,
    offlineNodes,
    nodePositions,
    flowLinks,
    activeAliases,
    groupKeys,
  } = useMemo(() => {
    const sseCount = (s: { alias: string; network_id?: string }) =>
      (s.network_id ? sseSessions[`${s.network_id}:${s.alias}`] : undefined) ?? sseSessions[s.alias];
    // Round 106 (issue #83): sort by alias so same-prefix agents
    // (通信龙 / 通信牛 / 通信工程马 …, or 研究员1号 / 研究员2号 …) end up
    // adjacent in the array — the tier layout below assigns angles by
    // index, so contiguous-in-array becomes contiguous-in-ring, i.e.
    // each team visually clusters. localeCompare keeps CJK ordering sane.
    const byAlias = (a: Session, b: Session) => a.alias.localeCompare(b.alias);
    const online = sessions.filter(s => s.status !== 'offline' || sseCount(s)).sort(byAlias);
    const offline = sessions.filter(s => s.status === 'offline' && !sseCount(s)).sort(byAlias);
    const positions: Record<string, Point> = {};

    // Round 97 (issue #50) + 98 (issue #61): three layout modes by N.
    //   N ≤ 8         → single ring (r=220)
    //   8 < N ≤ 14    → two rings (inner r=175, outer r=260, half-step rot)
    //   N > 14        → three rings (r=145/215/285, ⌈N/3⌉ per ring)
    // Each ring's spread is 1.78π so its node count drives chord length:
    // labels are 100px wide so each ring needs ≥110px chord per node.
    const tripleTier = online.length > onlineTripleThreshold;
    const dualTier = !tripleTier && online.length > onlineTierThreshold;
    let outerOnlineCount = online.length;
    if (tripleTier) {
      const per = Math.ceil(online.length / 3);
      const r1 = online.slice(0, per);
      const r2 = online.slice(per, 2 * per);
      const r3 = online.slice(2 * per);
      r1.forEach((s, index) => {
        positions[s.alias] = polarPoint(index, Math.max(r1.length, 1), onlineTripleInnerR);
      });
      const r1Spread = r1.length <= 2 ? Math.PI : Math.PI * 1.78;
      const r1Step = r1.length > 1 ? r1Spread / (r1.length - 1) : 0;
      r2.forEach((s, index) => {
        positions[s.alias] = polarPoint(index, Math.max(r2.length, 1), onlineTripleMidR, r1Step / 2);
      });
      r3.forEach((s, index) => {
        positions[s.alias] = polarPoint(index, Math.max(r3.length, 1), onlineTripleOuterR);
      });
      outerOnlineCount = r3.length;
    } else if (dualTier) {
      const innerCount = Math.ceil(online.length / 2);
      const outerCount = online.length - innerCount;
      const innerNodes = online.slice(0, innerCount);
      const outerNodes = online.slice(innerCount);
      innerNodes.forEach((s, index) => {
        positions[s.alias] = polarPoint(index, Math.max(innerCount, 1), onlineInnerRadius);
      });
      const innerSpread = innerCount <= 2 ? Math.PI : Math.PI * 1.78;
      const innerStep = innerCount > 1 ? innerSpread / (innerCount - 1) : 0;
      outerNodes.forEach((s, index) => {
        positions[s.alias] = polarPoint(index, Math.max(outerCount, 1), onlineOuterRadius, innerStep / 2);
      });
      outerOnlineCount = outerCount;
    } else {
      online.forEach((s, index) => {
        positions[s.alias] = polarPoint(index, Math.max(online.length, 1), onlineRadius);
      });
    }

    // Offset the offline ring radially by half the outermost online step so
    // offline bubbles sit in the angular gaps between online bubbles instead
    // of stacking directly behind them. Also push the outer ring further when
    // there are many offline nodes so labels don't crowd the legend.
    const outerSpreadBase = outerOnlineCount <= 2 ? Math.PI : Math.PI * 1.78;
    const outerStep = outerOnlineCount > 1 ? outerSpreadBase / (outerOnlineCount - 1) : 0;
    const offlineRotation = outerOnlineCount > 0 ? outerStep / 2 : 0;
    const offlineR = offlineRadius + Math.max(0, offline.length - 4) * 6;

    offline.forEach((s, index) => {
      positions[s.alias] = polarPoint(index, Math.max(offline.length, 1), offlineR, offlineRotation);
    });

    const links = buildFlowLinks(messages, positions);
    const active = new Set<string>();
    links.forEach(link => {
      active.add(link.from);
      active.add(link.to);
    });

    // Round 106 (issue #83): group key per alias → shared hue per team.
    const groupKeys = computeGroupKeys([...online, ...offline].map(s => s.alias));

    return {
      onlineNodes: online,
      offlineNodes: offline,
      nodePositions: positions,
      flowLinks: links,
      activeAliases: active,
      groupKeys,
    };
  }, [messages, sessions, sseSessions]);

  const workingCount = onlineNodes.filter(s => s.status === 'working').length;
  // Round 109 (Vincent 4582 P0): hover-gated labels above this node count
  // so dense fleets show clean avatars instead of a wall of overlapping
  // label cards. 16 ≈ where the triple-tier rings start to crowd.
  const denseLayout = onlineNodes.length + offlineNodes.length > 16;
  const [hoveredAlias, setHoveredAlias] = useState<string | null>(null);

  // --- Round 103 (issue #81): fullscreen + zoom + pan interaction layer ---
  // DIY native (no d3 / svg-pan-zoom): wrap the topology content in a single
  // <g transform> and drive it with wheel + pointer-drag. The panel <rect>
  // backdrop stays fixed so panning never reveals empty canvas. View state
  // {zoom,x,y} persists to localStorage (same sticky pattern as brand flag).
  const VIEWBOX_W = 1000;
  const VIEWBOX_H = 680;
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 4;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => { viewRef.current = view; }, [view]);

  // restore persisted view once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('anet-topo-view');
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v?.zoom === 'number') {
          setView({
            zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom)),
            x: typeof v.x === 'number' ? v.x : 0,
            y: typeof v.y === 'number' ? v.y : 0,
          });
        }
      }
    } catch {}
  }, []);

  // persist view
  useEffect(() => {
    try { localStorage.setItem('anet-topo-view', JSON.stringify(view)); } catch {}
  }, [view]);

  // track fullscreen state (button label + Esc-exit sync)
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // wheel zoom — native non-passive listener so preventDefault() actually
  // stops the page from scrolling. Uses functional setState so the listener
  // never goes stale and can attach once.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * VIEWBOX_W;
      const my = ((e.clientY - rect.top) / rect.height) * VIEWBOX_H;
      setView(prev => {
        // Round 104 (issue #81 follow-up): Vincent 实测 zoom 太灵敏. The
        // old factor was a fixed 1.15x per wheel *event* — fine for a
        // mouse notch but a trackpad fires dozens of events per gesture
        // so it compounded into huge jumps. Scale the factor by deltaY
        // magnitude with a small coefficient, then clamp the per-event
        // change so no single tick moves more than ~8%.
        const factor = Math.min(1.08, Math.max(0.926, Math.exp(-e.deltaY * 0.0006)));
        const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
        const ratio = nz / prev.zoom;
        // keep the point under the cursor stationary
        return { zoom: nz, x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: viewRef.current.x,
      baseY: viewRef.current.y,
    };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - d.startX) / rect.width) * VIEWBOX_W;
    const dy = ((e.clientY - d.startY) / rect.height) * VIEWBOX_H;
    setView(prev => ({ ...prev, x: d.baseX + dx, y: d.baseY + dy }));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {}
  };

  // zoom buttons — zoom around the canvas center
  const zoomBy = (factor: number) => {
    setView(prev => {
      const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.zoom * factor));
      const ratio = nz / prev.zoom;
      const cx0 = VIEWBOX_W / 2;
      const cy0 = VIEWBOX_H / 2;
      return { zoom: nz, x: cx0 - (cx0 - prev.x) * ratio, y: cy0 - (cy0 - prev.y) * ratio };
    });
  };
  const resetView = () => setView({ zoom: 1, x: 0, y: 0 });

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      const req =
        el.requestFullscreen ||
        (el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen;
      req?.call(el);
    }
  };

  return (
    <section className="w-full max-w-6xl mx-auto mb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-3 px-1">
        <div>
          <div className="text-xs uppercase text-gray-600 tracking-wider">Network Topology</div>
          <h2 className="text-lg text-white font-semibold">Command mesh</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-md bg-green-500/10 text-green-300 border border-green-500/20">
            {workingCount} working
          </span>
          <span className="px-2.5 py-1 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            {onlineNodes.length} online
          </span>
          <span className="px-2.5 py-1 rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20">
            {flowLinks.length} active links
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-lg border shadow-2xl ${isLight ? 'shadow-zinc-900/5' : 'shadow-cyan-950/30'} ${isFullscreen ? 'flex items-center justify-center' : ''}`}
        style={{ background: pal.containerBg, borderColor: pal.containerBorder }}
      >
        <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${pal.topRailGradient}`} />

        <svg
          ref={svgRef}
          viewBox="0 0 1000 680"
          className="w-full h-auto block"
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ cursor: 'grab', touchAction: 'none' }}
        >
          <defs>
            <linearGradient id="topo-panel" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%"   stopColor={pal.panelStops[0]} />
              <stop offset="48%"  stopColor={pal.panelStops[1]} />
              <stop offset="100%" stopColor={pal.panelStops[2]} />
            </linearGradient>
            <radialGradient id="topo-radar" cx="50%" cy="50%" r="55%">
              <stop offset="0%"   stopColor={pal.radarStops[0].color} stopOpacity={pal.radarStops[0].opacity} />
              <stop offset="45%"  stopColor={pal.radarStops[1].color} stopOpacity={pal.radarStops[1].opacity} />
              <stop offset="100%" stopColor={pal.radarStops[2].color} stopOpacity={pal.radarStops[2].opacity} />
            </radialGradient>
            {!isLight && (
              <filter id="topo-glow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            )}
            <marker id="topo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={pal.arrowFill} />
            </marker>
            {/* Round 45: radial radar sweep gradient — bright at center
                (where it meets the hub) fading to leading edge. */}
            <radialGradient id="topo-sweep" cx="0%" cy="50%" r="100%">
              <stop offset="0%"  stopColor={isLight ? '#0d9488' : '#22d3ee'} stopOpacity={isLight ? 0.18 : 0.32} />
              <stop offset="70%" stopColor={isLight ? '#0d9488' : '#22d3ee'} stopOpacity={isLight ? 0.10 : 0.18} />
              <stop offset="100%" stopColor={isLight ? '#0d9488' : '#22d3ee'} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* panel backdrop stays fixed — panning never reveals empty canvas */}
          <rect width="1000" height="680" fill="url(#topo-panel)" />

          {/* Round 103 (issue #81): everything inside this <g> zooms + pans
              together. transform order = translate then scale. */}
          <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          <circle cx={cx} cy={cy} r="330" fill="url(#topo-radar)" />

          {/* Round 45: subtle star field — 24 deterministic dots scattered
              across the canvas give the radar bg some depth. Skipped on
              light theme so the white surface stays clean. */}
          {!isLight && (
            <g opacity="0.5">
              {Array.from({ length: 28 }).map((_, i) => {
                // Deterministic pseudo-random scatter so positions are
                // stable between renders (no JS hydration mismatch).
                const seed = i * 9301 + 49297;
                const x = ((seed * 13) % 1000);
                const y = ((seed * 7) % 680);
                const r = (i % 3 === 0) ? 1.2 : 0.7;
                return <circle key={i} cx={x} cy={y} r={r} fill="#a5b4fc" opacity={0.35 + (i % 4) * 0.05} />;
              })}
            </g>
          )}

          {/* Round 45: rotating radar sweep — a 40° wedge with a soft
              leading-edge gradient. Slow 6s rotation reads as a radar
              scan without being noisy. Inline transform-origin on the
              <g> wrapper ensures Chrome / Firefox rotate around (cx,cy)
              instead of the SVG viewBox corner. */}
          <g
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              transformBox: 'view-box',
            }}
            className="anet-topo-sweep"
            opacity={isLight ? 0.7 : 1}
          >
            <path
              d={`M ${cx} ${cy} L ${cx + 330} ${cy} A 330 330 0 0 0 ${cx + 330 * Math.cos(-Math.PI / 4.5)} ${cy + 330 * Math.sin(-Math.PI / 4.5)} Z`}
              fill="url(#topo-sweep)"
            />
          </g>

          {/* radar rings */}
          {[90, 170, 250, 330].map(radius => (
            <circle key={radius} cx={cx} cy={cy} r={radius} fill="none" stroke={pal.ringStroke} strokeWidth="1" opacity={isLight ? 0.6 : 0.35} />
          ))}

          {/* Round 50: 4 small particles slowly orbiting the outer ring
              (r=330). Each starts at a different angle (offset 0/0.25/0.5/0.75
              of the cycle) so they're evenly spaced. 16s per revolution is
              slow enough to feel ambient, not noisy. Skipped on light theme
              so the white surface stays clean. */}
          {!isLight && [0, 0.25, 0.5, 0.75].map((phase, i) => (
            <g key={`orbit-${i}`}>
              <circle
                cx={cx + 330} cy={cy}
                r={i === 0 ? 2.8 : 2.2}
                fill="#22d3ee"
                opacity={0.9}
                filter="url(#topo-glow)"
              >
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from={`${phase * 360} ${cx} ${cy}`}
                  to={`${phase * 360 + 360} ${cx} ${cy}`}
                  dur="16s"
                  repeatCount="indefinite"
                />
              </circle>
            </g>
          ))}

          {[0, 30, 60, 90, 120, 150].map(angle => (
            <line
              key={angle}
              x1={cx - 360 * Math.cos(angle * Math.PI / 180)}
              y1={cy - 360 * Math.sin(angle * Math.PI / 180)}
              x2={cx + 360 * Math.cos(angle * Math.PI / 180)}
              y2={cy + 360 * Math.sin(angle * Math.PI / 180)}
              stroke={pal.ringStroke}
              strokeWidth="1"
              opacity={isLight ? 0.35 : 0.18}
            />
          ))}

          {/* hub links — round 46: idle spokes now have animated
              stroke-dashoffset so dashes flow outward from the hub
              ("command relay" feel). Active spokes carrying live message
              flow stay as solid bright strokes. */}
          {onlineNodes.map((session, idx) => {
            const pos = nodePositions[session.alias];
            if (!pos) return null;
            const path = curvePath({ x: cx, y: cy }, pos, 0);
            const isActiveSpoke = activeAliases.has(session.alias);

            return (
              <path
                key={`hub-${session.alias}`}
                d={path}
                fill="none"
                stroke={isActiveSpoke ? pal.spokeStroke.active : pal.spokeStroke.idle}
                strokeWidth={isActiveSpoke ? 2 : 1}
                strokeDasharray={isActiveSpoke ? 'none' : '6 14'}
                opacity={isActiveSpoke ? 0.7 : 0.45}
                className={isActiveSpoke ? undefined : 'anet-topo-spoke-flow'}
                style={isActiveSpoke ? undefined : { animationDelay: `${-(idx * 0.25)}s` }}
              />
            );
          })}

          {/* directed message flows */}
          {flowLinks.map((link, index) => {
            const from = nodePositions[link.from];
            const to = nodePositions[link.to];
            if (!from || !to) return null;

            const lift = index % 2 === 0 ? 36 : -36;
            const path = curvePath(from, to, lift);
            const width = Math.min(2 + link.count, 7);
            const duration = 2.2 + (index % 5) * 0.32;

            return (
              <g key={link.key}>
                <path
                  d={path}
                  fill="none"
                  stroke={pal.flowEdge}
                  strokeWidth={width}
                  opacity={isLight ? 0.22 : 0.28}
                  filter={isLight ? undefined : 'url(#topo-glow)'}
                  markerEnd="url(#topo-arrow)"
                />
                <path
                  id={`flow-path-${index}`}
                  d={path}
                  fill="none"
                  stroke={pal.flowPath}
                  strokeWidth="1"
                  strokeDasharray="2 12"
                  opacity={isLight ? 0.4 : 0.75}
                />
                <circle r="4" fill={pal.flowParticle} filter={isLight ? undefined : 'url(#topo-glow)'}>
                  <animateMotion dur={`${duration}s`} repeatCount="indefinite" path={path} />
                </circle>
              </g>
            );
          })}

          {/* center hub — round 39: enlarged from r=6 (12px) to r=10 (20px)
              core so the "control plane" reads as the network's anchor,
              not a stray particle. Static halo ring at r=18 grounds it
              visually; two outward pulses keep the "signal source" idea
              from r17. Light theme gets a paler core to avoid hot-spotting
              the bg. */}
          <g>
            {/* static grounding halo — sits underneath, low opacity */}
            <circle
              cx={cx} cy={cy} r="18"
              fill={isLight ? '#d1fae5' : '#10b981'}
              opacity={isLight ? 0.35 : 0.10}
            />
            {/* outer pulse 1 */}
            <circle cx={cx} cy={cy} r="10" fill="none" stroke="#10b981" strokeWidth="1.5">
              <animate attributeName="r" values="10;38;10" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0;0.55" dur="2.4s" repeatCount="indefinite" />
            </circle>
            {/* outer pulse 2 (delayed 1.2s) */}
            <circle cx={cx} cy={cy} r="10" fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0">
              <animate attributeName="r" values="10;38;10" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.45;0;0.45" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
            </circle>
            {/* core — 20px diameter, larger inner highlight reads as a "lit lamp" */}
            <circle cx={cx} cy={cy} r="10" fill={isLight ? '#059669' : '#10b981'} />
            <circle cx={cx} cy={cy} r="5" fill="#d1fae5" opacity="0.9" />
          </g>

          {/* agent nodes */}
          {[...onlineNodes, ...offlineNodes].map(session => {
            const pos = nodePositions[session.alias];
            if (!pos) return null;

            const sseCountFor = (session.network_id ? sseSessions[`${session.network_id}:${session.alias}`] : undefined) ?? sseSessions[session.alias];
            const isOnline = session.status !== 'offline' || !!sseCountFor;
            const status = nodeStatus(session, isOnline, isLight);
            const isActive = activeAliases.has(session.alias);
            const radius = isOnline ? 26 : 18;
            // Round 109 (Vincent 4582 P0): at high node counts the 100px
            // label cards overlap each other and cover neighbouring
            // avatars. Above the density threshold, render a label only
            // for the hovered node — or for every node once the user has
            // zoomed in past 1.4× (they zoomed in to read). Below the
            // threshold labels show always (low density has room).
            const showLabel = !denseLayout || hoveredAlias === session.alias || view.zoom >= 1.4;

            return (
              <g
                key={session.alias}
                className="transition-opacity"
                onPointerEnter={() => denseLayout && setHoveredAlias(session.alias)}
                onPointerLeave={() => denseLayout && setHoveredAlias(prev => (prev === session.alias ? null : prev))}
              >
                {isActive && (
                  <circle cx={pos.x} cy={pos.y} r={radius + 14} fill={status.primary} opacity={isLight ? 0.08 : 0.12}>
                    <animate attributeName="r" values={`${radius + 8};${radius + 22};${radius + 8}`} dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values={isLight ? '0.12;0.02;0.12' : '0.18;0.04;0.18'} dur="2.4s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={pos.x} cy={pos.y} r={radius + 8} fill={status.halo} opacity={isOnline ? (isLight ? 0.85 : 0.65) : (isLight ? 0.4 : 0.25)} />
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius}
                  fill={isOnline ? pal.nodeFill.online : pal.nodeFill.offline}
                  stroke={status.primary}
                  strokeWidth={isOnline ? 3 : 1.5}
                  strokeDasharray={isOnline ? 'none' : '5 5'}
                  filter={isOnline && !isLight ? 'url(#topo-glow)' : undefined}
                />
                {/* Round 99 (issue #79): node "avatar" — hue-hashed
                    initials circle inside the status ring. Round 100:
                    when brand=intern, swap the initials for the 书小生
                    mascot image (asset from 群星马 task 51dd0d1d). The
                    image already has a transparent bg so it sits cleanly
                    on the node's dark/light fill; the outer status ring
                    still carries working/idle/etc. */}
                {(() => {
                  const ar = isOnline ? 14 : 10;
                  // Round 108 (issue #79 reopened): show the 书小生 avatar
                  // coin for any agent whose alias marks it as an Intern /
                  // 书生 runtime — not only under the global ?brand=intern
                  // flag. Vincent 4565: a fleet of 书生N号 nodes should SHOW
                  // 书生, not a generic "书" initial. ?brand=intern still
                  // forces the coin on every node (full brand showcase).
                  const isInternNode = isIntern || /书生|书小生|intern/i.test(session.alias);
                  if (isInternNode) {
                    // Round 102: self-contained "avatar coin" — 书小生 figure
                    // keyed off its white background and composited onto a
                    // cream circular backplate. The cream coin gives the
                    // dark-haired figure consistent contrast on BOTH the
                    // dark cyber theme and light theme. Render at the node
                    // diameter so the coin fills inside the status ring.
                    const size = radius * 2;
                    return (
                      <image
                        href="/intern_avatar.png"
                        x={pos.x - size / 2}
                        y={pos.y - size / 2}
                        width={size}
                        height={size}
                        preserveAspectRatio="xMidYMid meet"
                      />
                    );
                  }
                  // Round 106 (issue #83): hue keyed to the prefix group,
                  // not the full alias — every 通信* node shares one color,
                  // every 研究员* another, so teams cluster visually even
                  // when the tier layout spreads them across rings.
                  const c = aliasAvatarColors(groupKeys[session.alias] || session.alias);
                  const fs = isOnline ? 14 : 10;
                  return (
                    <>
                      <circle cx={pos.x} cy={pos.y} r={ar} fill={c.bg} stroke={c.ring} strokeWidth="1" />
                      <text
                        x={pos.x}
                        y={pos.y}
                        dy="0.34em"
                        textAnchor="middle"
                        fill={c.text}
                        fontSize={fs}
                        fontFamily="monospace"
                        fontWeight="700"
                      >
                        {aliasInitial(session.alias)}
                      </text>
                    </>
                  );
                })()}
                {session.status === 'working' && (
                  // working pulse — small dot just inside the status ring,
                  // above the avatar text. Was a 18px horizontal bar at
                  // y+11 which now collides with the avatar; the dot reads
                  // as the same "active" cue without occluding the initial.
                  <circle cx={pos.x} cy={pos.y - (isOnline ? 18 : 13)} r="2.5" fill={pal.flowParticle}>
                    <animate attributeName="opacity" values="1;0.25;1" dur="1.1s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Round 98 (issue #61): label rect 124px → 100px.
                    Round 109 (Vincent 4582 P0): only rendered when
                    showLabel — below the density threshold always, above
                    it only for the hovered node or when zoomed in — so a
                    dense fleet shows clean, unobscured avatars. */}
                {showLabel && (
                  <g transform={`translate(${pos.x}, ${pos.y + radius + 22})`} style={{ pointerEvents: 'none' }}>
                    <rect x="-50" y="-14" width="100" height="42" rx="6" fill={pal.labelBox.fill} stroke={pal.labelBox.stroke} opacity={isLight ? 1 : 0.94} />
                    <text x="0" y="1" textAnchor="middle" fill={status.text} fontSize="12" fontFamily="monospace" fontWeight="700">
                      {truncate(session.alias, 12)}
                    </text>
                    <text x="0" y="17" textAnchor="middle" fill={status.primary} fontSize="9" fontFamily="monospace">
                      {status.label}{isOnline && sseCountFor != null ? ` sse:${sseCountFor}` : ''}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* latest flow labels */}
          <g transform="translate(28, 34)">
            <rect x="0" y="0" width="285" height={60 + Math.min(flowLinks.length, 4) * 20} rx="8" fill={pal.legendBox.fill} stroke={pal.legendBox.stroke} opacity={isLight ? 1 : 0.94} />
            <text x="16" y="26" fill={pal.legendHeadline} fontSize="13" fontFamily="monospace" fontWeight="700">recent signal</text>
            <text x="178" y="26" fill={pal.legendAccent} fontSize="11" fontFamily="monospace">{messages.length} messages</text>
            {flowLinks.slice(0, 4).map((link, index) => (
              <text key={link.key} x="16" y={54 + index * 20} fill={pal.legendText} fontSize="10" fontFamily="monospace">
                {truncate(link.from, 8)} {'->'} {truncate(link.to, 8)} / {link.count} / {truncate(link.content, 18)}
              </text>
            ))}
          </g>

          {/* legend */}
          <g transform="translate(720, 34)">
            <rect x="0" y="0" width="250" height="112" rx="8" fill={pal.legendBox.fill} stroke={pal.legendBox.stroke} opacity={isLight ? 1 : 0.94} />
            <circle cx="18" cy="26" r="6" fill={isLight ? '#059669' : '#22c55e'} />
            <text x="34" y="30" fill={pal.legendText} fontSize="11" fontFamily="monospace">working node</text>
            <circle cx="18" cy="52" r="6" fill={isLight ? '#0d9488' : '#2dd4bf'} />
            <text x="34" y="56" fill={pal.legendText} fontSize="11" fontFamily="monospace">online idle</text>
            <circle cx="18" cy="78" r="6" fill={isLight ? '#94a3b8' : '#6b7280'} />
            <text x="34" y="82" fill={pal.legendText} fontSize="11" fontFamily="monospace">offline / no SSE</text>
            <path d="M150,78 Q176,52 210,78" fill="none" stroke={pal.flowEdge} strokeWidth="3" markerEnd="url(#topo-arrow)" />
          </g>
          </g>
        </svg>

        {/* Round 103 (issue #81): zoom / pan / fullscreen controls — HTML
            overlay so they stay fixed while the SVG content transforms.
            Round 104: Vincent 实测 — the reset action used to be hidden
            behind the "%" label (looked like an indicator, not a button).
            Split into a plain % readout + an explicit reset button with
            its own icon + tooltip. */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs select-none">
          <div
            className="flex items-center rounded-md border overflow-hidden"
            style={{ background: pal.legendBox.fill, borderColor: pal.containerBorder }}
          >
            <button
              onClick={() => zoomBy(1 / 1.2)}
              className="px-2 py-1 hover:bg-white/5 transition-colors"
              style={{ color: pal.legendText }}
              aria-label="Zoom out"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
            </button>
            <span
              className="px-2 py-1 tabular-nums border-x text-center"
              style={{ color: pal.legendText, borderColor: pal.containerBorder, minWidth: 46 }}
              title="Current zoom level"
            >
              {Math.round(view.zoom * 100)}%
            </span>
            <button
              onClick={() => zoomBy(1.2)}
              className="px-2 py-1 hover:bg-white/5 transition-colors"
              style={{ color: pal.legendText }}
              aria-label="Zoom in"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <button
            onClick={resetView}
            className="p-1.5 rounded-md border hover:bg-white/5 transition-colors"
            style={{ background: pal.legendBox.fill, borderColor: pal.containerBorder, color: pal.legendText }}
            aria-label="Reset view"
            title="Reset zoom + pan (or double-click the canvas)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md border hover:bg-white/5 transition-colors"
            style={{ background: pal.legendBox.fill, borderColor: pal.containerBorder, color: pal.legendText }}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 3v4a1 1 0 0 1-1 1H3M21 8h-4a1 1 0 0 1-1-1V3M3 16h4a1 1 0 0 1 1 1v4M16 21v-4a1 1 0 0 1 1-1h4" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 8V5a2 2 0 0 1 2-2h3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
