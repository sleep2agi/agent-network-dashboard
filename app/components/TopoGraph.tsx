'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Session } from './types';
import { aliasAvatarColors, aliasInitial } from './AliasAvatar';
import { ChatPopover } from './ChatPopover';
import { vendorForModel, runtimeIdentity, identityLine } from '../lib/vendorIdentity';
import { parseHubTime, relativeAgo } from '../lib/time';

interface MessageFlow {
  from_alias: string;
  to_alias: string;
  content: string;
  created_at: string;
}

interface TopoGraphProps {
  sessions: Session[];
  sseSessions: Record<string, number>;
  // #84: a node.renamed event from the Overview's SSE listener. When the
  // currently open chat popover targets `from`, it follows the rename to `to`.
  renameSignal?: { from: string; to: string; ts: number } | null;
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
  /** ISO timestamp of the most recent message on this edge — drives
   *  the Round 10 freshness fade so dormant links recede visually. */
  last_at: string;
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

/** Round 46 / Loop: SWR-freshness chip.
 *
 *  TopoGraph's data refreshes every 5 s via SWR but the user has no
 *  visible signal that the canvas they're looking at is current. The
 *  flow particles and chips (R42 active-links, R43 hub) tell you when
 *  the FLEET last did something, not when the DATA last syncing. This
 *  chip ticks `live · Ns` against a 1-second interval so the operator
 *  can trust freshness without doing internal math.
 *
 *  Owns its own setInterval so the parent topology doesn't re-render
 *  every second (only this small chip does). lastSyncRef is updated
 *  whenever the `sessions` prop reference changes — that's the SWR
 *  refresh signal. */
function FreshnessChip({ sessions }: { sessions: unknown }) {
  const lastSyncRef = useRef<number>(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // sessions reference changed → SWR just delivered a new payload.
    lastSyncRef.current = Date.now();
  }, [sessions]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, Math.floor((now - lastSyncRef.current) / 1000));
  // Tint the chip warmer when the data goes stale (>10s since last sync).
  // SWR's default refreshInterval here is 5s, so anything past ~10s is
  // either a poll miss or a network hiccup.
  const stale = sec > 10;
  return (
    <span
      className={stale
        ? "hidden sm:inline px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 font-mono"
        : "hidden sm:inline px-2.5 py-1 rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20 font-mono"}
      title={stale ? `Last sync ${sec}s ago — SWR refresh may be lagging` : `Live data · refreshes every 5s · last sync ${sec}s ago`}
      data-freshness-chip
    >
      live · {sec}s
    </span>
  );
}

/** Round 36 / Loop: prefers-reduced-motion hook.
 *
 *  Round 29's a11y sweep zeroed CSS animations via media query, but SVG
 *  SMIL `<animate>` / `<animateMotion>` elements aren't reachable from CSS
 *  — they need JS to opt out. This hook reads the media query and listens
 *  for changes so the topology's flow particles, pulses, click ripple
 *  and hub breath honour the OS-level preference. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// Round 38 / Loop: parseHubTime + relativeAgo factored to app/lib/time.ts
// — the Round 35 fix lives there now alongside the Round 37 mirror so
// any future TZ-safe parse update happens in one place.

/** Round 12 / Loop: status trio audit.
 *
 *  Each (status × theme) cell returns a {primary, halo, text} trio. The trio
 *  invariant — keep it when adding states or tweaking shades:
 *
 *    light:  primary = <hue>-600   halo = <hue>-100 *   text = <hue>-800/900
 *    dark:   primary = <hue>-400/500 halo = <hue>-900  text = <hue>-100
 *
 *    * offline.halo light deviates intentionally to slate-200 (#e2e8f0):
 *      slate-100 (#f1f5f9) is too close to the panel bg (#f8fafc) and the
 *      halo would vanish. The other three rows keep the 100-shade.
 *
 *  Audit caught one cross-family drift before this round: online-other halo
 *  light was #dbeafe (blue-100) while its primary (#0284c7 sky-600) and text
 *  (#0c4a6e sky-900) were sky-family — now sky-100 (#e0f2fe). Tiny visual
 *  difference; large hygiene win — every trio is now mono-hue. */
function nodeStatus(session: Session, isOnline: boolean, isLight: boolean) {
  if (!isOnline) {
    return {
      label: 'offline',
      primary: isLight ? '#94a3b8' : '#6b7280', // slate-400 / gray-500
      halo:    isLight ? '#e2e8f0' : '#111827', // slate-200* / gray-900
      text:    isLight ? '#475569' : '#9ca3af', // slate-600 / gray-400
    };
  }
  if (session.status === 'working') {
    return {
      label: 'working',
      primary: isLight ? '#059669' : '#22c55e', // emerald-600 / green-500
      halo:    isLight ? '#d1fae5' : '#14532d', // emerald-100 / green-900
      text:    isLight ? '#065f46' : '#dcfce7', // emerald-800 / green-100
    };
  }
  if (session.status === 'idle') {
    return {
      label: 'idle',
      primary: isLight ? '#0d9488' : '#2dd4bf', // teal-600 / teal-400
      halo:    isLight ? '#ccfbf1' : '#134e4a', // teal-100 / teal-900
      text:    isLight ? '#115e59' : '#ccfbf1', // teal-800 / teal-100
    };
  }
  return {
    label: session.status || 'online',
    primary: isLight ? '#0284c7' : '#38bdf8', // sky-600 / sky-400
    halo:    isLight ? '#e0f2fe' : '#0c4a6e', // sky-100 / sky-900  (was blue-100 — drift fixed Round 12)
    text:    isLight ? '#0c4a6e' : '#e0f2fe', // sky-900 / sky-100
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

/** #83 + #111: group nodes that share a ≥2-char alias prefix OR a project_dir
 *  ("either criterion → same group", Vincent 4724). Union-find over the
 *  sessions; the component label prefers the shared project_dir's basename,
 *  else the common alias prefix. Returns alias → groupKey. */
function computeGroups(sessions: { alias: string; project_dir?: string | null }[]): Record<string, string> {
  const n = sessions.length;
  const parent = sessions.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // union by shared project_dir
  const byDir: Record<string, number[]> = {};
  sessions.forEach((s, i) => {
    const d = s.project_dir?.trim();
    if (d) (byDir[d] ||= []).push(i);
  });
  for (const idxs of Object.values(byDir)) {
    for (let k = 1; k < idxs.length; k++) union(idxs[0], idxs[k]);
  }

  // union by shared ≥2-char alias prefix — sort, link adjacent pairs
  const order = sessions.map((_, i) => i).sort((a, b) => sessions[a].alias.localeCompare(sessions[b].alias));
  for (let k = 0; k + 1 < order.length; k++) {
    if (commonPrefix(sessions[order[k]].alias, sessions[order[k + 1]].alias).length >= 2) {
      union(order[k], order[k + 1]);
    }
  }

  // label each connected component
  const comps: Record<number, number[]> = {};
  for (let i = 0; i < n; i++) (comps[find(i)] ||= []).push(i);
  const keys: Record<string, string> = {};
  for (const members of Object.values(comps)) {
    let label: string;
    if (members.length === 1) {
      label = sessions[members[0]].alias;
    } else {
      const dirs = new Set(members.map(i => sessions[i].project_dir?.trim()).filter(Boolean) as string[]);
      if (dirs.size === 1) {
        const d = [...dirs][0];
        label = d.split('/').filter(Boolean).pop() || d;
      } else {
        label = members.map(i => sessions[i].alias).reduce((a, b) => commonPrefix(a, b));
        if (label.length < 2) label = sessions[members[0]].alias;
      }
    }
    for (const i of members) keys[sessions[i].alias] = label;
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

    // Keep the most-recent timestamp per pair so the render can fade
    // dormant edges (Round 10 freshness fade).
    const incoming = message.created_at || '';
    const last_at = !current
      ? incoming
      : (incoming > current.last_at ? incoming : current.last_at);

    links.set(key, {
      key,
      from: message.from_alias,
      to: message.to_alias,
      count: (current?.count || 0) + 1,
      content: current?.content || message.content,
      last_at,
    });
  });

  return [...links.values()].slice(0, 18);
}

export function TopoGraph({ sessions, sseSessions, renameSignal }: TopoGraphProps) {
  const theme = useTheme();
  const isLight = theme === 'light';
  const reducedMotion = useReducedMotion();
  const pal = isLight ? LIGHT_PALETTE : DARK_PALETTE;
  const brand = useBrand();
  const isIntern = brand === 'intern';
  const [messages, setMessages] = useState<MessageFlow[]>([]);
  // Issue #87: ring | grid layout toggle. Ring is the tiered-radial default;
  // grid arranges nodes in an N×M grid (better for 30+ nodes). Persisted to
  // localStorage like the zoom/pan view state. Declared above nodePositions
  // since that useMemo branches on it.
  const [layout, setLayout] = useState<'ring' | 'grid'>('ring');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('anet-topo-layout');
      if (saved === 'grid' || saved === 'ring') setLayout(saved);
    } catch {}
  }, []);
  const toggleLayout = () => setLayout(prev => {
    const next = prev === 'ring' ? 'grid' : 'ring';
    try { localStorage.setItem('anet-topo-layout', next); } catch {}
    return next;
  });
  // Issue #113: node size scale (Vincent 4727 — nodes too big / crowded at
  // ~22 nodes). S/M/L → 0.7/0.84/1.0; default M (one notch down from the old
  // fixed size). Persisted like the layout toggle.
  const [nodeScale, setNodeScale] = useState(0.84);
  useEffect(() => {
    try {
      const saved = parseFloat(localStorage.getItem('anet-topo-nodescale') || '');
      if (saved === 0.7 || saved === 0.84 || saved === 1) setNodeScale(saved);
    } catch {}
  }, []);
  const pickNodeScale = (v: number) => {
    setNodeScale(v);
    try { localStorage.setItem('anet-topo-nodescale', String(v)); } catch {}
  };

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
    groupBoxes,
    gridContentBottom,
  } = useMemo(() => {
    const sseCount = (s: { alias: string; network_id?: string }) =>
      (s.network_id ? sseSessions[`${s.network_id}:${s.alias}`] : undefined) ?? sseSessions[s.alias];
    // Round 106 (issue #83): sort by alias so same-prefix agents
    // (通信龙 / 通信牛 / 通信工程马 …, or 研究员1号 / 研究员2号 …) end up
    // adjacent in the array — the tier layout below assigns angles by
    // index, so contiguous-in-array becomes contiguous-in-ring, i.e.
    // each team visually clusters. localeCompare keeps CJK ordering sane.
    const byAlias = (a: Session, b: Session) => a.alias.localeCompare(b.alias);
    // #112 umbrella: ghost age-out — an offline node not seen recently is
    // almost certainly a deleted node the server `/api/status` still
    // returns (#74 root cause is server-side; this is the dashboard-side
    // fallback so stale ghosts stop cluttering the topology). A missing
    // last_seen_at is kept (conservative — could be a legitimately new node).
    // Round 27 / P0: the 24h threshold was too lenient — Vincent's preview.29
    // screenshot showed B站马 nodes deleted ~4 h earlier still visible. A
    // healthy agent heartbeats every few seconds; if it's been silent for
    // an hour it's effectively gone. 1 h gives a fresh disconnect time to
    // come back while removing dead nodes well within an operator session.
    const GHOST_MS = 60 * 60 * 1000;
    const now = Date.now();
    const isGhost = (s: Session) => {
      if (s.status !== 'offline' || sseCount(s) || !s.last_seen_at) return false;
      // Round 35 / Loop: parseHubTime normalises SQL-style timestamps to UTC
      // before parsing so non-UTC browsers don't see a phantom 8-hour skew
      // and ghost freshly-disconnected nodes.
      const t = parseHubTime(s.last_seen_at);
      return t !== null && now - t > GHOST_MS;
    };
    const online = sessions.filter(s => s.status !== 'offline' || sseCount(s)).sort(byAlias);
    const offline = sessions.filter(s => s.status === 'offline' && !sseCount(s) && !isGhost(s)).sort(byAlias);
    const positions: Record<string, Point> = {};

    if (layout === 'grid') {
      // Issue #87 + #111: group-banded grid. Nodes are sorted by alias so
      // same-prefix aliases are adjacent; each multi-member prefix group then
      // gets its OWN row(s) starting at column 0, while singletons pack into
      // shared rows. Group-banded placement keeps every group's bounding box
      // (#111) a clean rectangle — no box ever overlaps another group's.
      const all = [...online, ...offline];
      const groupKeys = computeGroups(all);
      const cols = Math.max(1, Math.ceil(Math.sqrt(all.length)));
      // #112: gy0 starts below the (now compact) recent-signal / legend
      // overlay panels — their max bottom edge is y≈112 — so grid row 0 is
      // never occluded; gy1 extends near the canvas bottom for breathing room.
      const gx0 = 150, gx1 = 850, gy0 = 126, gy1 = 652;
      const cellW = (gx1 - gx0) / cols;
      // largest node radius at the current size scale — drives the group
      // label band + the row-height floor so nothing ever overlaps.
      const nodeR = Math.round(26 * nodeScale);

      // ordered runs of consecutive same-group-key nodes (≥2 = real group)
      const runs: { key: string; members: Session[] }[] = [];
      for (const s of all) {
        const gk = groupKeys[s.alias];
        const last = runs[runs.length - 1];
        if (last && last.key === gk) last.members.push(s);
        else runs.push({ key: gk, members: [s] });
      }

      // Pass 1 — assign each run to a band: a multi-member group owns its
      // rows (left-aligned, so its bounding box is a tidy rect); contiguous
      // singletons pack into shared rows (centred). Collect total row count.
      type Band = { members: Session[]; startRow: number; centred: boolean; isGroup: boolean };
      const bands: Band[] = [];
      let row = 0;
      let i = 0;
      while (i < runs.length) {
        if (runs[i].members.length >= 2) {
          bands.push({ members: runs[i].members, startRow: row, centred: false, isGroup: true });
          row += Math.ceil(runs[i].members.length / cols);
          i++;
        } else {
          const singles: Session[] = [];
          while (i < runs.length && runs[i].members.length < 2) {
            singles.push(runs[i].members[0]);
            i++;
          }
          bands.push({ members: singles, startRow: row, centred: true, isGroup: false });
          row += Math.ceil(singles.length / cols);
        }
      }
      const totalRows = Math.max(1, row);
      // #112: the group label sits in a band ABOVE the topmost node, so the
      // band must clear the node radius — GROUP_TOP is node-relative, never
      // cellH-derived (cellH-derived was the label↔node overlap bug Vincent
      // hit). cellH then floors at GROUP_TOP + 30 so the label band + bottom
      // padding always fit and stacked group boxes never touch; past the
      // floor the grid overflows and zoom/pan handles it.
      const GROUP_TOP = nodeR + 20;
      // Round 27 / P0 (Vincent screenshot preview.29): dense plain-text
      // node labels (`pos.y + radius + denseDrop`, with a 3 px containerBg
      // stroke halo for readability) at the BOTTOM row of band N would
      // paint OVER the start of band N+1's group label, creating the
      // "blueleap → eleap", "agent-network-dashboard → t-network / board"
      // visual chopping. Geometry of the collision:
      //   dense label visual bottom  = node_N.y + radius + denseDrop + halo
      //   group label glyph top      = boxY + 4   (text y=boxY+14, ~10px ascent)
      //                              = node_N+1.y - GROUP_TOP + 4
      // node_N+1.y - node_N.y = cellH for consecutive rows, so no-collide:
      //   cellH ≥ radius + denseDrop + halo + GROUP_TOP - 4 + buffer
      // With halo=3 buffer=4: cellH ≥ nodeR + denseDrop + GROUP_TOP + 3.
      const denseDrop = nodeScale < 0.8 ? 12 : 14;
      const cellH = Math.max(
        2 * nodeR + 22,                         // node + dense label within band
        GROUP_TOP + 12,                         // group-label band + box padding
        nodeR + denseDrop + GROUP_TOP + 3,      // round-27 dense↔group label clearance
        Math.min(100, (gy1 - gy0) / totalRows),
      );

      // Pass 2 — place each band's members.
      for (const band of bands) {
        band.members.forEach((s, idx) => {
          const rowInBand = Math.floor(idx / cols);
          const c = idx % cols;
          const inRow = Math.min(cols, band.members.length - rowInBand * cols);
          const inset = band.centred ? ((cols - inRow) * cellW) / 2 : 0;
          positions[s.alias] = {
            x: gx0 + inset + (c + 0.5) * cellW,
            y: gy0 + (band.startRow + rowInBand + 0.5) * cellH,
          };
        });
      }

      const links = buildFlowLinks(messages, positions);
      const active = new Set<string>();
      links.forEach(link => { active.add(link.from); active.add(link.to); });
      // #111: one bounding box per multi-member group (Vincent 4722). Each
      // group owns its rows; GROUP_PAD fills the row space left below the
      // nodes after the label band, so stacked group boxes always have a
      // gap between them (GROUP_TOP is defined above, with cellH).
      const GROUP_PAD = Math.max(8, Math.min(26, cellH - GROUP_TOP - 8)); // side/bottom
      const groupBoxes = bands
        .filter(b => b.isGroup)
        .map(band => {
          const pts = band.members.map(s => positions[s.alias]).filter(Boolean);
          const xs = pts.map(p => p.x);
          const ys = pts.map(p => p.y);
          const minX = Math.min(...xs), minY = Math.min(...ys);
          return {
            key: band.members.length ? groupKeys[band.members[0].alias] : '',
            count: band.members.length,
            x: minX - GROUP_PAD,
            y: minY - GROUP_TOP,
            w: Math.max(...xs) - minX + GROUP_PAD * 2,
            h: Math.max(...ys) - minY + GROUP_TOP + GROUP_PAD,
          };
        });
      // Round 28 / Loop: surface the grid's natural content bottom so the
      // mount effect can auto-fit zoom when the layout would overflow the
      // viewBox. = bottom of the last node row + its label drop + a small
      // breathing buffer. Round 27's cellH bump makes this overflow more
      // common (30-node fleets reach ~774 px, viewBox is 680).
      const gridContentBottom = gy0 + totalRows * cellH + 8;
      return {
        onlineNodes: online,
        offlineNodes: offline,
        nodePositions: positions,
        flowLinks: links,
        activeAliases: active,
        groupKeys,
        groupBoxes,
        gridContentBottom,
      };
    }

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
    const groupKeys = computeGroups([...online, ...offline]);

    return {
      onlineNodes: online,
      offlineNodes: offline,
      nodePositions: positions,
      flowLinks: links,
      activeAliases: active,
      groupKeys,
      // #111: group boxes are a grid-layout feature only — radially scattered
      // ring nodes can't be cleanly boxed. Ring keeps the #83 prefix hue.
      groupBoxes: [] as { key: string; count: number; x: number; y: number; w: number; h: number }[],
      // ring fits within VIEWBOX_H by construction (offlineRadius=325 + centre at y=330)
      gridContentBottom: 0,
    };
  }, [messages, sessions, sseSessions, layout, nodeScale]);

  const workingCount = onlineNodes.filter(s => s.status === 'working').length;
  // Round 6 / Loop: vendor distribution for the header chip — at a glance
  // "what's in the fleet" (A:5 M:2 O:8 书:12 …) without opening a node.
  // Sorted by count desc; "unknown" vendors collapse into a "?" bucket.
  const vendorDist = useMemo(() => {
    const tally = new Map<string, { initial: string; count: number; color: string }>();
    for (const s of [...onlineNodes, ...offlineNodes]) {
      const v = vendorForModel(s.model);
      const key = v.id === 'unknown' ? '?' : v.initial;
      const cur = tally.get(key);
      if (cur) cur.count++;
      else tally.set(key, { initial: key, count: 1, color: v.mono.text });
    }
    return [...tally.values()].sort((a, b) => b.count - a.count);
  }, [onlineNodes, offlineNodes]);
  // Round 109 (Vincent 4582 P0): hover-gated labels above this node count
  // so dense fleets show clean avatars instead of a wall of overlapping
  // label cards. 16 ≈ where the triple-tier rings start to crowd.
  const denseLayout = onlineNodes.length + offlineNodes.length > 16;
  const [hoveredAlias, setHoveredAlias] = useState<string | null>(null);
  // Round 8 / Loop: which group is currently focused. Nodes outside this
  // group + other group boxes fade so the eye locks onto the team you're
  // pointing at. Singletons use their own alias as the group key.
  const hoveredGroup = hoveredAlias ? (groupKeys[hoveredAlias] ?? hoveredAlias) : null;
  // Round 49 / Loop: reverse-direction of R40's edge-on-node-hover linkage.
  // R48 widened the flow hitbox to 16 px, so edges are precise enough to
  // serve as a state trigger. When the user hovers a flow edge, light up its
  // two endpoint nodes and dim the rest — "who is this edge between" becomes
  // visible without reading the tooltip. The set is the link's two aliases
  // (null when no edge hovered); node opacity composes this after inFocus.
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  // Round 55 / Loop: hovering a legend status row dims nodes whose status
  // doesn't match. The legend was passive — "what does this colour mean".
  // Now it answers "show me all of these" the same way R8 group-focus
  // answers "show me this team". Three values match the legend rows.
  const [hoveredStatus, setHoveredStatus] = useState<'working' | 'idle' | 'offline' | null>(null);
  const hoveredEdgeEndpoints = useMemo<Set<string> | null>(() => {
    if (!hoveredEdgeKey) return null;
    const link = flowLinks.find(l => l.key === hoveredEdgeKey);
    return link ? new Set([link.from, link.to]) : null;
  }, [hoveredEdgeKey, flowLinks]);

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
  // Issue #100: singleton chat popover. One alias at a time — clicking
  // another node swaps the target and the conversation switches in place.
  const [chatAlias, setChatAlias] = useState<string | null>(null);
  // Round 14 / Loop: one-shot click ripple — fades outward from the clicked
  // node so the click registers physically before the popover snaps in.
  // Pairs with the Round 11 chat-focus ring: ripple expands, ring locks on.
  // Keyed by ts so re-clicking the same node remounts the <circle> and the
  // SMIL <animate> replays. Cleared 600ms after click (longer than the
  // 500ms animation so a final frame at opacity 0 is still in the tree).
  const [clickRipple, setClickRipple] = useState<{
    ts: number; x: number; y: number; r0: number; color: string;
  } | null>(null);
  // #84: when a node is renamed while its chat popover is open, follow the
  // rename so the conversation keeps targeting a live alias.
  useEffect(() => {
    if (renameSignal && renameSignal.from === chatAlias) {
      setChatAlias(renameSignal.to);
    }
    // chatAlias intentionally omitted — only react to a new rename signal,
    // not to the user opening/closing the popover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameSignal]);

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

  // Round 28 / Loop: first-paint auto-fit. Round 27's cellH bump means
  // dense grids (≥6-7 rows) overflow the 680-px viewBox at the natural
  // 100% zoom — a new user sees the topology with its bottom rows
  // clipped and no hint that there's more below. Auto-fit on first
  // paint (and only if the user has no persisted view) sets the
  // initial zoom so all content fits. Subsequent zoom changes persist
  // and override the auto-fit on reload; explicit reset (0 key) still
  // goes back to 100% so the gesture's "reset to natural size" semantic
  // is preserved.
  //
  // Capture pre-mount persistence in a useState initializer — the
  // existing `persist` effect (declared below) runs on first render
  // with the default {1,0,0} view and writes it to localStorage before
  // the auto-fit effect (deps on async-arriving sessions) gets a turn.
  // Reading localStorage from the effect would see that write and
  // skip the fit. The useState snapshot fires once, before any effects.
  const [hadPersistedViewOnMount] = useState<boolean>(
    () => typeof window !== 'undefined' && !!localStorage.getItem('anet-topo-view'),
  );
  const autoFitDoneRef = useRef(false);
  useEffect(() => {
    if (autoFitDoneRef.current) return;
    if (hadPersistedViewOnMount) {
      autoFitDoneRef.current = true;
      return;
    }
    if (layout !== 'grid' || sessions.length === 0 || !gridContentBottom) return;
    if (gridContentBottom <= VIEWBOX_H) {
      autoFitDoneRef.current = true; // no overflow → no fit needed
      return;
    }
    const fitZoom = Math.max(ZOOM_MIN, Math.min(1, VIEWBOX_H / gridContentBottom));
    setView({ zoom: fitZoom, x: 0, y: 0 });
    autoFitDoneRef.current = true;
  }, [layout, sessions.length, gridContentBottom, hadPersistedViewOnMount]);

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
      // Round 23 / Loop: only zoom on Ctrl/Meta+wheel when inline; plain
      // wheel over the canvas keeps scrolling the page (the topo sits at
      // the top of /; trapping page scroll mid-page is the classic
      // "scroll-jail" anti-pattern). In fullscreen the canvas owns the
      // viewport so any wheel zooms — no page scroll to preserve. Pinch-
      // zoom on a trackpad surfaces as ctrlKey=true natively, which is
      // also what we want (zoom the canvas, not the browser).
      if (!isFullscreen && !e.ctrlKey && !e.metaKey) return;
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
    // Re-attach when the fullscreen flag toggles so the handler's
    // closure picks up the new value (capture-by-closure means we'd
    // otherwise read the stale boolean forever).
  }, [isFullscreen]);

  // Round 21 / Loop: pan-aware cursor. Static `grab` gave no tactile cue
  // that the canvas was actually being dragged — "grabbing" while
  // dragRef.current.active = true tells the hand it's moving the
  // viewport. Mirroring dragRef.active into state is the only way to
  // re-render the SVG style; the ref itself doesn't trigger renders.
  const [isPanning, setIsPanning] = useState(false);
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
    setIsPanning(true);
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
    setIsPanning(false);
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

  // Round 29 / Loop: `f` = fit-to-content. Shared by the Round 28
  // first-paint auto-fit effect and the keyboard handler so the math is
  // in one place. When content already fits at natural zoom, this is
  // effectively a "recenter" — `f` always lands on a known good view.
  const fitView = useCallback(() => {
    const zoom = !gridContentBottom || gridContentBottom <= VIEWBOX_H
      ? 1
      : Math.max(ZOOM_MIN, Math.min(1, VIEWBOX_H / gridContentBottom));
    setView({ zoom, x: 0, y: 0 });
  }, [gridContentBottom]);

  // Round 22 / Loop: keyboard zoom — +/= zoom in, - zoom out, 0 reset.
  // Round 29 / Loop: +f to fit content.
  // Listen on window so the user doesn't need to focus the SVG first,
  // but only act when no text input has focus (otherwise typing "-" in
  // a chat would zoom the topology — surprising and bad). Modifier keys
  // pass through so Cmd/Ctrl combos still hit their owners. The button
  // titles below document these shortcuts so users discover them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae) {
        const tag = ae.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) return;
      }
      if (e.key === '+' || e.key === '=') { zoomBy(1.2); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { zoomBy(1 / 1.2); e.preventDefault(); }
      else if (e.key === '0') { resetView(); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') { fitView(); e.preventDefault(); }
      // Round 32 / Loop: `l` toggles ring|grid. The vim-style `g l` route
      // (Audit Log) requires a preceding `g` within 1500ms; a bare `l`
      // outside that window is free for topology use.
      else if (e.key === 'l' || e.key === 'L') { toggleLayout(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // zoomBy / resetView are stable wrt setView callback; fitView changes
    // with gridContentBottom so deps list catches it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView]);

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
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Issue #87: ring | grid layout toggle — segmented control,
              persisted to localStorage anet-topo-layout. */}
          <div className="inline-flex rounded-md border border-gray-500/25 overflow-hidden" role="group" aria-label="Topology layout">
            <button
              onClick={() => { if (layout !== 'ring') toggleLayout(); }}
              aria-pressed={layout === 'ring'}
              title="Ring layout (l to toggle)"
              className={`px-2.5 py-1 transition-colors ${layout === 'ring' ? 'bg-cyan-500/15 text-cyan-300' : 'text-gray-500 hover:text-gray-400'}`}
            >
              Ring
            </button>
            <button
              onClick={() => { if (layout !== 'grid') toggleLayout(); }}
              aria-pressed={layout === 'grid'}
              title="Grid layout (l to toggle)"
              className={`px-2.5 py-1 border-l border-gray-500/25 transition-colors ${layout === 'grid' ? 'bg-cyan-500/15 text-cyan-300' : 'text-gray-500 hover:text-gray-400'}`}
            >
              Grid
            </button>
          </div>
          <span className="px-2.5 py-1 rounded-md bg-green-500/10 text-green-300 border border-green-500/20">
            {workingCount} working
          </span>
          <span className="px-2.5 py-1 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
            {onlineNodes.length} online
          </span>
          {/* Round 31 / Loop: fleet-health pressure bar. The "X working /
              Y online" chips already carry the raw counts; the bar lets
              the eye get the working/idle/offline RATIO in one glance
              without mental math. Stacked 3-segment chip, ~64 px wide. */}
          {(() => {
            const w = workingCount;
            const i = onlineNodes.length - workingCount; // idle = online - working
            const o = offlineNodes.length;
            const total = w + i + o;
            if (total === 0) return null;
            const seg = (n: number, color: string, key: string) => {
              if (n === 0) return null;
              return <span key={key} style={{ width: `${(n / total) * 100}%`, background: color, height: '100%' }} />;
            };
            // Round 47 / Loop: hidden on mobile — at <640px the chip row
            // wraps to multiple lines and crowds the topology header;
            // pressure ratio is best read with the working+online raw
            // counts (kept visible) anyway.
            return (
              <span
                className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20 font-mono"
                title={`${w} working · ${i} idle · ${o} offline`}
                data-fleet-pressure
              >
                <span className="text-[10px] tracking-wide">pressure</span>
                <span className="inline-flex h-1.5 w-16 rounded-full overflow-hidden" style={{ background: 'rgb(75 85 99 / 0.25)' }}>
                  {seg(w, isLight ? '#059669' : '#22c55e', 'w')}
                  {seg(i, isLight ? '#0d9488' : '#2dd4bf', 'i')}
                  {seg(o, isLight ? '#94a3b8' : '#6b7280', 'o')}
                </span>
              </span>
            );
          })()}
          {vendorDist.length > 1 && (
            <span
              className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20 font-mono"
              title="Fleet by model vendor"
            >
              {vendorDist.map(v => (
                <span key={v.initial} className="inline-flex items-baseline gap-0.5">
                  <span style={{ color: v.color }}>{v.initial}</span>
                  <span className="text-gray-500">:{v.count}</span>
                </span>
              ))}
            </span>
          )}
          {/* Round 42 / Loop: extend active-links chip with the timestamp
              of the most-recent flow event. Tells the operator at a glance
              whether the topology is currently humming (last 30s) or has
              been quiet for a while — the visual flow particles and
              edge brightness only show that there IS traffic, not when
              the last one was. Reuses Round 38's relativeAgo. */}
          {(() => {
            const recent = flowLinks.reduce<number | null>((acc, l) => {
              if (!l.last_at) return acc;
              const t = parseHubTime(l.last_at);
              if (t === null) return acc;
              return acc === null || t > acc ? t : acc;
            }, null);
            const rel = recent !== null ? relativeAgo(new Date(recent).toISOString()) : null;
            return (
              <span className="hidden sm:inline px-2.5 py-1 rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20">
                {flowLinks.length} active link{flowLinks.length === 1 ? '' : 's'}
                {rel ? <span className="text-gray-500"> · last {rel}</span> : null}
              </span>
            );
          })()}
          <FreshnessChip sessions={sessions} />
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
          // Round 41 / Loop: the reset-button title (R22) and the Help
          // overlay (R25) both advertise "double-click the canvas to
          // reset", but the handler was never actually wired. The text
          // was lying. Wire it here, guarded so dbl-clicking a node
          // (which would also trigger the SVG-level handler via event
          // bubbling) doesn't unexpectedly reset the view on the user.
          onDoubleClick={(e) => {
            const t = e.target as Element | null;
            if (t?.closest('g[data-node]')) return;
            resetView();
          }}
          style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
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
            {/* Round 16 / Loop: 3-tier flow-link arrow markers.
                The single marker had `markerUnits` defaulting to
                `strokeWidth`, so heavy edges (stroke=7) rendered 35-user-
                unit arrowheads — visually dominant, the head outweighed
                the line. Switching to `userSpaceOnUse` decouples arrow
                size from stroke; binning by count gives a clearer
                hierarchy than continuous linear scaling:
                  s (count 1-2) →  12 user units
                  m (count 3-4) →  16 user units  (alias for `topo-arrow`)
                  l (count 5+)  →  22 user units
                `topo-arrow` stays bound to the medium tier so the legend
                swatch (line ~1500) renders without change. */}
            {[
              { id: 'topo-arrow-s', size: 12 },
              { id: 'topo-arrow',   size: 16 },
              { id: 'topo-arrow-l', size: 22 },
            ].map(m => (
              <marker
                key={m.id}
                id={m.id}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth={m.size}
                markerHeight={m.size}
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={pal.arrowFill} />
              </marker>
            ))}
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
          {/* Issue #87: radar/ring ambiance renders only in ring layout —
              grid mode drops it so the concentric rings don't sit behind a
              rectangular grid. */}
          {layout === 'ring' && (<>
          {/* R52: radar bg is pure decoration — drop its pointer events so
              the hub <g> under it (and any future inner-disk affordances)
              can receive clicks. Previously the r=330 disc intercepted
              the hub click outright. */}
          <circle cx={cx} cy={cy} r="330" fill="url(#topo-radar)" style={{ pointerEvents: 'none' }} />

          {/* Round 45: subtle star field — 24 deterministic dots scattered
              across the canvas give the radar bg some depth. Skipped on
              light theme so the white surface stays clean. */}
          {!isLight && (
            <g opacity="0.5" style={{ pointerEvents: 'none' }}>
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
              pointerEvents: 'none',
            }}
            className="anet-topo-sweep"
            opacity={isLight ? 0.7 : 1}
          >
            <path
              d={`M ${cx} ${cy} L ${cx + 330} ${cy} A 330 330 0 0 0 ${cx + 330 * Math.cos(-Math.PI / 4.5)} ${cy + 330 * Math.sin(-Math.PI / 4.5)} Z`}
              fill="url(#topo-sweep)"
            />
          </g>

          {/* radar rings — pure decoration at fixed radii, independent of
              node positions so the radar aesthetic is preserved across tier
              changes. */}
          {[90, 170, 250, 330].map(radius => (
            <circle key={radius} cx={cx} cy={cy} r={radius} fill="none" stroke={pal.ringStroke} strokeWidth="1" opacity={isLight ? 0.6 : 0.35} />
          ))}

          {/* Round 54 / Loop: tier-radius guide rings. The radar rings above
              are decorative and don't match the actual tier radii nodes sit
              on (single 220 / dual 175,260 / triple 145,215,285). Drawing
              a faint dashed ring at each ACTIVE tier radius lets the eye
              anchor "this is the inner / outer ring" without inferring from
              node spacing. Picked based on online node count so only the
              tiers currently in use draw — empty tiers stay quiet. pointer-
              events:none so they never intercept hub or node clicks. The
              0.7 stroke + dashed pattern reads as guide, not feature. */}
          {(
            onlineNodes.length > onlineTripleThreshold
              ? [onlineTripleInnerR, onlineTripleMidR, onlineTripleOuterR]
              : onlineNodes.length > onlineTierThreshold
                ? [onlineInnerRadius, onlineOuterRadius]
                : onlineNodes.length > 0
                  ? [onlineRadius]
                  : []
          ).map(r => (
            <circle
              key={`tier-${r}`}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={pal.ringStroke}
              strokeWidth="0.7"
              strokeDasharray="2 8"
              opacity={isLight ? 0.32 : 0.42}
              style={{ pointerEvents: 'none' }}
              data-tier-ring={r}
            />
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
          </>)}

          {/* hub links — round 46: idle spokes now have animated
              stroke-dashoffset so dashes flow outward from the hub
              ("command relay" feel). Active spokes carrying live message
              flow stay as solid bright strokes. */}
          {layout === 'ring' && onlineNodes.map((session, idx) => {
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

          {/* #111: prefix-group boundary boxes (Vincent 4722). Grid layout
              only — groupBoxes is empty in ring mode. Rendered behind the
              flow links + nodes; pointer-events off so they never intercept
              a node click. Restrained dashed container + group-name label. */}
          {groupBoxes.map(box => {
            const isHovered = hoveredGroup === box.key;
            // Round 18 / Loop: group-box hover linkage. The Round 8 fade
            // already dropped OUT-of-focus groups to 0.28, but the IN-focus
            // group sat at its baseline appearance — no positive emphasis.
            // Hovering now upgrades the box to an "accent" treatment:
            // solid stroke (not dashed), thicker, accent-coloured; brighter
            // text and slightly stronger fill. Label and box read as one
            // selected unit. Geometry unchanged → overlap test untouched.
            return (
              <g
                key={`grp-${box.key}`}
                data-group={box.key}
                className="transition-opacity"
                style={{ pointerEvents: 'none', opacity: !hoveredGroup || isHovered ? 1 : 0.28 }}
              >
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  rx="14"
                  fill={isLight ? '#0f172a' : '#a5b4fc'}
                  fillOpacity={isHovered ? (isLight ? 0.05 : 0.09) : (isLight ? 0.025 : 0.045)}
                  stroke={isHovered ? pal.legendAccent : pal.ringStroke}
                  strokeWidth={isHovered ? 2 : 1.5}
                  strokeDasharray={isHovered ? 'none' : '6 6'}
                  style={{ transition: 'stroke 200ms ease-out, stroke-width 200ms ease-out, fill-opacity 200ms ease-out' }}
                />
                <text
                  x={box.x + 12}
                  y={box.y + 14}
                  fill={isHovered ? pal.legendHeadline : pal.legendText}
                  fontSize="13"
                  fontFamily="monospace"
                  fontWeight="700"
                  style={{ transition: 'fill 200ms ease-out' }}
                >
                  {box.key}
                  {/* Round 19 / Loop: member-count chip. Inline tspan stays
                      in the single <text> bbox the overlap test reads, so
                      the node↔label guard still catches if the chip ever
                      pushes the label far enough right to clip a node.
                      Smaller + lighter weight reads as metadata, not name. */}
                  <tspan dx="6" fill={pal.legendText} fontSize="11" fontWeight="400">· {box.count}</tspan>
                </text>
              </g>
            );
          })}

          {/* directed message flows */}
          {flowLinks.map((link, index) => {
            const from = nodePositions[link.from];
            const to = nodePositions[link.to];
            if (!from || !to) return null;

            // Round 7 / Loop: lift now scales with distance so short links
            // aren't over-bent (long links keep the ~36px hump), and the
            // particle period shortens with link.count so busier edges
            // visibly pulse faster — instant info density on top of the
            // existing stroke-width-by-count chip.
            const dist = Math.hypot(to.x - from.x, to.y - from.y);
            const lift = (index % 2 === 0 ? 1 : -1) * Math.min(36, dist * 0.18);
            const path = curvePath(from, to, lift);
            const width = Math.min(2 + link.count, 7);
            const duration = Math.max(0.9, 2.6 / Math.sqrt(link.count));
            // Round 10 / Loop: freshness fade. An edge that fired ≤30s ago
            // stays at full intensity; over 5 minutes it decays to ~35%.
            // Surfaces "what's happening now" vs background chatter without
            // hiding old flow entirely (some context still useful). `now`
            // captured at useMemo-recompute time (every 5s message refresh)
            // — accuracy is within the poll interval, plenty.
            const ageMs = link.last_at ? Math.max(0, Date.now() - Date.parse(link.last_at)) : 0;
            const fresh = Math.max(0.35, 1 - ageMs / (5 * 60 * 1000));
            // Round 16 arrow-tier binning — keep `topo-arrow` as the
            // medium tier id so the legend swatch picks it up unchanged.
            const arrowId = link.count <= 2 ? 'topo-arrow-s'
                          : link.count <= 4 ? 'topo-arrow'
                          : 'topo-arrow-l';

            // Round 39 / Loop: edge hover tooltip — surface the same
            // last_at + count info the freshness fade and arrow tier
            // already encode visually, in plain text. The stroke is the
            // hover target; SVG `<title>` honours newlines on every
            // browser the dashboard targets.
            const lastAt = relativeAgo(link.last_at);
            const tooltip = `${link.from} → ${link.to}\n${link.count} message${link.count === 1 ? '' : 's'}${lastAt ? ` · last ${lastAt}` : ''}`;
            // Round 40 / Loop: edges follow node hover — when an alias is
            // hovered, every edge touching it brightens, the rest fade.
            // Pairs with the Round 8 group-focus fade on nodes: hover a
            // node to find "who is this agent talking to" at a glance.
            // No hover → multiplier is 1.0 (current behaviour preserved).
            // Round 50 / Loop: edge-on-self priority. When the user hovers
            // a flow edge directly (R48 widened the hitbox so this is now
            // a precise gesture), THAT edge gets the strongest boost (2.0)
            // and every other edge dims to 0.35. Node-hover (R40) keeps
            // its own ladder. Edge-hover and node-hover are mutually
            // exclusive in practice — the cursor is over one or the
            // other — but the order below makes edge-hover win if both
            // ever read truthy at the same React tick.
            // Round 53 / Loop: in-group edges follow team focus. R40
            // brightened only edges touching the exact hovered alias —
            // but with R8/R18 prefix-clustering, a user hovering one
            // member is asking about the team. So when BOTH endpoints of
            // an edge share the hoveredGroup (and neither is the exact
            // hovered alias — that gets the stronger 1.7×), the edge
            // boosts to 1.3×. Edges leaving the team (one endpoint in,
            // one out) still dim to 0.35× per R40 since they read as
            // background to the focus. Singletons fall through unchanged
            // (their group key is the alias itself, so bothInHoveredGroup
            // is impossible for a non-self-edge).
            const isHoveredEdge = hoveredEdgeKey === link.key;
            const fromGroup = groupKeys[link.from] ?? link.from;
            const toGroup = groupKeys[link.to] ?? link.to;
            const bothInHoveredGroup = !!hoveredGroup && fromGroup === hoveredGroup && toGroup === hoveredGroup;
            const edgeOpacityMul = isHoveredEdge
              ? 2.0
              : hoveredEdgeKey
                ? 0.35
                : !hoveredAlias
                  ? 1
                  : (link.from === hoveredAlias || link.to === hoveredAlias)
                    ? 1.7
                    : bothInHoveredGroup
                      ? 1.3
                      : 0.35;
            // Round 50: the hovered edge also visibly thickens so the eye
            // tracks it even at low message counts (width was 3 → 4.5 on
            // hover). 1.4× is enough to read as "lifted" without
            // breaching the 16-px hitbox bound.
            const renderWidth = isHoveredEdge ? Math.min(width * 1.4, 10) : width;
            return (
              <g key={link.key}>
                {/* Round 48 / Loop: invisible hover hitbox — visible flow
                    path is 3-7 px wide and damn hard to hover precisely.
                    Stack a transparent 16-px-wide stroke behind it so the
                    cursor only needs to be ~8 px from the line for the
                    tooltip to fire. Native <title> moves here; the
                    visible path no longer needs it. pointer-events on
                    the visible path drop to "none" since the hitbox
                    owns the hover surface. */}
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(width + 10, 16)}
                  style={{ pointerEvents: 'stroke' }}
                  data-edge-hitbox
                  onMouseEnter={() => setHoveredEdgeKey(link.key)}
                  onMouseLeave={() => setHoveredEdgeKey(prev => prev === link.key ? null : prev)}
                >
                  <title>{tooltip}</title>
                </path>
                <path
                  d={path}
                  fill="none"
                  stroke={pal.flowEdge}
                  strokeWidth={renderWidth}
                  opacity={Math.min(1, (isLight ? 0.22 : 0.28) * fresh * edgeOpacityMul)}
                  filter={isLight ? undefined : 'url(#topo-glow)'}
                  markerEnd={`url(#${arrowId})`}
                  className="transition-opacity duration-300"
                  style={{ pointerEvents: 'none' }}
                />
                <path
                  id={`flow-path-${index}`}
                  d={path}
                  fill="none"
                  stroke={pal.flowPath}
                  strokeWidth="1"
                  strokeDasharray="2 12"
                  opacity={Math.min(1, (isLight ? 0.4 : 0.75) * fresh * edgeOpacityMul)}
                  className="transition-opacity duration-300"
                />
                {!reducedMotion && (
                  <circle r="4" fill={pal.flowParticle} filter={isLight ? undefined : 'url(#topo-glow)'} opacity={Math.min(1, fresh * edgeOpacityMul)}>
                    <animateMotion dur={`${duration}s`} repeatCount="indefinite" path={path} />
                  </circle>
                )}
              </g>
            );
          })}

          {/* center hub — round 39 sized + round 13 restraint.
              The hub is the control-plane anchor. r39 gave it two outward
              pulses (r 10→38, 2.4s, double-phase) which read as "loudest
              node in the room" — wrong semantics: anchors don't emit,
              they hold. r13 swaps the kinetic pulse for a slow opacity
              breath on the static halo (4s, ±15% from base), so the hub
              stays alive without throwing kinetic energy outward. The
              dual-circle "lit lamp" core is unchanged. */}
          {layout === 'ring' && (<g
            data-topo-hub
            style={{ cursor: 'pointer' }}
            // Stop pointerdown from reaching the SVG pan handler — same
            // reason as the node <g>: a captured pointer makes Chromium
            // fire the follow-up click on the SVG, not this group.
            onPointerDown={(e) => e.stopPropagation()}
            // Round 52 / Loop: hub is the visual anchor but had no click
            // action — users discovered fit-to-content only via the `f`
            // key or the chrome button. Wire the hub to fitView() so the
            // most prominent element in the canvas is also the "re-
            // center" affordance. A click-ripple keyed by ts confirms
            // the gesture; the hub <title> now ends with a hint.
            onClick={() => {
              fitView();
              setClickRipple({ ts: Date.now(), x: cx, y: cy, r0: 18, color: isLight ? '#059669' : '#10b981' });
              setTimeout(() => setClickRipple(prev => prev && prev.x === cx && prev.y === cy ? null : prev), 600);
            }}
          >
            {/* Round 43 / Loop: hub `<title>` summary — hovering the
                central glow now answers "what is this?" with a one-line
                fleet snapshot. Duplicates the header chips by design;
                hovering the most visually prominent element is the
                most natural impulse, so satisfy it where the cursor
                already is. Falls clean: omits sub-clauses when their
                counts are zero. R52 appends a "click to fit view" hint.
                */}
            <title>{(() => {
              const total = sessions.length;
              const parts = [`Network hub`, `${total} session${total === 1 ? '' : 's'}`];
              if (onlineNodes.length > 0) parts.push(`${onlineNodes.length} online`);
              if (workingCount > 0) parts.push(`${workingCount} working`);
              if (flowLinks.length > 0) parts.push(`${flowLinks.length} active link${flowLinks.length === 1 ? '' : 's'}`);
              return parts.join(' · ') + '\nclick to fit view';
            })()}</title>
            {/* grounding halo — now breathes in opacity, no expansion */}
            <circle
              cx={cx} cy={cy} r="18"
              fill={isLight ? '#d1fae5' : '#10b981'}
              opacity={isLight ? 0.42 : 0.12}
            >
              {!reducedMotion && (
                <animate
                  attributeName="opacity"
                  values={isLight ? '0.32;0.52;0.32' : '0.08;0.16;0.08'}
                  dur="4s"
                  repeatCount="indefinite"
                />
              )}
            </circle>
            {/* core — 20px diameter, larger inner highlight reads as a "lit lamp" */}
            <circle cx={cx} cy={cy} r="10" fill={isLight ? '#059669' : '#10b981'} />
            <circle cx={cx} cy={cy} r="5" fill="#d1fae5" opacity="0.9" />
          </g>)}

          {/* agent nodes */}
          {[...onlineNodes, ...offlineNodes].map((session, nodeIdx) => {
            const pos = nodePositions[session.alias];
            if (!pos) return null;

            const sseCountFor = (session.network_id ? sseSessions[`${session.network_id}:${session.alias}`] : undefined) ?? sseSessions[session.alias];
            const isOnline = session.status !== 'offline' || !!sseCountFor;
            const status = nodeStatus(session, isOnline, isLight);
            const isActive = activeAliases.has(session.alias);
            // #113: node size scales with the S/M/L control; halos, labels,
            // badge and avatar all derive from `radius` so they follow.
            const radius = Math.round((isOnline ? 26 : 18) * nodeScale);
            // Round 109/110 (Vincent 4582 + 4583 P0): at high node counts
            // the 100px opaque label cards overlapped each other and
            // covered neighbouring avatars. But hiding text entirely went
            // too far ("还是得有文字"). So: below the density threshold the
            // full name+status card shows always; above it each node shows
            // a lightweight plain-text alias (no opaque card → can't
            // occlude an avatar), and the full card appears only for the
            // hovered node or once zoomed in past 1.4×.
            const showFullLabel = !denseLayout || hoveredAlias === session.alias || view.zoom >= 1.4;
            // Round 8: when a node in another group is hovered, fade this
            // one. Same-group nodes (incl. singletons matching the hovered
            // alias) stay full. Pure visual focus, geometry unchanged.
            const inFocus = !hoveredGroup || (groupKeys[session.alias] ?? session.alias) === hoveredGroup;

            return (
              <g
                key={session.alias}
                data-node={session.alias}
                // Round 3 / Loop: `anet-fade-in` runs once when the <g>
                // mounts — a new session entering the fleet (or the topology
                // first rendering) eases in instead of popping. Re-renders of
                // an existing node don't re-trigger (React preserves the <g>
                // via the alias key), so status changes don't flicker. The
                // global prefers-reduced-motion sweep already neutralises it.
                className="group transition-opacity anet-fade-in"
                style={{
                  cursor: 'pointer',
                  // Round 17 / Loop: offline nodes drop to 0.6 at rest so
                  // online nodes pop without losing the offline-as-ghost
                  // information. The dashed stroke + smaller radius already
                  // say "offline"; dimming the whole group strengthens the
                  // online-vs-offline hierarchy at first glance. Exempt the
                  // chat-focused node — if the user explicitly opened a
                  // popover targeting an offline alias, that node stays
                  // full-brightness so the focus ring + popover read as one
                  // selected thing rather than a dimmed selection. Group-
                  // hover fade (Round 8) still wins when inFocus is false.
                  // Round 49 / Loop: edge-hover endpoint highlight composes
                  // OVER the inFocus/online formula — a non-endpoint node
                  // dims to 0.28 (just below the inFocus 0.32 to read as a
                  // stronger "not relevant" signal), endpoints keep their
                  // base opacity. chatAlias still wins to keep the focus
                  // ring legible if the user clicked through.
                  // Round 55 / Loop: legend-status hover composes on the
                  // SAME level as edge-hover-endpoint. Non-matching nodes
                  // dim to 0.28; matching nodes stay at their base.
                  // hoveredStatus matches: working = status==='working',
                  // idle = online but not working, offline = !isOnline.
                  opacity: hoveredEdgeEndpoints && !hoveredEdgeEndpoints.has(session.alias) && chatAlias !== session.alias
                    ? 0.28
                    : hoveredStatus && chatAlias !== session.alias && !(
                        hoveredStatus === 'working' ? session.status === 'working'
                        : hoveredStatus === 'idle'  ? (isOnline && session.status !== 'working')
                        : /* offline */               !isOnline
                      )
                      ? 0.28
                      : !inFocus
                        ? 0.32
                        : chatAlias === session.alias
                          ? 1
                          : isOnline ? 1 : 0.6,
                  // Round 9 / Loop: stagger the anet-fade-in so the topology
                  // reveals as a wave on first paint instead of one big pop.
                  // Cap at 24 indices (≈600ms tail) so 50-node fleets still
                  // finish revealing within a beat. CSS animation-delay only
                  // applies during the keyframe — re-renders without a new
                  // mount (same alias key) don't replay, so status changes
                  // never trigger the stagger again.
                  animationDelay: `${Math.min(nodeIdx, 24) * 25}ms`,
                  // Round 51 / Loop: hover micro-lift. The label already
                  // lifts on group-hover (R26). The node body — circle,
                  // avatar, status ring — stays planted, so the gesture
                  // reads "label moves, body doesn't". Now the whole <g>
                  // translates -2px when hovered: avatar + ring + label
                  // move as one unit. 2 px is well inside the inter-row
                  // gap (cellH headroom ≥22), and CSS transform on SVG
                  // <g> never affects the overlap-test geometry (the
                  // test never simulates hover). useReducedMotion drops
                  // the lift to 0 for prefers-reduced-motion users.
                  transform: !reducedMotion && hoveredAlias === session.alias ? 'translateY(-2px)' : undefined,
                  transition: 'transform 180ms cubic-bezier(0.4,0,0.2,1)',
                }}
                // Stop the pointerdown from reaching the SVG pan handler: the
                // SVG calls setPointerCapture, and a captured pointer makes
                // Chromium fire the follow-up `click` on the SVG instead of
                // this node — so without this the node's onClick never runs.
                // Side effect (intended): you pan from empty canvas, not by
                // grabbing a node.
                onPointerDown={(e) => e.stopPropagation()}
                // Track hover globally (not just under denseLayout) so the
                // Round 8 group-focus fade works at any fleet size.
                onPointerEnter={() => setHoveredAlias(session.alias)}
                onPointerLeave={() => setHoveredAlias(prev => (prev === session.alias ? null : prev))}
                onClick={() => {
                  setChatAlias(session.alias);
                  // Round 14 ripple — capture position, radius and status
                  // colour at click time so the one-shot circle is self-
                  // contained (no re-render-time recomputation needed).
                  setClickRipple({
                    ts: Date.now(),
                    x: pos.x, y: pos.y, r0: radius,
                    color: status.primary,
                  });
                  setTimeout(() => setClickRipple(prev =>
                    prev && Date.now() - prev.ts >= 590 ? null : prev), 600);
                }}
              >
                {/* Issue #96: native hover tooltip — "Vendor · model · Runtime".
                    Falls back to just the alias when the node reports no
                    model/runtime.
                    Round 33 / Loop: cwd line answers "what is this agent on?".
                    Round 34 / Loop: for offline nodes, append "last seen: 6m ago"
                    so the operator knows whether to wait or chase. Online nodes
                    skip the line (Round 27's 1 h ghost age-out means anything
                    still online has heartbeated recently — the line would just
                    be noise). Accepts both ISO ("…T06:00:28Z") and SQL-style
                    ("… 06:00:28" assumed UTC) formats. */}
                {(() => {
                  // Round 35 / Loop: TZ-safe parsing via the shared lib helper
                  // — same parseHubTime is used by isGhost above (Round 38
                  // factored it to app/lib/time.ts so both paths interpret SQL
                  // bare timestamps as UTC on every browser).
                  const lastSeen = !isOnline && session.last_seen_at ? relativeAgo(session.last_seen_at) : null;
                  return (
                    <title>{[
                      identityLine(session.model, session.runtime) || session.alias,
                      session.project_dir ? `cwd: ${session.project_dir}` : null,
                      lastSeen ? `last seen: ${lastSeen}` : null,
                    ].filter(Boolean).join('\n')}</title>
                  );
                })()}
                {/* Round 2 / Loop: hover ring — a thin outer stroke that fades
                    in when the cursor enters the node, signalling clickability
                    (real-user feedback for the chat-popover open). Pure CSS via
                    Tailwind group-hover, so it costs nothing per frame and
                    respects prefers-reduced-motion via the global media query. */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius + 12}
                  fill="none"
                  stroke={status.primary}
                  // strokeWidth must NOT be 1.5 (offline status ring) or 3
                  // (online status ring) — the overlap test selects by those
                  // exact widths and would mis-count this invisible hover
                  // ring as a node footprint.
                  strokeWidth="2"
                  className="opacity-0 group-hover:opacity-70 transition-opacity duration-150"
                  style={{ pointerEvents: 'none' }}
                />
                {/* Round 11 / Loop: chat-focus ring — when the ChatPopover is
                    open targeting this node, anchor a persistent ring around
                    it so the floating popover visibly links back to its source
                    node. Static (not pulsing) so it reads as "selected state"
                    rather than "this node is active". strokeWidth=2.5 stays
                    clear of the overlap-test selectors (1.5 / 3). Sits just
                    outside the halo radius+8 so it never overlaps a neighbour
                    (halos already pack flush in dense grids). */}
                {chatAlias === session.alias && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={radius + 14}
                    fill="none"
                    stroke={status.primary}
                    strokeWidth="2.5"
                    opacity={isLight ? 0.85 : 0.95}
                    filter={!isLight ? 'url(#topo-glow)' : undefined}
                    className="transition-opacity duration-200"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {isActive && !reducedMotion && (
                  <circle cx={pos.x} cy={pos.y} r={radius + 14} fill={status.primary} opacity={isLight ? 0.08 : 0.12}>
                    <animate attributeName="r" values={`${radius + 8};${radius + 22};${radius + 8}`} dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values={isLight ? '0.12;0.02;0.12' : '0.18;0.04;0.18'} dur="2.4s" repeatCount="indefinite" />
                  </circle>
                )}
                {/* Round 4 / Loop: transition-[fill,stroke,opacity] smooths
                    status colour changes so idle↔working↔offline doesn't snap
                    — task replies / node-rename / SSE updates ease in. */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius + 8}
                  fill={status.halo}
                  opacity={isOnline ? (isLight ? 0.85 : 0.65) : (isLight ? 0.4 : 0.25)}
                  className="transition-[fill,opacity] duration-300 ease-out"
                />
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius}
                  fill={isOnline ? pal.nodeFill.online : pal.nodeFill.offline}
                  stroke={status.primary}
                  strokeWidth={isOnline ? 3 : 1.5}
                  strokeDasharray={isOnline ? 'none' : '5 5'}
                  filter={isOnline && !isLight ? 'url(#topo-glow)' : undefined}
                  className="transition-[fill,stroke] duration-300 ease-out"
                />
                {/* Issue #96: node "avatar" is now driven by the model
                    vendor. Decision order:
                      1. ?brand=intern flag, or an intern-aliased node with
                         no model field → 书生 coin (preserves #79).
                      2. vendor has a packaged logo asset → that logo image
                         (intern-s1-* models land here via vendorForModel).
                      3. known vendor, logo asset not shipped yet → a
                         vendor-tinted monogram (spec-mandated fallback).
                      4. unknown vendor / null model → the prefix-group
                         hue-hashed initial (#83/#99 behaviour, unchanged). */}
                {(() => {
                  const ar = Math.round((isOnline ? 14 : 10) * nodeScale);
                  const size = radius * 2;
                  const vendor = vendorForModel(session.model);
                  const internByAlias = /书生|书小生|intern/i.test(session.alias);

                  if (isIntern || internByAlias || vendor.logo) {
                    return (
                      <image
                        href={vendor.logo ?? '/intern_avatar.png'}
                        x={pos.x - size / 2}
                        y={pos.y - size / 2}
                        width={size}
                        height={size}
                        preserveAspectRatio="xMidYMid meet"
                      />
                    );
                  }
                  if (vendor.id !== 'unknown') {
                    // Known model house, logo asset not in public/vendors/
                    // yet — vendor-tinted monogram stands in.
                    return (
                      <>
                        <circle cx={pos.x} cy={pos.y} r={ar} fill={vendor.mono.bg} stroke={vendor.mono.ring} strokeWidth="1" />
                        <text
                          x={pos.x} y={pos.y} dy="0.34em" textAnchor="middle"
                          fill={vendor.mono.text} fontSize={ar}
                          fontFamily="monospace" fontWeight="700"
                        >
                          {vendor.initial}
                        </text>
                      </>
                    );
                  }
                  // Round 106 (issue #83): hue keyed to the prefix group,
                  // not the full alias — every 通信* node shares one color.
                  const c = aliasAvatarColors(groupKeys[session.alias] || session.alias);
                  return (
                    <>
                      <circle cx={pos.x} cy={pos.y} r={ar} fill={c.bg} stroke={c.ring} strokeWidth="1" />
                      <text
                        x={pos.x}
                        y={pos.y}
                        dy="0.34em"
                        textAnchor="middle"
                        fill={c.text}
                        fontSize={ar}
                        fontFamily="monospace"
                        fontWeight="700"
                      >
                        {aliasInitial(session.alias)}
                      </text>
                    </>
                  );
                })()}
                {/* Issue #96: runtime badge — small corner glyph marking the
                    execution shell (CLI / SDK / HTTP API). Sits bottom-right
                    of the avatar; colours kept off the working/idle/offline
                    status hues. Absent when the node reports no runtime. */}
                {(() => {
                  const rt = runtimeIdentity(session.runtime);
                  if (!rt) return null;
                  const br = isOnline ? 7 : 5.5;
                  const bx = pos.x + radius * 0.72;
                  const by = pos.y + radius * 0.72;
                  const icon = br * 2 * 0.62;
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      <circle cx={bx} cy={by} r={br} fill={pal.containerBg} stroke={rt.color} strokeWidth="1.5" />
                      <g transform={`translate(${bx - icon / 2} ${by - icon / 2}) scale(${icon / 24})`}>
                        <path d={rt.iconPath} fill="none" stroke={rt.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    </g>
                  );
                })()}
                {session.status === 'working' && (() => {
                  // Round 24 / Loop: pulse rate ↔ traffic. The dot's dur
                  // was a flat 1.1s — every working node looked equally
                  // busy. Mapping it to sse:N lets the eye land on what's
                  // actually hot. 3 discrete tiers read cleaner than
                  // continuous easing at a glance; thresholds picked so
                  // typical 1-2-SSE Claude/Codex sessions stay in the
                  // "active" tier and only multi-pane orchestrators pop
                  // into the "busy" tier. Geometry unchanged (r=2.5).
                  const sse = sseCountFor ?? 0;
                  const dur = sse >= 4 ? '0.7s' : sse >= 2 ? '0.9s' : '1.2s';
                  return (
                    <circle cx={pos.x} cy={pos.y - (radius - 6)} r="2.5" fill={pal.flowParticle} data-pulse-dur={dur} opacity={reducedMotion ? 0.6 : undefined}>
                      {!reducedMotion && (
                        <animate attributeName="opacity" values="1;0.25;1" dur={dur} repeatCount="indefinite" />
                      )}
                    </circle>
                  );
                })()}

                {/* Round 98 (issue #61): label rect 124px → 100px.
                    Round 109/110 (Vincent P0): full opaque card below the
                    density threshold / on hover / when zoomed; otherwise a
                    lightweight plain-text alias that keeps every node
                    labelled without an opaque box covering its neighbours.
                    Round 15 / Loop: when nodeScale=S the node shrinks 30%
                    but the label card was staying full-size, so the label
                    visually outweighed the small node. Tighten the card
                    frame, alias / sub fontSize, drop-offset and truncate
                    length specifically for S; M and L keep their existing
                    sizes (M ≈ L for labels by design — the S user is the
                    one who explicitly asked for a denser view). */}
                {(() => {
                  const isSmall = nodeScale < 0.8;
                  const cardW = isSmall ? 88 : 100;
                  const cardH = isSmall ? 36 : 42;
                  const cardTopY = isSmall ? -12 : -14;
                  const aliasFs = isSmall ? 11 : 12;
                  const subFs = isSmall ? 8 : 9;
                  const subY = isSmall ? 15 : 17;
                  const dropY = isSmall ? 18 : 22;
                  const fullMax = isSmall ? 11 : 12;
                  const denseFs = isSmall ? 9 : 10;
                  const denseDrop = isSmall ? 12 : 14;
                  // Round 26 / Loop: micro-lift the label group on hover —
                  // 1.5 px upward, 200 ms ease. Pairs with the Round 18
                  // group-box hover-accent treatment to give the same
                  // "this is the focused element" feedback at the per-
                  // node level. CSS transform stacks onto the SVG
                  // positioning transform attribute (SVG 2 cascade);
                  // bbox is unchanged at rest, so the overlap-test gate
                  // continues to see the geometric layout it expects.
                  return showFullLabel ? (
                    <g transform={`translate(${pos.x}, ${pos.y + radius + dropY})`} style={{ pointerEvents: 'none' }}
                       className="transition-transform duration-200 group-hover:-translate-y-[1.5px]">
                      <rect x={-cardW / 2} y={cardTopY} width={cardW} height={cardH} rx="6" fill={pal.labelBox.fill} stroke={pal.labelBox.stroke} opacity={isLight ? 1 : 0.94} />
                      <text x="0" y="1" textAnchor="middle" fill={status.text} fontSize={aliasFs} fontFamily="monospace" fontWeight="700">
                        {truncate(session.alias, fullMax)}
                      </text>
                      <text x="0" y={subY} textAnchor="middle" fill={status.primary} fontSize={subFs} fontFamily="monospace">
                        {status.label}{isOnline && sseCountFor != null ? ` sse:${sseCountFor}` : ''}
                      </text>
                    </g>
                  ) : (
                    <text
                      x={pos.x}
                      y={pos.y + radius + denseDrop}
                      textAnchor="middle"
                      fill={status.text}
                      fontSize={denseFs}
                      fontFamily="monospace"
                      fontWeight="700"
                      opacity={0.9}
                      className="transition-transform duration-200 group-hover:-translate-y-[1.5px]"
                      style={{ pointerEvents: 'none', paintOrder: 'stroke' }}
                      stroke={pal.containerBg}
                      strokeWidth="3"
                    >
                      {truncate(session.alias, isSmall ? 9 : 10)}
                    </text>
                  );
                })()}
              </g>
            );
          })}

          {/* Round 14 / Loop: click ripple — one-shot expanding ring from
              the clicked node, ~500ms, status-coloured. Sits inside the
              zoom/pan <g> so it scales / pans with the topology. Keyed by
              ts so a re-click on any node (same or different) remounts the
              <circle> and the SMIL <animate> elements replay from t=0.
              strokeWidth=2 doesn't match the overlap-test selectors. */}
          {clickRipple && !reducedMotion && (
            <circle
              key={clickRipple.ts}
              cx={clickRipple.x}
              cy={clickRipple.y}
              r={clickRipple.r0 + 4}
              fill="none"
              stroke={clickRipple.color}
              strokeWidth="2"
              opacity="0"
              style={{ pointerEvents: 'none' }}
            >
              <animate attributeName="r" values={`${clickRipple.r0 + 4};${clickRipple.r0 + 30}`} dur="0.5s" fill="freeze" />
              <animate attributeName="opacity" values="0.7;0" dur="0.5s" fill="freeze" />
            </circle>
          )}

          </g>

          {/* #112: overlay panels (recent-signal + legend) render OUTSIDE the
              zoom/pan <g> so they stay fixed while the topology pans/zooms.
              They're sized + tucked into the top corners so every corner of
              each panel is >325px from the canvas centre — i.e. fully outside
              the outermost (offline) ring. No node on any ring can reach the
              corner triangles, so the panels never overlap a node, in ring
              OR grid layout (Vincent 4727 zero-overlap criterion). */}
          {/* latest flow labels */}
          {/* Round 57 / Loop: drop-shadow on the panel rects gives them
              card-like elevation, especially on light theme where the
              near-white fill on a near-white canvas read as pasted-on.
              data-topo-panel-elevation tag so the test can verify both
              panels carry the filter. The filter is on the rect, not
              the parent <g>, so it doesn't shadow the rows + text inside
              — only the panel chrome lifts. */}
          <g transform="translate(16, 16)">
            <rect
              x="0" y="0" width="230" height="84" rx="10"
              fill={pal.legendBox.fill}
              stroke={pal.legendBox.stroke}
              opacity={isLight ? 0.97 : 0.92}
              style={{ filter: isLight ? 'drop-shadow(0 2px 6px rgba(15,23,42,0.08))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))' }}
              data-topo-panel-elevation="recent"
            />
            <text x="13" y="21" fill={pal.legendHeadline} fontSize="12" fontFamily="monospace" fontWeight="700">recent signal</text>
            <text x="150" y="21" fill={pal.legendAccent} fontSize="10" fontFamily="monospace">{messages.length} msgs</text>
            {/* Round 45 / Loop: empty state. The panel used to render
                "recent signal" + "0 msgs" with three blank slots below
                when no flow yet — read as "broken" rather than "quiet".
                A muted centred placeholder makes the empty state
                deliberate. Messages count CAN diverge from flowLinks
                count (raw count vs. deduped pairs), so the placeholder
                fires on flowLinks.length=0 specifically. */}
            {flowLinks.length === 0 ? (
              <text x="115" y="60" textAnchor="middle" fill={pal.legendText} fontSize="10" fontFamily="monospace" fontStyle="italic" opacity={0.65} data-recent-signal-empty>
                no flow yet
              </text>
            ) : (
              // Round 56 / Loop: each row is a navigator into the canvas.
              // Hover a row → set hoveredEdgeKey, which the existing R50
              // edge-focus + R49 endpoint-highlight ladders consume. The
              // matching flow edge brightens to 2× + thickens, its two
              // endpoint nodes stay full opacity, and every other edge +
              // non-endpoint node dims. Released → all restore. Wrapping
              // <g> + a transparent 218×14 hitbox so the cursor doesn't
              // have to land precisely on the truncated text.
              flowLinks.slice(0, 3).map((link, index) => (
                <g
                  key={link.key}
                  data-recent-row={link.key}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdgeKey(link.key)}
                  onMouseLeave={() => setHoveredEdgeKey(prev => prev === link.key ? null : prev)}
                >
                  <rect x="6" y={38 + index * 16 - 10} width="218" height="14" fill="transparent" />
                  <text
                    x="13" y={38 + index * 16}
                    fill={hoveredEdgeKey === link.key ? pal.legendHeadline : pal.legendText}
                    fontSize="9"
                    fontFamily="monospace"
                    style={{ transition: 'fill 150ms ease-out' }}
                  >
                    {truncate(link.from, 6)} {'->'} {truncate(link.to, 6)} / {link.count} / {truncate(link.content, 12)}
                  </text>
                </g>
              ))
            )}
          </g>

          {/* legend — Round 55 / Loop: each status row is now a hover
              target. Pointer enter sets `hoveredStatus`; pointer leave
              clears it. Node opacity formula composes the match below.
              The row text brightens to legendHeadline while hovered as
              a small affordance hint. Geometry unchanged — the new
              <g> wrappers only carry pointer handlers. */}
          <g transform="translate(760, 16)">
            {/* R57: matching drop-shadow elevation to the legend panel. */}
            <rect
              x="0" y="0" width="224" height="96" rx="10"
              fill={pal.legendBox.fill}
              stroke={pal.legendBox.stroke}
              opacity={isLight ? 0.97 : 0.92}
              style={{ filter: isLight ? 'drop-shadow(0 2px 6px rgba(15,23,42,0.08))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))' }}
              data-topo-panel-elevation="legend"
            />
            {([
              { key: 'working' as const, y0: 24, y1: 28, fill: isLight ? '#059669' : '#22c55e', label: 'working node' },
              { key: 'idle'    as const, y0: 48, y1: 52, fill: isLight ? '#0d9488' : '#2dd4bf', label: 'online idle' },
              { key: 'offline' as const, y0: 72, y1: 76, fill: isLight ? '#94a3b8' : '#6b7280', label: 'offline / no SSE' },
            ]).map(row => (
              <g
                key={row.key}
                data-legend-status={row.key}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredStatus(row.key)}
                onMouseLeave={() => setHoveredStatus(prev => prev === row.key ? null : prev)}
              >
                {/* invisible hitbox covers the row so cursor doesn't need
                    to be exactly on the 5-px swatch */}
                <rect x="6" y={row.y0 - 12} width="170" height="22" fill="transparent" />
                <circle cx="16" cy={row.y0} r="5.5" fill={row.fill} />
                <text
                  x="30" y={row.y1}
                  fill={hoveredStatus === row.key ? pal.legendHeadline : pal.legendText}
                  fontSize="11"
                  fontFamily="monospace"
                  style={{ transition: 'fill 150ms ease-out' }}
                >{row.label}</text>
              </g>
            ))}
            {/* Flow-arrow swatch sits at y=72 — same row as the offline
                hitbox. Drop its pointerEvents so the offline legend row
                stays hoverable (R55). It's decoration, no need to
                receive events. */}
            <path d="M140,72 Q164,48 196,72" fill="none" stroke={pal.flowEdge} strokeWidth="3" markerEnd="url(#topo-arrow)" style={{ pointerEvents: 'none' }} />
          </g>
        </svg>

        {/* Round 30 / Loop: minimap. Big fleets in fullscreen mode at high
            zoom let users lose their position — the minimap shows the
            whole topology miniaturised plus a viewport rectangle so the
            user always knows where they are. Click anywhere to recenter
            the canvas there. Only mounted when the view is non-default
            (zoomed or panned) since at 1× centered the minimap and the
            canvas show the same thing. HTML overlay so it stays fixed
            while the SVG transforms. */}
        {(() => {
          const isDefaultView = Math.abs(view.zoom - 1) < 0.01 && Math.abs(view.x) < 1 && Math.abs(view.y) < 1;
          if (isDefaultView || (onlineNodes.length + offlineNodes.length) === 0) return null;
          const MW = 120, MH = 82;
          const sx = MW / VIEWBOX_W, sy = MH / VIEWBOX_H;
          const rectX = (-view.x / view.zoom) * sx;
          const rectY = (-view.y / view.zoom) * sy;
          const rectW = (VIEWBOX_W / view.zoom) * sx;
          const rectH = (VIEWBOX_H / view.zoom) * sy;
          return (
            <div
              className="absolute right-3 rounded-md border shadow-lg shadow-black/30 overflow-hidden anet-fade-in"
              style={{ bottom: 56, background: pal.legendBox.fill, borderColor: pal.containerBorder, cursor: 'crosshair' }}
              role="img"
              aria-label="Topology minimap — click to recenter"
              title="Minimap · click to recenter"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const fx = (e.clientX - r.left) / r.width;
                const fy = (e.clientY - r.top) / r.height;
                setView(prev => ({
                  ...prev,
                  x: VIEWBOX_W / 2 - fx * VIEWBOX_W * prev.zoom,
                  y: VIEWBOX_H / 2 - fy * VIEWBOX_H * prev.zoom,
                }));
              }}
              data-topo-minimap
            >
              <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`} style={{ display: 'block' }}>
                {[...onlineNodes, ...offlineNodes].map(s => {
                  const p = nodePositions[s.alias];
                  if (!p) return null;
                  const sseN = (s.network_id ? sseSessions[`${s.network_id}:${s.alias}`] : undefined) ?? sseSessions[s.alias];
                  const isOn = s.status !== 'offline' || !!sseN;
                  const st = nodeStatus(s, isOn, isLight);
                  return <circle key={s.alias} cx={p.x * sx} cy={p.y * sy} r={isOn ? 1.7 : 1.2} fill={st.primary} opacity={isOn ? 0.9 : 0.5} />;
                })}
                {/* viewport rectangle */}
                <rect
                  x={Math.max(0, rectX)} y={Math.max(0, rectY)}
                  width={Math.max(0, Math.min(MW - Math.max(0, rectX), rectW))}
                  height={Math.max(0, Math.min(MH - Math.max(0, rectY), rectH))}
                  fill="none" stroke={pal.legendAccent} strokeWidth="1" opacity="0.9"
                />
              </svg>
            </div>
          );
        })()}
        {/* Round 103 (issue #81): zoom / pan / fullscreen controls — HTML
            overlay so they stay fixed while the SVG content transforms.
            Round 104: Vincent 实测 — the reset action used to be hidden
            behind the "%" label (looked like an indicator, not a button).
            Split into a plain % readout + an explicit reset button with
            its own icon + tooltip. */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 text-xs select-none">
          {/* #113: node size — S / M / L segmented control (Vincent 4727). */}
          <div
            className="flex items-center rounded-md border overflow-hidden"
            style={{ background: pal.legendBox.fill, borderColor: pal.containerBorder }}
            role="group"
            aria-label="Node size"
          >
            {([['S', 0.7], ['M', 0.84], ['L', 1]] as const).map(([lbl, v], idx) => (
              <button
                key={lbl}
                onClick={() => pickNodeScale(v)}
                aria-pressed={nodeScale === v}
                title={`Node size: ${lbl === 'S' ? 'small' : lbl === 'M' ? 'medium' : 'large'}`}
                className={`px-2 py-1 transition-colors ${idx > 0 ? 'border-l' : ''} ${nodeScale === v ? 'bg-cyan-500/15 text-cyan-300' : 'hover:bg-white/5'}`}
                style={{ color: nodeScale === v ? undefined : pal.legendText, borderColor: pal.containerBorder }}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div
            className="flex items-center rounded-md border overflow-hidden"
            style={{ background: pal.legendBox.fill, borderColor: pal.containerBorder }}
          >
            <button
              onClick={() => zoomBy(1 / 1.2)}
              className="px-2 py-1 hover:bg-white/5 transition-colors"
              style={{ color: pal.legendText }}
              aria-label="Zoom out"
              title="Zoom out (−)"
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
              title="Zoom in (+)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <button
            onClick={resetView}
            className="p-1.5 rounded-md border hover:bg-white/5 transition-colors"
            style={{ background: pal.legendBox.fill, borderColor: pal.containerBorder, color: pal.legendText }}
            aria-label="Reset view"
            title="Reset zoom + pan (0, or double-click the canvas)"
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

        {/* Issue #100/#106: draggable, resizable singleton chat popover.
            position:fixed so it floats above the page (overflow-hidden here
            doesn't clip fixed children). Rendered *inside* the container so
            that when the graph goes fullscreen (#81) the popover joins the
            fullscreen subtree and stays visible — a sibling render would be
            outside the fullscreened element and disappear. */}
        {chatAlias && (
          <ChatPopover alias={chatAlias} onClose={() => setChatAlias(null)} />
        )}
      </div>
    </section>
  );
}
