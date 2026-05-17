'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { Session } from './types';
import { aliasAvatarColors, aliasInitial } from './AliasAvatar';
import { ChatPopover } from './ChatPopover';
import { vendorForModel, runtimeIdentity, identityLine } from '../lib/vendorIdentity';
import { parseHubTime, relativeAgo } from '../lib/time';
import { DASHBOARD_VERSION } from '../lib/version';

/** v0.10.0 Hero 1+2 / §3.F server-health hook — fetches the normalized
 *  /api/hub/servers payload (preview.370 unblocked real-data via the
 *  proxy schema-normalize layer) and exposes a per-hostname health
 *  tier. red → worst-of-CPU/Mem/Disk ≥ 85%; amber → 60-85%; green
 *  → < 60%; null when telemetry hasn't shipped yet OR the host is
 *  offline.
 *
 *  Shared with ServersDrawer via SWR's key-based dedup — both
 *  consumers point at /api/hub/servers so the cache layer fans out
 *  to a single fetch per refresh interval.
 */
interface ServerHealthRow {
  hostname: string;
  cpu_load_1min: number | null;
  cpu_cores: number;
  mem_used_gb: number | null;
  mem_total_gb: number | null;
  disk_used_gb: number | null;
  disk_total_gb: number | null;
  status: 'online' | 'offline';
}
type ServerTier = 'red' | 'amber' | 'green';
function classifyServer(s: ServerHealthRow): ServerTier | null {
  if (s.status === 'offline') return null;
  const cpuPct = s.cpu_load_1min != null && s.cpu_cores > 0 ? (s.cpu_load_1min / s.cpu_cores) * 100 : null;
  const memPct = s.mem_used_gb != null && s.mem_total_gb != null && s.mem_total_gb > 0 ? (s.mem_used_gb / s.mem_total_gb) * 100 : null;
  const diskPct = s.disk_used_gb != null && s.disk_total_gb != null && s.disk_total_gb > 0 ? (s.disk_used_gb / s.disk_total_gb) * 100 : null;
  const vals = [cpuPct, memPct, diskPct].filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return null;
  const worst = Math.max(...vals);
  if (worst >= 85) return 'red';
  if (worst >= 60) return 'amber';
  return 'green';
}
const serversFetcher = async (url: string): Promise<{ servers: ServerHealthRow[] } | null> => {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
};
function useServerHealthMap(): Map<string, ServerTier> {
  const { data } = useSWR<{ servers: ServerHealthRow[] } | null>(
    '/api/hub/servers',
    serversFetcher,
    { refreshInterval: 15000, dedupingInterval: 5000 },
  );
  return useMemo(() => {
    const m = new Map<string, ServerTier>();
    for (const s of data?.servers ?? []) {
      const tier = classifyServer(s);
      if (tier) m.set(s.hostname, tier);
    }
    return m;
  }, [data]);
}

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
  // Round 187 / Loop: chip transitions between fresh (gray) and stale
  // (amber) colour palettes smoothly. Pre-R187 the className swap
  // snapped every time the stale boundary was crossed — could happen
  // multiple times per minute on a flaky network. Adding
  // transition-colors makes the stale-onset (gray → amber) and
  // recovery (amber → gray) ease through the bg / text / border
  // palette together. 300ms matches R161/R162 active-links chip
  // freshness fade timing for visual consistency in the chip row.
  // Round 315 / Loop: FreshnessChip joins the R313-R314 chip-row
  // data-weight family. When it appears (stale state only — R275
  // gated rendering to stale), it sits next to working/online/
  // active-links chips that all carry font-medium (R313) plus the
  // vendor letter chips (R314). Without font-medium the warning
  // chip would render at default 400 next to data chips at 500
  // — visual inconsistency right at the moment the chip exists to
  // grab attention. font-medium adds it to the HTML-context data
  // tier (R312-R314 family); the amber bg/text/border still does
  // the warning-state work, the weight just keeps the chip in the
  // same data-typography ladder as its siblings.
  // Round 377 / Loop: FreshnessChip baseClass picks up `tabular-nums`.
  // The chip-row's last untouched chip joins the R224-R357 broader
  // tabular-nums sweep:
  //   R224 edge badge digit
  //   R225 hub digit / panel header counts / recent row count
  //   R232 chip row counts (working / online / active-links)
  //   R321 recent row timestamp
  //   R322 recent panel hot count
  //   R323 filter pin pill counts
  //   R333 vendor count suffix
  //   R357 active-links freshness suffix wrapper
  //   R377 FreshnessChip body  (this round)
  // `font-mono` already gives equal-width glyphs but `tabular-nums`
  // is the explicit-invariant the rest of the chip row carries.
  // FreshnessChip body reads `lag · {sec}s` — the {sec} digit grows
  // every second; tabular-nums explicitly locks digit width so the
  // chip stays planted as the seconds counter ticks past 9 → 10 →
  // 99 → 100. R187 transition-colors duration-300 + R275 stale-only
  // render gate + R315 font-medium R313 family alignment all
  // preserved.
  const baseClass = "hidden sm:inline px-2.5 py-1 rounded-md font-mono font-medium tabular-nums border transition-colors duration-300";
  const colorClass = stale
    ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
    : "bg-gray-500/10 text-gray-400 border-gray-500/20";
  /* Round 275 / Loop: simplification per Vincent 5214/5215-5217 visual
     audit (clutter cleanup for Twitter screenshot). Pre-R275 the chip
     ALWAYS rendered — "live · 5s" gray-on-gray at rest, "lag · 15s"
     amber when stale. The fresh state is an "everything's fine"
     affirmation that's implicit elsewhere on the canvas (counts
     updating, flows animating). Adding a permanent chip to the chip-
     row's right end for that affirmation is added visual chrome
     without proportional info value.

     R275 converts the chip to a CONDITIONAL warning indicator: render
     only when stale (sec > 10). Fresh state → null (chip absent). The
     amber stale chip still appears as a warning when SWR lags, so
     users see the problem signal; the fresh state implicitly relies
     on other liveness signals (recent-signal panel rows, edge
     animations, count updates).

     Net effect: chip-row at rest has 1 fewer chip (cleaner Twitter
     screenshot, less right-edge chrome), but signals appear on
     stale-onset to direct attention. */
  if (!stale) return null;
  return (
    <span
      className={`${baseClass} ${colorClass}`}
      title={stale ? `Last sync ${sec}s ago — SWR refresh may be lagging` : `Live data · refreshes every 5s · last sync ${sec}s ago`}
      data-freshness-chip
      data-freshness-chip-stale={stale ? 'true' : 'false'}
    >
      {/* Round 272 / Loop: swap prefix word to match color state so
          text and color point the same way. Pre-R272 the chip read
          "live · {sec}s" in BOTH fresh (gray) and stale (amber)
          states — the amber color signals "concerning" but "live"
          still says "fresh data flowing", a visual contradiction.
          Post-R272: fresh="live · {sec}s" (gray + reassuring), stale=
          "lag · {sec}s" (amber + signals lagging). Same monospace
          cell count (3 chars + " · " + digits + "s") so no chip
          width jitter on threshold crossing; R187 transition-colors
          duration-300 still eases the bg/color flip. Title (hover
          tooltip) still spells out the full meaning in either
          state. */}
      {/* Round 410 / Loop: FreshnessChip body picks up the chip-
          internal-hierarchy arc. Pre-R410 the body rendered as a
          single text node `lag · {sec}s` with the parent's font-
          medium (fw=500) applied uniformly. R410 splits the digit
          and unit into separate spans so the chip's internal
          typography mirrors the family pattern R333-R341/R362/R369/
          R389 established for the chip row:
            digit  (fw=600)  data tier
            unit   (fw=500 + opacity=0.7)  label tier
          The `lag` prefix stays at the chip's baseline (fw=500
          from parent font-medium) — it labels the state, not a
          data value. data-freshness-chip-digit / -unit attrs
          surface the spans for tests. tabular-nums + transition-
          colors + R275 stale-only gate all preserved. */}
      {stale ? 'lag' : 'live'} · <span className="font-semibold" data-freshness-chip-digit>{sec}</span><span className="opacity-70" data-freshness-chip-unit>s</span>
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
  // v0.10.0 Hero 1+2 / §3.F — per-host health tier map. Composes
  // with #119 ServersDrawer (same SWR key, deduped). When a node's
  // host server crosses into the red tier (CPU/Mem/Disk ≥ 85%),
  // the per-node SVG render adds a faint amber outer ring to flag
  // the issue without leaving the topology view.
  const hostHealthMap = useServerHealthMap();
  // R133: Next.js client-router for the recent-signal panel "+N more"
  // navigation. TopoGraph hasn't needed routing before — every other
  // affordance composes back into the canvas's own state — but the
  // truncated-flow footer is the one place where the user logically
  // wants to leave: "show me the rest of the flows" → /messages.
  const router = useRouter();
  const [messages, setMessages] = useState<MessageFlow[]>([]);
  // Issue #87: ring | grid layout toggle. Ring is the tiered-radial default;
  // grid arranges nodes in an N×M grid (better for 30+ nodes). Persisted to
  // localStorage like the zoom/pan view state. Declared above nodePositions
  // since that useMemo branches on it.
  const [layout, setLayout] = useState<'ring' | 'grid'>('ring');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('anet-topo-layout');
      if (saved === 'grid' || saved === 'ring') {
        setLayout(saved);
      } else if (sessions.length >= 20) {
        // v0.10.0 Hero 3 Wave 1 §3.D — auto-grid for dense fleets.
        // When the user hasn't explicitly chosen a layout (no
        // localStorage entry), default to `grid` once the fleet
        // crosses 20 nodes. Below 20, the ring layout reads more
        // attractive (per #87 + R97-99 tier-ring history); at 20+
        // the ring starts packing tier 3 (R98 triple-tier
        // threshold) and grid scales cleaner — every cell visible
        // at the same density, no overlap-test risk from tier
        // crowding. The user's explicit toggle (R163 chrome
        // Ring|Grid) always wins by writing to anet-topo-layout,
        // so this only sets the *initial* preference for first-
        // time users on a dense fleet. Threshold 20 picked to
        // align with the existing density-aware breakpoints (R98
        // tier flip; R109 dense-label gating at 16). */}
        setLayout('grid');
      }
    } catch {}
  // sessions.length intentionally NOT in deps — this runs once on
  // mount and shouldn't re-fire when nodes join/leave (which would
  // override a user's mid-session toggle). The Ring|Grid chrome
  // button remains the authoritative source post-mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Round 170 / Loop: layout toggle (Ring ↔ Grid) used to teleport
  // every node from its old position to its new one in one paint
  // frame — the most jarring single user action left on the
  // canvas. Solution: dim the viewport <g> to ~45% opacity for
  // the duration of the swap so the eye reads it as a soft
  // crossfade-blink rather than a hard teleport. layoutSwitching
  // is a one-shot flag; the inline style on the viewport <g>
  // reads it and lerps opacity 1 → 0.45 → 1 across the swap.
  // Auto-clears after 400ms (covers fade-down 250ms + buffer for
  // React to commit the new layout's positions). Same pattern as
  // R168's smoothView arming but on a different visual axis
  // (opacity, not transform).
  const [layoutSwitching, setLayoutSwitching] = useState(false);
  const toggleLayout = () => {
    setLayoutSwitching(true);
    setTimeout(() => setLayoutSwitching(false), 400);
    setLayout(prev => {
      const next = prev === 'ring' ? 'grid' : 'ring';
      try { localStorage.setItem('anet-topo-layout', next); } catch {}
      return next;
    });
  };
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
  // Round 171 / Loop: nodeSize change picks up the R170 crossfade
  // pattern. Clicking S/M/L in the chrome re-derives every node's
  // radius + label sizing + (in grid layout) cell spacing — a
  // wholesale visual shift. Pre-R171 the resize snapped in one
  // paint frame; with this flag the viewport <g> opacity dims to
  // 0.45 for ~400ms, masking the redraw as a soft blink (same
  // vocabulary R170 uses for layout toggle). Bails early when
  // the picked scale matches the current one — clicking the
  // already-active button shouldn't fire a fade. Composes with
  // R170 layoutSwitching via `||` in the opacity expression; both
  // flags drive the same opacity transition but expose distinct
  // data-* attributes so tests can disambiguate which gesture
  // armed the crossfade.
  const [nodeSizeSwitching, setNodeSizeSwitching] = useState(false);
  const pickNodeScale = (v: number) => {
    if (v === nodeScale) return;
    setNodeSizeSwitching(true);
    setTimeout(() => setNodeSizeSwitching(false), 400);
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

      // Pass 1 — assign each run to a band.
      //
      // v0.10.4 #150 (Vincent /goal 5453): "不是一起的落单的怎么散落在中间了".
      // Pre-#150 algo interleaved singletons between real groups as
      // centred bands, so orphan nodes appeared scattered in the middle
      // between cluster boxes. Vincent screenshot called this out as
      // "layout 算法一点都不好". Fix: bundle ALL singletons into ONE
      // band at the bottom of the grid + render an "其他" cluster box
      // around them. Multi-member prefix groups still go first in
      // alias order (existing #83/#111 behaviour). Net effect:
      //   row 0..N-1: real prefix groups (left-aligned, own cluster box)
      //   row N..M:   single "其他" band collecting all orphans
      //               (left-aligned, single cluster box at bottom)
      // No orphans → no orphan band → behaviour identical to pre-#150
      // for fleets where every node has a prefix-group match.
      type Band = { members: Session[]; startRow: number; centred: boolean; isGroup: boolean; isOrphan?: boolean };
      const bands: Band[] = [];
      let row = 0;
      const orphanMembers: Session[] = [];
      for (const run of runs) {
        if (run.members.length >= 2) {
          bands.push({ members: run.members, startRow: row, centred: false, isGroup: true });
          row += Math.ceil(run.members.length / cols);
        } else {
          // single-member run → collect for the bottom orphan band
          orphanMembers.push(...run.members);
        }
      }
      if (orphanMembers.length > 0) {
        bands.push({ members: orphanMembers, startRow: row, centred: false, isGroup: true, isOrphan: true });
        row += Math.ceil(orphanMembers.length / cols);
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
          // Round 58 / Loop: per-group status mix for the label pip strip.
          // Working = status==='working'. Idle = online but not working.
          // Offline = !isOnline (either status==='offline' AND no SSE, or
          // ghost-purged elsewhere — but ghosts never reach groupBoxes
          // since they're filtered out upstream). Counts feed the label
          // tspans directly so the strip stays inside the label's bbox,
          // preserving the node↔label overlap-test guarantee from R19.
          let w = 0, i = 0, o = 0;
          for (const s of band.members) {
            const isOn = s.status !== 'offline' || !!sseCount(s);
            if (s.status === 'working') w++;
            else if (isOn) i++;
            else o++;
          }
          // v0.10.4 #150 — orphan band (singletons bundled at bottom)
          // renders with a "其他" cluster box; the box-key drives the
          // R63 label render + R86 hover-pin keying + #99 tooltip
          // member listing, so all the existing group-box machinery
          // applies uniformly to the orphan bucket too.
          // Round 499 / Loop — surface `isOrphan` flag on the box
          // shape so downstream renderers (label text, future polish)
          // can apply orphan-specific typography (italic) without
          // re-deriving the flag from key === '其他' (key matching
          // would also catch a legitimate "其他" prefix-group, this
          // flag is canonical from the band assignment pass).
          return {
            key: band.isOrphan
              ? '其他'
              : band.members.length
                ? groupKeys[band.members[0].alias]
                : '',
            isOrphan: !!band.isOrphan,
            count: band.members.length,
            statuses: { working: w, idle: i, offline: o },
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
      groupBoxes: [] as { key: string; isOrphan?: boolean; count: number; statuses: { working: number; idle: number; offline: number }; x: number; y: number; w: number; h: number }[],
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
  // Round 86 / Loop: pointer-over-label preview. R63 wired the group
  // label to click-pin but hover gave no preview — the same hover/click
  // gap R83 closed for pressure-bar segments. This state lets the
  // label trigger the same dim mechanism a node hover already drives,
  // independently of whether the cursor happens to be over a member
  // node. ORs into hoveredGroup below so the existing derivation logic
  // (which composes with hoveredAlias, activeGroup, R85 marching ants)
  // keeps working unchanged.
  const [hoveredGroupLabel, setHoveredGroupLabel] = useState<string | null>(null);
  // Round 8 / Loop: which group is currently focused. Nodes outside this
  // group + other group boxes fade so the eye locks onto the team you're
  // pointing at. Singletons use their own alias as the group key.
  const hoveredGroup = hoveredGroupLabel
    ?? (hoveredAlias ? (groupKeys[hoveredAlias] ?? hoveredAlias) : null);
  // Round 63 / Loop: sticky group focus. R8 dims non-group nodes while
  // a member is hovered, but releasing the hover lets the focus fade.
  // Clicking the group label pins the group key here; activeGroup =
  // hoveredGroup ?? pinnedGroup so hover transiently overrides the
  // pin (handy for spot-comparing teams). Same compose pattern as
  // R60/R61 pinnedStatus.
  const [pinnedGroup, setPinnedGroup] = useState<string | null>(() => {
    // R66: same per-tab persistence treatment as pinnedStatus above.
    // The group key is opaque text (could be any prefix), so the init
    // reader can't validate it against a known enum — it just reads
    // whatever's stored. A useEffect below clears it if the value no
    // longer matches any current group (sessions changed since save).
    if (typeof window === 'undefined') return null;
    try { return sessionStorage.getItem('anet-topo-pinned-group'); } catch { return null; }
  });
  const activeGroup = hoveredGroup ?? pinnedGroup;
  // R66: sync pinnedGroup into sessionStorage when it changes; clear
  // it if it no longer matches any current group (the session set
  // can change between loads). The pinnedStatus sync sits next to
  // its declaration further down.
  useEffect(() => {
    try {
      if (pinnedGroup) sessionStorage.setItem('anet-topo-pinned-group', pinnedGroup);
      else sessionStorage.removeItem('anet-topo-pinned-group');
    } catch {}
  }, [pinnedGroup]);
  useEffect(() => {
    if (!pinnedGroup) return;
    const known = new Set(Object.values(groupKeys));
    if (!known.has(pinnedGroup)) setPinnedGroup(null);
  }, [pinnedGroup, groupKeys]);
  // Round 49 / Loop: reverse-direction of R40's edge-on-node-hover linkage.
  // R48 widened the flow hitbox to 16 px, so edges are precise enough to
  // serve as a state trigger. When the user hovers a flow edge, light up its
  // two endpoint nodes and dim the rest — "who is this edge between" becomes
  // visible without reading the tooltip. The set is the link's two aliases
  // (null when no edge hovered); node opacity composes this after inFocus.
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  // Round 116 / Loop: sticky variant of hoveredEdgeKey. R56 made the
  // recent-signal rows brighten the matching edge on hover, but the
  // filter released on mouseleave — no way to lock a flow for a
  // closer look. Click-to-pin closes that gap, matching the
  // established hover→pin idiom (R60 status, R61 legend, R63 group,
  // R88 vendor). activeEdgeKey = hoveredEdgeKey ?? pinnedEdgeKey
  // below so hover still wins for spot-comparison while a pin is set.
  const [pinnedEdgeKey, setPinnedEdgeKey] = useState<string | null>(null);
  const activeEdgeKey = hoveredEdgeKey ?? pinnedEdgeKey;
  // Round 77 / Loop: hovering the "N active links" header chip globally
  // brightens every flow edge (1.5× opacity). Transient affordance — the
  // chip already says HOW MANY active flows exist; this answers WHERE
  // they are in one glance, without the user scanning the canvas for
  // moving particles. Reset on mouse leave.
  const [hoveredActiveLinks, setHoveredActiveLinks] = useState(false);
  // Round 115 / Loop: hub-center hover state. R52 made the hub
  // clickable (fit view) + cursor:pointer, but there was no
  // hover-time visual feedback — the click target felt guessed at
  // rather than confirmed. This state drives a subtle hint ring on
  // hover so users see the affordance before committing the click.
  const [hoveredHub, setHoveredHub] = useState(false);
  // R133: hover state for the recent-signal panel's "+N more flows"
  // navigation footer. Drives the on-hover opacity boost + underline
  // that signals interactivity, mirroring the hoveredHub idiom above.
  const [hoveredRecentMore, setHoveredRecentMore] = useState(false);
  // Round 346 / Loop: minimap-container hover affordance. The minimap
  // is a click-target (role=button at line ~7810, recenter-on-click +
  // Enter→resetView) but pre-R346 nothing visually changed on hover —
  // the only hint was the `cursor: crosshair` style. R346 lifts the
  // viewport rect (strokeWidth 1.5 → 1.75 + opacity 0.9 → 1.0) when
  // the user enters the minimap, marking "this is the recenter target
  // and it's alive". Sibling polish to the R332 minimap rounded-md →
  // rounded-lg corner family — that round refined geometry, this one
  // gives the viewport indicator inside the geometry a hover state.
  // 280ms ease-out transition list matches R199 smoothView vocabulary
  // so the visual joins the existing rhythm on the same rect.
  const [hoveredMinimap, setHoveredMinimap] = useState(false);
  // Round 347 / Loop: zoom-level readout hover-state letter-spacing
  // tween (0 → 0.5 px). The readout sandwiched between zoom-out /
  // zoom-in is a passive percent display — pre-R347 it had no hover
  // feedback at all (only a `title` tooltip). R347 extends the R344
  // (`+N more flows` footer) + R345 (panel titles) hover-letter-
  // spacing family from panel/footer surfaces into the HTML chrome
  // strip. Hovering the readout spreads its digits 0.5 px, signalling
  // "this is alive". tabular-nums + minWidth: 46 from R225 still lock
  // the column so the tween doesn't shove neighbouring controls.
  // 200ms ease-out joins the existing R264 color/border transition
  // list on the same span.
  const [hoveredZoomLevel, setHoveredZoomLevel] = useState(false);
  // Round 350 / Loop: reset-button icon hover-rotate preview of the
  // R184 click-spin. Pre-R350 hovering the reset button only changed
  // the button bg (white/5); the icon inside stayed perfectly still.
  // R350 nudges the icon -8° on hover — a tactile hint that this
  // button rotates the icon on click. When the click fires, the
  // R184 anet-reset-spin keyframe animation overrides the hover
  // transform for its 450 ms run (CSS animations win over transitions
  // on the same property); when the animation ends + React removes
  // the className, the inline transform eases back to whatever the
  // hover state says — either -8° (still hovering) or 0 (mouse left).
  // 350th-round milestone polish.
  const [hoveredReset, setHoveredReset] = useState(false);
  // R135: panel-wide hover-elevation. The recent-signal + legend
  // panels both already host clickable rows (R56/R116 recent rows,
  // R55/R61 legend rows) and a clickable footer (R133), so the
  // chrome itself is interactive territory. Drop-shadow boost on
  // mouseenter says "this whole panel is alive" — matches the R18
  // KPI-card-hover idiom from the Overview page. Single state for
  // both panels since they don't overlap; null when neither hovered.
  const [hoveredPanel, setHoveredPanel] = useState<'recent' | 'legend' | null>(null);
  // Round 80 / Loop: vendor-letter hover in the distribution chip. The
  // chip already names vendor mix (`C:5 G:3 ?:1`); hover a letter and
  // every node from OTHER vendors dims. Surfaces the breakdown spatially
  // without inventing a new pin slot. Stores the vendor `initial`
  // (single char or "?") that matches the tally key.
  const [hoveredVendor, setHoveredVendor] = useState<string | null>(null);
  // Round 88 / Loop: vendor filter pin. R80 added hover-to-dim on the
  // vendor letters but the filter released as soon as the cursor left
  // — vendor was the only filter dimension without a sticky variant
  // (R60 status, R63 group, R69 Cmd+K all support pin). This state
  // closes the gap. Same pattern as pinnedStatus / pinnedGroup:
  // per-tab sessionStorage persistence, Esc clears, activeVendor =
  // hoveredVendor ?? pinnedVendor so hover still wins for spot-
  // comparison while a pin is active.
  const [pinnedVendor, setPinnedVendor] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return sessionStorage.getItem('anet-topo-pinned-vendor'); } catch { return null; }
  });
  const activeVendor = hoveredVendor ?? pinnedVendor;
  useEffect(() => {
    try {
      if (pinnedVendor) sessionStorage.setItem('anet-topo-pinned-vendor', pinnedVendor);
      else sessionStorage.removeItem('anet-topo-pinned-vendor');
    } catch {}
  }, [pinnedVendor]);
  // R89: stale-purge. If the fleet's vendor distribution changes such
  // that a previously-pinned vendor is gone (last node of that
  // vendor disconnected), clear the pin so the chip row doesn't
  // show "filter: A · 0" forever. Matches the same defensive purge
  // pattern pinnedGroup uses higher up — sessionStorage survives
  // reloads, but a stored value that no longer matches reality
  // would paint with an impossible filter.
  useEffect(() => {
    if (pinnedVendor && !vendorDist.some(v => v.initial === pinnedVendor)) {
      setPinnedVendor(null);
    }
  }, [pinnedVendor, vendorDist]);
  // Round 55 / Loop: hovering a legend status row dims nodes whose status
  // doesn't match. The legend was passive — "what does this colour mean".
  // Now it answers "show me all of these" the same way R8 group-focus
  // answers "show me this team". Three values match the legend rows.
  const [hoveredStatus, setHoveredStatus] = useState<'working' | 'idle' | 'offline' | null>(null);
  // Round 60 / Loop: sticky variant of `hoveredStatus`. R55 only filters
  // while the user is actively hovering the legend; for sweeping a fleet
  // you want to LOCK the filter. Each segment of the R31 pressure bar
  // toggles a pin — click again on the same segment to release. The node
  // opacity formula reads `activeStatus = hoveredStatus ?? pinnedStatus`
  // so hover transiently overrides a pin (handy for spot-comparison)
  // without nuking it.
  // Round 66 / Loop: pin survives a page reload via sessionStorage —
  // per-tab not per-browser (a new tab starts clean, intentionally).
  // The init reader validates against the known status set so a stale
  // / corrupt value can't paint the canvas with an impossible filter.
  const [pinnedStatus, setPinnedStatus] = useState<'working' | 'idle' | 'offline' | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const v = sessionStorage.getItem('anet-topo-pinned-status');
      return (v === 'working' || v === 'idle' || v === 'offline') ? v : null;
    } catch { return null; }
  });
  const activeStatus = hoveredStatus ?? pinnedStatus;
  // R66: sync pinnedStatus into sessionStorage when it changes. Paired
  // with the matching effect for pinnedGroup higher up.
  useEffect(() => {
    try {
      if (pinnedStatus) sessionStorage.setItem('anet-topo-pinned-status', pinnedStatus);
      else sessionStorage.removeItem('anet-topo-pinned-status');
    } catch {}
  }, [pinnedStatus]);
  // R69: listen for Cmd+K palette pin actions. The palette can't reach
  // this component's state directly so it dispatches a CustomEvent;
  // we react by setting pinnedStatus / pinnedGroup. The palette also
  // writes to sessionStorage in lockstep, so the R66 init readers
  // would pick it up on reload — the event handler is what keeps the
  // currently-mounted canvas in sync without one.
  useEffect(() => {
    const onPin = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.kind === 'clear') {
        // R90: extend the universal clear to vendor. R69 only cleared
        // status + group because pinnedVendor didn't exist yet; R88
        // shipped the third pin and R90 closes the palette gap so
        // "Clear topology filters" really means all of them.
        // R117: extend again to pinnedEdgeKey — R116 added the 4th
        // pin dim and this command must clear it too or the edge stays
        // bright in the canvas while every other pill clears.
        setPinnedStatus(null);
        setPinnedGroup(null);
        setPinnedVendor(null);
        setPinnedEdgeKey(null);
      } else if (detail.kind === 'clear-vendor') {
        // R90: granular vendor-only clear so power users can release
        // just the vendor without disturbing status/group pins.
        setPinnedVendor(null);
      } else if (detail.kind === 'clear-edge') {
        // R117: granular edge-only clear, mirror of R90 clear-vendor.
        setPinnedEdgeKey(null);
      } else if (detail.kind === 'status') {
        const v = detail.value;
        if (v === 'working' || v === 'idle' || v === 'offline') setPinnedStatus(v);
      } else if (detail.kind === 'group' && typeof detail.value === 'string') {
        setPinnedGroup(detail.value);
      } else if (detail.kind === 'vendor' && typeof detail.value === 'string') {
        // R108: palette pin-vendor support. R69 added pin-status, R88
        // added clickable vendor letters in the chip row, R90 added
        // granular clear-vendor — but the palette never gained a
        // PIN-vendor command. This branch listens for it; the matching
        // commands live in CommandPalette R108. The stale-purge
        // useEffect higher up already drops a pin whose vendor isn't
        // in the current distribution, so commands for an absent
        // vendor are harmless.
        setPinnedVendor(detail.value);
      }
    };
    window.addEventListener('anet:topo-pin', onPin);
    return () => window.removeEventListener('anet:topo-pin', onPin);
  }, []);
  // R74 listener for layout + view palette commands lives below
  // fitView's declaration — see further down in the file.
  const hoveredEdgeEndpoints = useMemo<Set<string> | null>(() => {
    // R116: compose hover ?? pin so pinning a row via click keeps the
    // endpoint ring + edge ladder lit after mouseleave.
    if (!activeEdgeKey) return null;
    const link = flowLinks.find(l => l.key === activeEdgeKey);
    return link ? new Set([link.from, link.to]) : null;
  }, [activeEdgeKey, flowLinks]);

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
  // Round 184 / Loop: chrome reset button gets a one-shot icon spin
  // on click. resetSpinning is armed for 450ms (matches the CSS
  // animation duration in globals.css `.anet-reset-spin`); the SVG
  // icon picks up the class while armed. Same arming pattern as
  // R168/R169/R170/R171 smoothView flags but driving a CSS animation
  // instead of a CSS transition. prefers-reduced-motion blanket
  // override in R29 globals.css neutralises animation-duration
  // universally so the spin completes in 1ms when reduced motion is
  // requested.
  const [resetSpinning, setResetSpinning] = useState(false);
  const armResetSpin = () => {
    setResetSpinning(true);
    setTimeout(() => setResetSpinning(false), 460);
  };
  // Round 186 / Loop: chrome zoom-in / zoom-out buttons get a brief
  // icon pop on click — same click-feel idiom R184 added for the
  // reset spin, but a scale pulse rather than a rotation since +/−
  // icons rotating wouldn't read semantically. Tracks which button
  // is currently popping so only that icon picks up the class.
  // Arms for 240ms (CSS animation 220ms + 20ms buffer) so a quick
  // re-click can replay cleanly.
  // Round 249 / Loop: extend chromePopping to cover ring/grid layout
  // toggle + fullscreen button alongside the existing zoom-in/zoom-out.
  // Pre-R249 only the zoom buttons fired the R186 .anet-chrome-pop scale
  // pulse on click; the other chrome controls (layout toggle, fullscreen)
  // had no transient "I just clicked" signal — silent click → state change
  // with only the post-click visual difference to confirm action. R249
  // gives every clickable chrome control the same 220ms scale pulse, so
  // the whole strip speaks one consistent click vocabulary. Reset button
  // keeps its own R184 rotation animation (different gesture, semantic).
  // Node-size S/M/L keep their R171 layoutSwitching crossfade (already
  // gestural). Type union grows but the helper signature stays one-arg.
  type ChromePop = 'zoom-in' | 'zoom-out' | 'layout-ring' | 'layout-grid' | 'fullscreen' | 'size-S' | 'size-M' | 'size-L';
  const [chromePopping, setChromePopping] = useState<ChromePop | null>(null);
  const popChrome = (which: ChromePop) => {
    setChromePopping(which);
    setTimeout(() => setChromePopping(prev => prev === which ? null : prev), 240);
  };
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
  // Round 169 / Loop: discrete-zoom wrapper that arms the R168
  // smoothView flag before invoking zoomBy. Keyboard + / − and
  // the chrome zoom buttons fire once per gesture, so each
  // 1.2× step deserves the same 300ms glide R168 gives
  // reset/fit. Wheel zoom keeps calling zoomBy() directly —
  // every tick should respond live without lag. The arming
  // path is identical to resetView/fitView so all four
  // discrete-zoom surfaces share one timing constant.
  const zoomByDiscrete = (factor: number) => {
    setSmoothView(true);
    setTimeout(() => setSmoothView(false), 350);
    zoomBy(factor);
  };
  // Round 168 / Loop: smoothView is a one-shot flag that arms a
  // CSS transition on the viewport <g> transform attribute. Set
  // true when resetView/fitView fires; the inline style on the
  // viewport <g> reads this flag and conditionally applies
  // `transition: transform 300ms ease-out`. Auto-clears after
  // 350ms (just past the transition end) via setTimeout so
  // subsequent pan/wheel zoom stays snappy with no lag. Keeping
  // it as state (vs ref) so the React rerender re-applies the
  // style attribute synchronously when the transform also
  // changes — both attribute mutation and transition class
  // arrive in the same paint frame, which is what triggers the
  // browser to animate between the old and new transform values.
  const [smoothView, setSmoothView] = useState(false);
  const armSmoothView = () => {
    setSmoothView(true);
    setTimeout(() => setSmoothView(false), 350);
  };
  const resetView = () => {
    armSmoothView();
    setView({ zoom: 1, x: 0, y: 0 });
  };

  // Round 29 / Loop: `f` = fit-to-content. Shared by the Round 28
  // first-paint auto-fit effect and the keyboard handler so the math is
  // in one place. When content already fits at natural zoom, this is
  // effectively a "recenter" — `f` always lands on a known good view.
  // R168: arm smoothView so the transition glides instead of snapping
  // when the operator invokes fit-to-content via the hub click (R52),
  // chrome button, `f` key, or palette command.
  const fitView = useCallback(() => {
    const zoom = !gridContentBottom || gridContentBottom <= VIEWBOX_H
      ? 1
      : Math.max(ZOOM_MIN, Math.min(1, VIEWBOX_H / gridContentBottom));
    setSmoothView(true);
    setTimeout(() => setSmoothView(false), 350);
    setView({ zoom, x: 0, y: 0 });
  }, [gridContentBottom]);

  // R74: listen for layout + view palette commands. Sister to R69's
  // pin listener — palette dispatches a CustomEvent, the reducer here
  // calls toggleLayout / fitView. Sits below fitView's declaration so
  // the deps list resolves cleanly.
  useEffect(() => {
    const onLayout = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.kind === 'toggle') toggleLayout();
    };
    const onView = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.kind === 'fit') fitView();
    };
    window.addEventListener('anet:topo-layout', onLayout);
    window.addEventListener('anet:topo-view', onView);
    return () => {
      window.removeEventListener('anet:topo-layout', onLayout);
      window.removeEventListener('anet:topo-view', onView);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView]);

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
      if (e.key === '+' || e.key === '=') { zoomByDiscrete(1.2); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { zoomByDiscrete(1 / 1.2); e.preventDefault(); }
      else if (e.key === '0') { resetView(); e.preventDefault(); }
      else if (e.key === 'f' || e.key === 'F') { fitView(); e.preventDefault(); }
      // Round 32 / Loop: `l` toggles ring|grid. The vim-style `g l` route
      // (Audit Log) requires a preceding `g` within 1500ms; a bare `l`
      // outside that window is free for topology use.
      else if (e.key === 'l' || e.key === 'L') { toggleLayout(); e.preventDefault(); }
      // Round 62 / Loop: Esc clears the R60/R61 pinned status filter so
      // users have a universal-cancel keyboard out. Esc on an open chat
      // is owned by ChatPopover (which only mounts when chatAlias is
      // set), so this handler is effectively scoped to "no chat open".
      // We additionally guard on chatAlias to be explicit — if the chat
      // closed mid-cycle, the pin can still be cleared on the next Esc.
      // R63: extends to pinnedGroup too. Clears WHATEVER pin is active
      // (one Esc collapses all topology pins) so the keyboard escape
      // route stays a single key, not "Esc maybe Esc again".
      else if (e.key === 'Escape' && !chatAlias && (pinnedStatus || pinnedGroup || pinnedVendor || pinnedEdgeKey)) {
        // R88/R116: extend the universal-cancel to vendor + edge too.
        // One Esc collapses every topology pin (matches R62/R63's
        // "single key, not Esc-maybe-Esc-again" promise).
        if (pinnedStatus)  setPinnedStatus(null);
        if (pinnedGroup)   setPinnedGroup(null);
        if (pinnedVendor)  setPinnedVendor(null);
        if (pinnedEdgeKey) setPinnedEdgeKey(null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // zoomBy / resetView are stable wrt setView callback; fitView changes
    // with gridContentBottom so deps list catches it. R62 adds chatAlias
    // and pinnedStatus so the Escape branch reads fresh state (re-binding
    // the listener on these state changes is sub-ms — cheaper than refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView, chatAlias, pinnedStatus, pinnedGroup, pinnedVendor, pinnedEdgeKey]);

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
      {/* Round 299 / Loop: title block bottom margin mb-3 (12px) →
          mb-4 (16px). After R298 tightened the title-block internal
          gap (12→10px) packing brand-logo + kicker + h2 into a more
          cohesive editorial unit, the outer bottom margin to the
          topology canvas should breathe more — denser title block
          + tighter follow-on space read as cramped. Bumping the
          gap below the title block lets the canvas frame
          itself more clearly as the main visual subject. 16px is
          the conventional SaaS-product section-header-to-content
          baseline (Stripe / Linear / Vercel marketing). Geometry:
          adds 4 CSS px between title block bottom and topology
          frame top — small but cumulative with the R298 internal
          tighten, the title block reads as a *deliberate* badge
          rather than a casually-stacked label. */}
      {/* Round 334 / Loop: header outer wrapper mobile gap-3 → gap-2.5
          (12 px → 10 px). The wrapper is `flex flex-col` on narrow
          viewports (title-block above, chip-row below) — at mobile
          its vertical gap was 12 px while the title-block internal
          (R298) and chip-row internal (R328) both rhythm at 10 px.
          R334 unifies the OUTER vertical gap to 10 px so mobile
          stacked layout matches the established gap-rhythm tier
          (title-block 10 / chip-row 10 / chrome 8 — R298/R328/R326).
          Desktop `sm:flex-row` is unaffected: in row mode the gap-3
          would have applied horizontally but the wrapper relies on
          `sm:justify-between` for left/right anchoring (gap is then
          decorative only between the two flex-grow groups). Net
          mobile bump: 2 px tighter vertical breathing between
          title-block + chip-row. Geometry-safe — topo-overlap-test
          reads SVG-internal bbox, not header layout. */}
      <div
        className={`flex flex-col gap-2.5 sm:flex-row sm:items-end sm:justify-between mb-4 px-1${isFullscreen ? ' hidden' : ''}`}
        data-topo-header-row
        data-topo-header-hidden={isFullscreen ? 'true' : 'false'}
      >
        {/* Round 267 / Loop: title block adopts leading-tight on both
            kicker and h2 for a tighter editorial-style rhythm. Pre-
            R267 the kicker used Tailwind's compound `text-xs` (line-
            height 16px = 1.33 ratio) and the h2 used `text-lg` (line-
            height 28px = 1.56) — adequate but loose for a kicker→
            title sequence. R267 applies `leading-tight` (1.25) to
            both, shrinking effective line-heights to 15px + 22.5px =
            37.5px total title block height (vs 44px pre-R267 → ~15%
            more compact) while preserving the cap-top to descender
            visual proportions. Result: kicker and title read as a
            single typographic unit rather than two loosely-stacked
            lines. data-topo-section-kicker / data-topo-section-title
            attrs make both probe-able. */}
        {/* P0 (Vincent 5222 / 通信龙 R278 dispatch): integrate sleep2agi
            brand logo into the title-block.
            Why HTML title-block instead of SVG canvas: the SVG region
            has a high-frequency concurrent-editor edit race with codex
            (see project_dashboard_concurrent_editors). The title block
            is HTML-side, low edit traffic, and gives the brand mark
            first-glance presence above the topology canvas — the exact
            "Twitter screenshot 一眼看出 sleep2agi" outcome Vincent 5215
            asked for.
            Logo construction: inline SVG so currentColor inherits
            from the parent text-{color} class — theme-aware without
            an extra asset request. Same crescent geometry as
            public/sleep2agi-logo.svg. 36×36 px so it's clearly
            readable at a16:9 Twitter crop, paired with the kicker +
            h2 typography via flex layout. text-cyan-300 in cyber +
            text-emerald-600 in light keeps the moon brand-aligned
            with the canvas accent palette. */}
        {/* Round 298 / Loop: title-block gap-3 (12px) → gap-2.5 (10px).
            The R297 codex-bundle brand-logo at 36×36 paired with the
            R285 tracking-widest kicker + R286 tracking-tight h2 forms
            an editorial "logo + title" unit. At gap-3 the 12px between
            logo right-edge and text left-edge reads as two separate
            elements — visual spacing slightly outpaces the relationship
            density (logo IS the brand mark for the kicker's
            "Network Topology"). gap-2.5 (10px) is the tight-pack
            convention SaaS-product header logos use (Stripe / Vercel /
            Linear top-nav logo + product name spacing), grouping logo
            + title as one read. Geometry: 36 + 10 + ~120 (title text
            width) = 166px total title-block width vs 168px pre-R298 —
            no measurable layout shift, just a deliberate tighter
            grouping. */}
        <div className="flex items-center gap-2.5">
          {/* Round 297 / Loop: brand-logo color picks up the 200ms ease-
              out transition. Pre-R297 the moon glyph had theme-
              conditional color (cyber #67e8f9 cyan ↔ light #0d9488
              teal) but no transition declaration — flipping themes
              made the brand mark snap to its new color in one frame,
              jarring against the surrounding R245/R246/R247/R253/R254
              family that smooths every neighbouring fill / stroke /
              filter at the same 200ms cadence. Adding the transition
              brings the brand mark into the coordinated theme-toggle
              choreography: title block + canvas + chrome all ease as
              one unit. CSS color transition is well supported on the
              `color` property (which currentColor inside the masked
              <rect> inherits), so no SMIL trick needed. */}
          {/* Round 316 / Loop: brand-logo width/height 36 → 40 for
              slightly stronger first-glance presence. After R298
              tightened the title-block flex gap (12→10px) and R299
              widened the bottom margin (12→16px), the logo can hold
              more visual weight to balance the kicker+h2 stack on
              its right. 40px is 11% larger by edge, ~23% by area —
              visible bump on a Twitter-screenshot crop without
              overpowering the h2 at text-lg/font-semibold (R286).
              viewBox 32×32 unchanged so the inner crescent geometry
              scales proportionally. */}
          <svg
            width="40" height="40" viewBox="0 0 32 32" aria-hidden
            className="shrink-0"
            data-topo-brand-logo
            style={{
              color: isLight ? '#0d9488' : '#67e8f9',
              transition: 'color 200ms ease-out',
            }}
          >
            <mask id="s2a-titleblock-moon-mask">
              <rect width="32" height="32" fill="black" />
              <circle cx="16" cy="16" r="13" fill="white" />
              <circle cx="20.5" cy="14.5" r="11" fill="black" />
            </mask>
            <rect width="32" height="32" fill="currentColor" mask="url(#s2a-titleblock-moon-mask)" />
          </svg>
          <div>
          {/* Round 285 / Loop: kicker tracking-wider → tracking-widest.
              An uppercase eyebrow label at text-xs benefits from
              wider letter-spacing — Tailwind's tracking-widest is
              0.1em vs tracking-wider's 0.05em. At small caps,
              0.1em is the conventional SaaS-eyebrow spacing (Stripe,
              Linear, Vercel marketing kicker style); 0.05em reads
              closer to body-text density. The widened spacing
              telegraphs "this is a label, not a sentence" without
              changing color or size, deepening the editorial
              hierarchy R267 set up between kicker and h2. */}
          {/* Round 296 / Loop: kicker text-gray-600 → text-gray-500
              for slightly better legibility on the dark cyber backdrop.
              gray-600 (#4b5563) read as a near-invisible label on
              cyber (the canvas + side rail are deeply dark); gray-500
              (#6b7280) lifts the eyebrow into the band where the eye
              registers it as a deliberate label vs swallowed text,
              while still sitting clearly below text-white h2 title
              in the visual hierarchy. Tailwind classes are theme-
              neutral so the bump applies to both themes; in light
              theme gray-500 is still appropriate as a muted-label
              shade on white bg. Hierarchy preserved: title-white >
              kicker-gray-500 (R285 tracking-widest still in place). */}
          {/* Round 300 / Loop (milestone): kicker picks up font-medium
              (500). Pre-R300 the eyebrow used default font-weight
              (400/normal). At text-xs (12px) + uppercase + R285
              tracking-widest, default-weight letters read slightly
              under-authored — uppercase at small sizes wants a touch
              more stroke weight to feel like a deliberate label.
              font-medium (500) is the conventional SaaS-eyebrow
              weight (Stripe / Vercel / Linear marketing kicker
              style — same family that informed R285's tracking-
              widest decision). Stays clearly below the h2's font-
              semibold (600) + larger size so hierarchy is preserved:
              h2 (text-lg/600) > kicker (text-xs/500/gray-500).
              R300 marks the milestone of 25 rounds (R275-R300) of
              continuous TopoGraph polish + codex's Vincent 5215/
              5222 logo asset+integration work. */}
          <div className="text-xs uppercase text-gray-500 tracking-widest leading-tight font-medium" data-topo-section-kicker>Network Topology</div>
          {/* Round 286 / Loop: title 'Command mesh' adopts tracking-tight
              (-0.025em) to complement R285 kicker tracking-widest. Wide
              eyebrow + tight headline is the conventional editorial
              pairing — Apple / Stripe / Vercel / Linear all use this
              dual-axis typographic rhythm. The kicker's 0.1em pushes
              letters APART (label feel); the headline's -0.025em pulls
              them TOGETHER (deliberate, designed-headline feel). At
              text-lg (18px) the shift is ~0.45px per gap — small but
              cumulatively legible across 12 characters. font-semibold
              (600) stays — tracking-tight does the heavy lifting for
              the editorial register. */}
          <h2 className="text-lg text-white font-semibold leading-tight tracking-tight" data-topo-section-title>Command mesh</h2>
          </div>
        </div>
        {/* Round 328 / Loop: chip-row strip wrapper gap 2 → 2.5
            (8px → 10px between chips). Pre-R328 the inter-chip gap
            sat at 8px while each chip's own horizontal padding was
            `px-2.5` (10px) — the chip's internal space was wider
            than the gap between chips, so adjacent chips read as
            "touching" rather than "neighboring". Bumping the gap
            to 10px makes inter-chip = chip-padding, visually
            balancing the rhythm. Sibling treatment to R298 title-
            block `gap-2.5` (brand-logo ↔ kicker/title) and R326
            chrome strip `gap-2` extension family. Layout strip:
              R298 title-block gap-2.5  (top of canvas)
              R328 chip-row    gap-2.5  (below title) ← NEW
              R326 chrome      gap-2    (bottom of canvas)
            Risk-bounded: chip-row uses `flex-wrap`; if it wraps to
            a new line on narrow viewports the row-gap also bumps to
            10px, which only helps mobile rhythm. Topo-overlap-test
            is HTML-overlay-only at this scope; SVG viewBox layout
            untouched. */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Issue #87: ring | grid layout toggle — segmented control,
              persisted to localStorage anet-topo-layout.
              Round 163 / Loop: bring the layout toggle into the R154
              chrome-button focus convention. Pre-R163 the buttons had
              aria-pressed + transition-colors but no focus-visible ring
              (browser default — invisible against dark canvas) and the
              inactive variant only nudged text from gray-500 → gray-400
              on hover with no bg tint, so the hover-to-click affordance
              was barely perceptible.

              R163 closes both gaps to match R154:
                focus-visible:ring-2 focus-visible:ring-cyan-400/60
                  → keyboard users see exactly which segment is focused
                hover:bg-cyan-500/5 (inactive)
                  → mouse hover shows a faint cyan ghost of the active
                    state, signalling 'click to switch'
                hover:bg-cyan-500/20 (active)
                  → active button responds too, says 'still clickable'
              data-topo-chrome-layout for testability symmetric with the
              R154 chrome buttons (data-topo-chrome-zoom-in / -reset /
              -fullscreen etc).

              Round 260 / Loop: chip-row semantic gap — Layout toggle is
              the only CONTROL in the chip row; everything that follows
              (working / online / pressure / vendor letters / active-
              links / filter pills / freshness) is READ-ONLY display.
              Pre-R260 all 8 children sat at uniform gap-2 (8px) — the
              spatial signal read as "8 separate things" instead of
              "1 control + 7 display". mr-1 (4px) on the Layout toggle
              stacks on top of the parent flex's gap-2 (8px) for an
              effective 12px gap before the first status chip — same
              law-of-proximity pattern R255 applied to the bottom-right
              chrome strip (fleet vs view groups). data-topo-chrome-
              layout-trailer marks the boundary surface for the gap
              probe. */}
          {/* Round 268 / Loop: Layout toggle border unified with the
              chrome strip's theme-aware borderColor. Pre-R268 the
              wrapper + Grid button's internal divider used hardcoded
              `border-gray-500/25` (pale gray, fixed in both themes)
              while the bottom-right chrome strip (nodeSize, zoom)
              used pal.containerBorder (cyber #2a2a4a dark indigo ↔
              light #e3e6eb pale gray). Visible mismatch in cyber
              theme: Layout toggle border read as pale gray while
              chrome strip borders read as darker indigo — two
              different border colors on visually-analogous
              segmented controls. R268 replaces the hardcoded class
              with inline pal.containerBorder + a border-color
              transition, so the Layout toggle (a) matches the chrome
              strip border color and (b) joins the canvas-wide
              theme-ease vocabulary (eases on cyber↔light toggle
              instead of snapping). Same change applied to the Grid
              button's border-l on line ~1493. */}
          {/* Round 329 / Loop: Layout toggle wrapper `mr-1` → `mr-0.5`
              to compensate for R328's chip-row gap bump (8 → 10 px).
              R260 designed for an effective 12 px gap between the
              Layout CONTROL and the first DISPLAY chip (working /
              online / etc): mr-1 (4 px) + chip-row gap-2 (8 px) = 12.
              R328 widened chip-row to gap-2.5 (10 px), pushing the
              effective gap to 14 px — semantically still "control
              vs display" but louder than R260 specified.
              R329 dials mr-1 → mr-0.5 (2 px) so the effective gap
              returns to 12 px (mr-0.5 + chip-row gap-2.5 = 2 + 10).
              Keeps the law-of-proximity semantic R260 designed
              while honoring R328's wider baseline rhythm. data-topo-
              chrome-layout-trailer attr unchanged — it still marks
              the boundary surface for the gap probe. */}
          {/* Round 375 / Loop: Layout-toggle wrapper rounded-md → rounded-
              lg (6 → 8 px). Extends the corner-radius cascade family
              to the chrome-strip layout-toggle wrapper:
                R330 canvas wrapper        rounded-xl  12 px
                R331 SVG panels            rx=10       10 px
                R332 minimap container     rounded-lg   8 px
                R375 Layout-toggle wrapper rounded-lg   8 px  (this round)
              Pre-R375 the wrapper at rounded-md (6 px) was the only
              chrome-strip container still using the smaller corner
              radius — both R330 outer wrapper and R332 minimap sit at
              ≥ 8 px, so the Layout toggle's 6 px stood out as a
              tighter corner against the family. R375 brings it into
              the rounded-lg tier where the minimap already lives.
              Pure paint change — overflow-hidden still clips the
              inner buttons' bg-cyan-500/15 tints; no layout shift.
              R268 border-color + 200ms transition + R329 mr-0.5 +
              data-topo-chrome-layout-trailer all preserved. */}
          <div
            className="mr-0.5 inline-flex rounded-lg border overflow-hidden"
            style={{ borderColor: pal.containerBorder, transition: 'border-color 200ms ease-out' }}
            role="group"
            aria-label="Topology layout"
            data-topo-chrome-layout-trailer
            data-topo-chrome-layout-radius="rounded-lg"
          >
            <button
              onClick={() => { popChrome('layout-ring'); if (layout !== 'ring') toggleLayout(); }}
              aria-pressed={layout === 'ring'}
              title="Ring layout (l to toggle)"
              data-topo-chrome-layout="ring"
              data-topo-chrome-layout-active={layout === 'ring' ? 'true' : 'false'}
              data-topo-chrome-layout-ring-popping={chromePopping === 'layout-ring' ? 'true' : 'false'}
              // Round 196 / Loop: add active: (pressed) state for tactile
              // click feedback — bridges mouse-down → R186/R184/R192 pop-on-
              // release. Selected variant deepens to cyan-500/25 (one tier
              // above its hover:cyan-500/20); unselected variant deepens
              // to cyan-500/15 (one tier above its hover:cyan-500/5).
              // Round 249 / Loop: chrome-pop joins the click handshake —
              // mouse-down deepens cyan press (R196), release fires
              // .anet-chrome-pop on the button (R249) AND triggers
              // toggleLayout if state changes. The pop runs even when
              // clicking the already-active layout (no state change),
              // confirming the click was received either way.
              /* Round 306 / Loop: focus-visible:ring-2 → ring-1 unifies
                 with the rest of the chrome button family. Pre-R306
                 the Layout toggle (Ring/Grid) used `focus-visible:
                 ring-2` (2px outline) while nodeSize S/M/L (line
                 ~7291), zoom -/+ (~7328/~7395), reset (~7417), and
                 fullscreen (~7477) all use `focus-visible:ring-1`
                 (1px outline). Two different focus-ring widths on
                 visually-analogous chrome controls — same R268
                 border-color unification + R288 icon-stroke
                 unification family. Reducing Ring/Grid to ring-1
                 lets all 7 chrome buttons share one focus-ring
                 weight; cyan-400/60 + ring-inset retained. The
                 R163/R196 hover/active deeps + R249 chrome-pop
                 click feedback continue unchanged. */
              // R351: hover:tracking-wide extends the R344/R345/R347
              // hover-letter-spacing family to a 4th surface (chrome-
              // strip Ring/Grid pair). transition-colors className
              // dropped in favour of an inline transition spec that
              // bundles bg/color (150ms ease) + letter-spacing
              // (200ms ease-out) — Tailwind's transition-colors
              // doesn't list letter-spacing, so without this the
              // hover:tracking-wide would snap. Sibling change on
              // the Grid button below.
              // Round 492 / Loop — add `active:scale-95` press feedback
              // alongside R196's `active:bg-cyan-500/25` color-deepen.
              // Pre-R492 the chrome-strip Ring/Grid buttons had color
              // tactile (deeper cyan on mouse-down) + R249 chrome-pop
              // on release, but no transform during the press itself —
              // the button stayed planted between mouse-down and pop.
              // Adding `active:scale-95` (5% compression) on the
              // pressed pseudo-state, with `transform 150ms ease-out`
              // bundled into the inline transition list, gives haptic-
              // like push-back feedback. The press-down (down to 95%
              // scale) eases in over 150ms in sync with the bg/color
              // deepen; the release auto-springs back to scale-100 via
              // the same transition, then R249's anet-chrome-pop class
              // overlays the release-pop. Matching `transform-gpu`
              // promotes the layer so the scale doesn't trigger
              // layout/paint thrash. Sibling change on Grid below.
              className={`px-2.5 py-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 focus-visible:ring-inset hover:tracking-wide active:scale-95 transform-gpu ${layout === 'ring' ? 'bg-cyan-500/15 text-cyan-300 font-medium hover:bg-cyan-500/20 active:bg-cyan-500/25' : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/5 active:bg-cyan-500/15'} ${chromePopping === 'layout-ring' ? ' anet-chrome-pop' : ''}`}
              style={{ transition: 'background-color 150ms ease, color 150ms ease, letter-spacing 200ms ease-out, transform 150ms ease-out' }}
            >
              Ring
            </button>
            <button
              onClick={() => { popChrome('layout-grid'); if (layout !== 'grid') toggleLayout(); }}
              aria-pressed={layout === 'grid'}
              title="Grid layout (l to toggle)"
              data-topo-chrome-layout="grid"
              data-topo-chrome-layout-active={layout === 'grid' ? 'true' : 'false'}
              data-topo-chrome-layout-grid-popping={chromePopping === 'layout-grid' ? 'true' : 'false'}
              // Round 196 / Loop: R163 layout-toggle Grid variant picks up
              // press-state — same tier pattern as Ring above.
              // Round 249 / Loop: chrome-pop on click — same as Ring.
              // Round 306 / Loop: focus-visible:ring-2 → ring-1 sibling
              // change to Ring above — unifies focus-ring width across
              // all chrome buttons.
              // R351 sibling — Grid button picks up hover:tracking-wide
              // + inline transition spec. Same vocabulary as Ring.
              // R492 sibling — Grid button picks up active:scale-95
              // press feedback + transform in transition list. Same
              // vocabulary as Ring above.
              className={`px-2.5 py-1 border-l focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 focus-visible:ring-inset hover:tracking-wide active:scale-95 transform-gpu ${layout === 'grid' ? 'bg-cyan-500/15 text-cyan-300 font-medium hover:bg-cyan-500/20 active:bg-cyan-500/25' : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-500/5 active:bg-cyan-500/15'} ${chromePopping === 'layout-grid' ? ' anet-chrome-pop' : ''}`}
              /* Round 268 / Loop: Grid button's left border (the
                 internal divider between Ring and Grid) picks up
                 pal.containerBorder, matching the wrapper change at
                 line ~1460 and the chrome strip's segmented borders
                 (nodeSize, zoom). The R268 transition-colors className
                 used to carry the border-color ease; R351 unfolds the
                 transition list into the inline spec below so the
                 letter-spacing tween rides alongside without snapping
                 the border-color flip — border-color 200ms ease-out
                 keeps R268's theme-toggle smoothness intact.
                 R492 adds `transform 150ms ease-out` so active:scale-95
                 eases smoothly. */
              style={{ borderColor: pal.containerBorder, transition: 'background-color 150ms ease, color 150ms ease, border-color 200ms ease-out, letter-spacing 200ms ease-out, transform 150ms ease-out' }}
            >
              Grid
            </button>
          </div>
          {/* R79: working + online count chips become hover affordances —
              extends R77's chip-hover pattern to status counts. Hover the
              working chip → setHoveredStatus('working') so the R55 dim
              mechanic kicks in (same as hovering the SVG legend "working"
              row, just a different surface for the same gesture).
              The online chip uses the same setHoveredStatus('idle') path
              when there's idle but no working — falling back to working
              if any working node exists; "online" without a single bucket
              isn't part of the R55 type set, so this chip routes to the
              dominant online sub-tier instead of inventing a new state.
              Cursor only flips when there's anything to highlight. */}
          {/* R82: pin-mirror. R60 pressure-bar segments visualise the
              pinned status via an inset boxShadow; R61 legend rows via a
              concentric r=8 ring; the chip-row chips next to them did
              not — so a user who pinned via Cmd+K (R69) or the legend
              had no chip-row signal that "working" was the current
              filter. Mirror the pressure-bar treatment here so all
              status surfaces sing in unison. The online chip mirrors
              for idle pins (working ⊆ online; the routing in
              onMouseEnter already treats online as the idle fallback). */}
          {(() => {
            // R113 / Loop: extend the R97-R102/R101 alias-list tooltip
            // sweep to the remaining chip-row affordances. R79 made
            // these chips hoverable; their generic "Hover to highlight"
            // titles never said WHICH nodes match. Compute the alias
            // lists once for both chips to share.
            const workingAliases = onlineNodes.filter(s => s.status === 'working').map(s => s.alias);
            const onlineAliases  = onlineNodes.map(s => s.alias);
            const truncate = (list: string[]) => {
              const head = list.slice(0, 8).join(', ');
              const tail = list.length > 8 ? ` + ${list.length - 8} more` : '';
              return head + tail;
            };
            const workingTitle = workingCount === 0
              ? undefined
              : pinnedStatus === 'working'
                ? `${truncate(workingAliases)} — pinned, Esc to clear`
                : `${truncate(workingAliases)} — hover highlights, click to pin`;
            // R140: online chip title gains a "click to open /nodes" tail
            // when interactive. R79 made the cursor pointer-shaped but
            // wired nothing; R136 + R139 closed the same lie on two
            // sibling chips by wiring real actions. The online chip
            // can't pin a single status (online = working + idle,
            // not a single pinnedStatus value), so a pin idiom would
            // be semantically wrong. /nodes is the natural full-list
            // destination — same "click chip for the full list" idiom
            // the active-links chip uses (R136 → /messages).
            const onlineTitle = onlineNodes.length === 0
              ? undefined
              : pinnedStatus === 'idle'
                ? `${truncate(onlineAliases)} — pinned, Esc to clear`
                : `${truncate(onlineAliases)} — hover highlights · click to open /nodes`;
            return (
              <>
                <span
                  // Round 201 / Loop: the working chip joins the
                  // "chip's hover state deepens its OWN identity colour"
                  // family that R193 opened (active-links chip) and R195
                  // extended (recent-panel footer). Pre-R201 hovering the
                  // working chip fired R55 canvas dim + chip-row highlight
                  // but the chip itself stayed at bg-green-500/10 — cause
                  // silent, effect loud. R201 deepens its OWN green hue
                  // (10→15 bg, 20→30 border) only when clickable.
                  // transition-colors duration-200 blends the swap to
                  // match R193's timing on the active-links chip.
                  /* Round 232 / Loop: HTML chip row picks up the
                     tabular-nums info-density treatment R224-R230
                     established on the SVG side. The chip text reads
                     "{N} working"; when workingCount crosses 9→10
                     the leading digit's width shift propagates the
                     trailing ' working' label right by the digit-vs-
                     control glyph delta, and the chip's right edge
                     re-flows because the parent is inline flex. The
                     Tailwind `tabular-nums` utility sets font-variant-
                     numeric: tabular-nums, locking the digit width
                     so the chip text + chip width stay stable across
                     all counter values. Sibling chips (online,
                     active-links) get the same treatment in this
                     round so the three-chip row reads uniformly.
                     7th surface in the info-density tabular-nums
                     sweep — and the first on the HTML side
                     (previous 6 were SVG <text>/<tspan>). */
                  /* Round 398 / Loop: chip-row chips gain hover translateY
                     (-1px) lift on the CLICKABLE variant only (workingCount
                     > 0 here / onlineNodes.length > 0 below / activeLinks
                     > 0 deeper). Pre-R398 the chips brightened bg + border
                     on hover (R201) but didn't lift — only their clickable
                     siblings (filter pin pills R397, recent rows R143,
                     legend rows R144) acknowledged cursor entry with a
                     translate-y. R398 closes the chip-row by extending
                     the same gesture to the static header chips, gated
                     on the clickable role so empty chips (which have
                     no role="button") stay planted at their R205
                     opacity-50 receded paint. transition-transform
                     + duration-200 + ease-out + transform-gpu added
                     alongside existing transition-colors so the lift
                     and the color tween share rhythm.
                     Gesture-vocabulary table (post-R398):
                       recent-signal row  -1 px  (R143)
                       legend row         -1 px  (R144)
                       group cluster box  fill+sw lift (R142)
                       filter pin pills   -1 px  (R397)
                       chip-row chips     -1 px  (R398, this round)
                     Empty chips: no lift. Pin-mirror chips: no
                     conflict (R180 inset double-ring is a box-shadow
                     not a transform). new data-chip-hover-lift attr
                     surfaces the lift surface for tests. */
                  // R414: chip-row chips gain `group` so inner unit
                  // span brightens via group-hover:opacity-100 — sibling
                  // to R355 filter pin pill inner-span hover-brighten.
                  // Hover-brighten family extends from filter pills to
                  // chip-row chips at the inner-span scope.
                  // Round 494 / Loop — chip-row working chip joins the
                  // active:scale-95 press-feedback family (R492 Ring/Grid +
                  // R493 chrome-strip rest). Gated on the clickable branch
                  // (workingCount > 0) — when the chip is a placeholder
                  // at count=0, scale-95 stays off to match the existing
                  // R398 hover-lift conditional. Composes with hover:-
                  // translate-y-px for the same lift-and-compress
                  // tactile signature R493 brought to reset/fullscreen.
                  className={`group tabular-nums font-medium px-2.5 py-1 rounded-md border anet-topo-chip-focus transition-colors transition-transform duration-200 ease-out transform-gpu ${
                    workingCount > 0
                      ? 'bg-green-500/10 text-green-300 border-green-500/20 hover:bg-green-500/15 hover:border-green-500/30 hover:-translate-y-px active:scale-95'
                      : 'bg-green-500/10 text-green-300 border-green-500/20'
                  }`}
                  data-chip-hover-lift={workingCount > 0 ? 'true' : 'false'}
                  data-chip-group-hover-brighten="true"
                  data-working-chip
                  data-working-chip-aliases={workingAliases.join(',')}
                  data-pin-mirror={pinnedStatus === 'working' ? 'true' : 'false'}
                  data-working-chip-clickable={workingCount > 0 ? 'true' : 'false'}
                  data-working-chip-empty={workingCount === 0 ? 'true' : 'false'}
                  title={workingTitle}
                  role={workingCount > 0 ? 'button' : undefined}
                  tabIndex={workingCount > 0 ? 0 : undefined}
                  aria-pressed={workingCount > 0 ? (pinnedStatus === 'working') : undefined}
                  // Round 180 / Loop: pin-mirror inset rings now ease in/out
                  // instead of snapping. R165 added this transition to the
                  // pressure-bar segments; R180 closes the smooth-pin-mirror
                  // family across the three remaining chip-row pin chips
                  // (working / online / vendor letter). The visual is small
                  // — a 1-2 px inset double ring — but the eye catches the
                  // pop on every pin/unpin without the ease.
                  // Round 201 / Loop: inline transition list now also covers
                  // background-color + border-color so the R201 hover tint
                  // eases. Tailwind transition-colors on the className would
                  // be overridden by this inline declaration, so we splice
                  // the colour properties directly into the existing
                  // R180 box-shadow transition.
                  // Round 205 / Loop: chip recedes to opacity 0.5 when its
                  // tier is empty (workingCount=0). Pre-R205 "0 working"
                  // displayed at full bg-green-500/10 chrome — visually
                  // indistinguishable from "12 working". Eye got zero
                  // empty-tier signal. R205 mirrors R204's legend count
                  // recede-on-empty pattern at the chip-row scope. Inline
                  // transition list extends `opacity 200ms ease-out` so
                  // the crossing-zero ease matches R201's bg/border
                  // timing. Empty-state combines with R139's clickable=
                  // false + tooltip-undefined: visual + interactive +
                  // affordance all say "this tier has nothing to act on".
                  style={{
                    cursor: workingCount > 0 ? 'pointer' : undefined,
                    opacity: workingCount === 0 ? 0.5 : 1,
                    boxShadow: pinnedStatus === 'working' ? 'inset 0 0 0 1px #4ade80, inset 0 0 0 2px rgba(255,255,255,0.45)' : undefined,
                    transition: 'box-shadow 150ms ease-out, background-color 200ms ease-out, border-color 200ms ease-out, opacity 200ms ease-out',
                  }}
                  onMouseEnter={() => { if (workingCount > 0) setHoveredStatus('working'); }}
                  onMouseLeave={() => setHoveredStatus(prev => prev === 'working' ? null : prev)}
                  // R139: the title hover-text has been promising "click to
                  // pin" since R79 but no onClick was ever wired. The cursor:
                  // pointer at line 1363 set up the same lie R136 fixed on
                  // the active-links chip. Wire it now: click toggles the
                  // status pin to 'working', composing with R60 (pressure-
                  // bar segments) and R61 (legend rows) — three different
                  // surfaces that all toggle the same pinnedStatus. boxShadow
                  // pin-mirror at line 1364 already reflects the state; aria-
                  // pressed now exposes it for screen readers too.
                  onClick={() => {
                    if (workingCount > 0) setPinnedStatus(prev => prev === 'working' ? null : 'working');
                  }}
                  onKeyDown={(e) => {
                    if (workingCount === 0) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPinnedStatus(prev => prev === 'working' ? null : 'working');
                    }
                  }}
                >
                  {/* Round 337 / Loop: split working chip into digit +
                      " working" unit, with the unit at opacity-70.
                      Extends the R333/R335/R336 chip-internal-hierarchy
                      arc from SVG (panel headers) and pin-chip prefix
                      surfaces into HTML chip-row chips. Recurring
                      pattern: small label spans demote, value stays
                      prominent. data-working-chip-unit exposes the
                      span for tests. */}
                  {/* Round 362 / Loop: digit picks up font-semibold
                      (fw 500 → 600) for within-chip weight tier. The
                      chip's outer className stays at font-medium (R313
                      data-weight baseline); the digit overrides to
                      semibold so it reads heavier than its " working"
                      unit (which keeps fw 500 + R338 opacity-70).
                      Joins the R333-R341 chip-internal-hierarchy arc
                      at the chip-count scope. Sibling edits on the
                      online + active-links chip digits below. data-
                      working-chip-digit attr exposes the digit span. */}
                  <span className="font-semibold transition-[font-weight] duration-200 group-hover:font-bold" data-working-chip-digit>{workingCount}</span><span className="opacity-70 transition-opacity duration-200 group-hover:opacity-100" data-working-chip-unit> working</span>
                </span>
                <span
                  // Round 201 / Loop: online chip — mirror of the working
                  // chip treatment above. cyan hue 10→15 bg + 20→30 border
                  // on hover, only when there's at least one online node
                  // to highlight. Three sibling chips in the chip row now
                  // all speak the same gesture vocabulary:
                  //   working chip   · green 10→15 (R201)
                  //   online chip    · cyan  10→15 (R201)
                  //   active-links   · gray  → cyan (R193)
                  /* Round 232 / Loop: tabular-nums on online chip
                     (sibling treatment to working chip — same row,
                     same digit-jitter physics on count crossings). */
                  // R398: hover translate-y lift on clickable variant — see working chip above.
                  // R414: `group` parent + inner unit span group-hover-brighten — see working chip above.
                  // R494 sibling — online chip joins the active:scale-95 press
                  // family (gated on onlineNodes.length > 0 clickable branch,
                  // same conditional pattern as the working chip above).
                  className={`group tabular-nums font-medium px-2.5 py-1 rounded-md border anet-topo-chip-focus transition-colors transition-transform duration-200 ease-out transform-gpu ${
                    onlineNodes.length > 0
                      ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20 hover:bg-cyan-500/15 hover:border-cyan-500/30 hover:-translate-y-px active:scale-95'
                      : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                  }`}
                  data-chip-hover-lift={onlineNodes.length > 0 ? 'true' : 'false'}
                  data-chip-group-hover-brighten="true"
                  data-online-chip
                  data-online-chip-aliases={onlineAliases.join(',')}
                  data-pin-mirror={pinnedStatus === 'idle' ? 'true' : 'false'}
                  data-online-chip-clickable={onlineNodes.length > 0 ? 'true' : 'false'}
                  data-online-chip-empty={onlineNodes.length === 0 ? 'true' : 'false'}
                  title={onlineTitle}
                  role={onlineNodes.length > 0 ? 'link' : undefined}
                  tabIndex={onlineNodes.length > 0 ? 0 : undefined}
                  // R180: smooth-pin-mirror family — see working chip above.
                  // R201: inline transition list also covers bg + border so
                  // the new R201 hover tint eases (mirror of working chip).
                  // R205: empty-tier recede — opacity 0.5 when onlineNodes
                  // is empty (mirror of working chip above).
                  style={{
                    cursor: onlineNodes.length > 0 ? 'pointer' : undefined,
                    opacity: onlineNodes.length === 0 ? 0.5 : 1,
                    boxShadow: pinnedStatus === 'idle' ? 'inset 0 0 0 1px #67e8f9, inset 0 0 0 2px rgba(255,255,255,0.45)' : undefined,
                    transition: 'box-shadow 150ms ease-out, background-color 200ms ease-out, border-color 200ms ease-out, opacity 200ms ease-out',
                  }}
                  onMouseEnter={() => {
                    // If a working filter would isolate nothing, route to idle.
                    const idleCount = onlineNodes.length - workingCount;
                    if (workingCount > 0) setHoveredStatus('working');
                    else if (idleCount > 0) setHoveredStatus('idle');
                  }}
                  onMouseLeave={() => setHoveredStatus(prev => prev === 'working' || prev === 'idle' ? null : prev)}
                  // R140: click → /nodes. Mirrors R136 active-links→/messages
                  // idiom. The chip's hover semantics (R79 highlight all
                  // online) keep their meaning — hover for canvas preview,
                  // click for the full list. Pinning idle here would
                  // semantically misrepresent the chip (which means
                  // working+idle), so we navigate instead of pin.
                  onClick={() => {
                    if (onlineNodes.length > 0) router.push('/nodes');
                  }}
                  onKeyDown={(e) => {
                    if (onlineNodes.length === 0) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push('/nodes');
                    }
                  }}
                >
                  {/* R337 sibling — online chip unit demotion. */}
                  {/* R362 sibling — online-chip digit gains font-semibold. */}
                  <span className="font-semibold transition-[font-weight] duration-200 group-hover:font-bold" data-online-chip-digit>{onlineNodes.length}</span><span className="opacity-70 transition-opacity duration-200 group-hover:opacity-100" data-online-chip-unit> online</span>
                </span>
              </>
            );
          })()}
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
            // Round 60 / Loop: each segment toggles a sticky filter via
            // `pinnedStatus`. Click the working segment → all non-working
            // nodes dim; click again → release. Segments share width with
            // their proportion of `total`, so a 1-node working share is
            // ~3 px wide on a 64-px bar. We pad the click target with a
            // negative-margin overlay wrapper to give thin slices a
            // 14-px minimum hit area without disturbing the rendered
            // chip width. cursor:pointer + a one-line title hint at the
            // affordance.
            const seg = (n: number, color: string, key: 'working' | 'idle' | 'offline', label: string) => {
              if (n === 0) return null;
              const isPinned = pinnedStatus === key;
              // R102: list the aliases that match this segment's bucket
              // so the title answers WHICH n, not just HOW MANY. Closes
              // the last "info-density gap" in the chip-row surfaces
              // (R97 pills / R99 group labels / R101 vendor letters all
              // already enumerate). Truncates at 8 with "+N more".
              const matchAliases = key === 'working'
                ? onlineNodes.filter(s => s.status === 'working').map(s => s.alias)
                : key === 'idle'
                ? onlineNodes.filter(s => s.status !== 'working').map(s => s.alias)
                : offlineNodes.map(s => s.alias);
              const previewList = matchAliases.slice(0, 8).join(', ');
              const suffix = matchAliases.length > 8 ? ` + ${matchAliases.length - 8} more` : '';
              const titleAction = isPinned ? 'click to release filter' : 'click to highlight';
              return (
                <span
                  key={key}
                  data-pressure-seg={key}
                  data-pressure-seg-aliases={matchAliases.join(',')}
                  data-pressure-seg-hovered={hoveredStatus === key ? 'true' : 'false'}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isPinned}
                  className="anet-topo-chip-focus"
                  title={`${n} ${label}\n${previewList}${suffix}\n${titleAction}`}
                  // Round 165 / Loop: smooth width transitions on the
                  // pressure-bar segments. Pre-R165 the widths snapped
                  // instantly when fleet composition shifted (a node
                  // going idle → working would visibly jump the green
                  // segment by a few px). 220ms ease-out makes the bar
                  // visually breathe with state — segment shifts now
                  // glide into place instead of cutting. Pure CSS
                  // transition on width; respects prefers-reduced-
                  // motion via globals.css blanket override that
                  // neutralises transition-duration universally.
                  // boxShadow gets its own transition so pin
                  // state-changes also fade smoothly, not snap.
                  //
                  // Round 210 / Loop: segment deepens its OWN colour on
                  // hover via filter: brightness(1.2). Closes the
                  // chip-row "hover deepens own identity" family at the
                  // pressure-bar scope — R83 already setHoveredStatus
                  // to drive canvas dim, but the segment itself stayed
                  // at flat `background: color`. R210 makes the cause
                  // element (segment) light up with the same gesture
                  // it fires on the canvas (effect element). Family
                  // surfaces (6 with R210):
                  //   R193 active-links chip   · gray  → cyan
                  //   R195 recent-panel footer · gray  → cyan
                  //   R201 working / online    · own /10 → /15  (×2)
                  //   R202 vendor letter       · per-vendor color-mix
                  //   R210 pressure-bar seg    · brightness(1.2)  ← NEW
                  // brightness(1.2) lightens the segment's own hue by
                  // 20% — keeps the tier identity (green stays green,
                  // teal stays teal, gray stays gray) while signalling
                  // "this is hovered". transition adds filter 150ms
                  // ease-out alongside the existing width / box-shadow.
                  style={{
                    width: `${(n / total) * 100}%`,
                    background: color,
                    height: '100%',
                    cursor: 'pointer',
                    boxShadow: isPinned ? `inset 0 0 0 1px ${color}, inset 0 0 0 2px rgba(255,255,255,0.6)` : undefined,
                    filter: hoveredStatus === key ? 'brightness(1.2)' : undefined,
                    transition: 'width 220ms ease-out, box-shadow 150ms ease-out, filter 150ms ease-out',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPinnedStatus(prev => prev === key ? null : key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPinnedStatus(prev => prev === key ? null : key);
                    }
                  }}
                  // R83: hover preview — segments now match the R55 legend,
                  // R79 working/online chips, and R80 vendor letters in
                  // offering a hover-transient highlight before the click
                  // commits to a pin. Users get to feel what the filter
                  // does before they lock it in. Same activeStatus =
                  // hoveredStatus ?? pinnedStatus formula; releasing the
                  // pointer falls back to the pin if one is set, or to
                  // baseline. Thin (3-px) segments still hit-test fine
                  // because the chip itself is a flex row — span doesn't
                  // need any extra hit padding for hover.
                  onMouseEnter={() => setHoveredStatus(key)}
                  onMouseLeave={() => setHoveredStatus(prev => prev === key ? null : prev)}
                />
              );
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
                {/* Round 373 / Loop: pressure-bar kicker label gains
                    font-medium (fw 400 → 500). Sibling small-text fw
                    lift family with R363 recent-row alias + R364
                    legend-row label + R366 group-label count + R368
                    +N more flows footer — extends to a 5th surface
                    (the chip-row's 'pressure' label). At fontSize
                    10 px tracking-wide against the chip's gray bg,
                    the default fw 400 sat below the deliberate-data
                    band; fw 500 brings it into parity with the
                    chip-row 'working / online / active links' unit
                    spans (chip-level font-medium R313). data-fleet-
                    pressure-kicker attr exposes the kicker for tests. */}
                <span className="text-[10px] tracking-wide font-medium" data-fleet-pressure-kicker>pressure</span>
                {/* Round 374 / Loop: pressure-bar height h-1.5 → h-2
                    (6 → 8 px) — sibling visual-weight bump (8th anchor
                    in the family):
                      R287 minimap viewport stroke 1 → 1.5
                      R295 legend swatch base radius 5.5 → 6
                      R359 recent-row pip base radius 1.6 → 1.8
                      R360 hub digit fontSize 11 → 12
                      R361 edge-badge digit fontSize 10 → 11
                      R365 hub-highlight base radius 5 → 5.5
                      R367 edge-badge rest stroke 1 → 1.25
                      R374 pressure-bar height 1.5 → 2  (this round)
                    +33 % bar height gives the working/idle/offline
                    segments more visibility — at h-1.5 the 3-segment
                    proportion bar was readable but slim; at h-2 the
                    segments parse cleanly even when one tier is
                    < 10 % share. Geometry-safe: items-center flex
                    centers the bar inside the chip's py-1 (4 px top +
                    4 px bottom) — bar at 8 px stays comfortably
                    inside the 10-px text-row height. R165 segment
                    width transitions + R210 brightness hover + R83
                    pin-mirror box-shadow on segments all preserved
                    (segments inherit width from parent so the height
                    bump propagates without segment-side edits).
                    data-fleet-pressure-bar-height attr exposes the
                    height token for tests. */}
                <span className="inline-flex h-2 w-16 rounded-full overflow-hidden" style={{ background: 'rgb(75 85 99 / 0.25)' }} data-fleet-pressure-bar-height="h-2">
                  {seg(w, isLight ? '#059669' : '#22c55e', 'working', 'working')}
                  {seg(i, isLight ? '#0d9488' : '#2dd4bf', 'idle',    'idle')}
                  {seg(o, isLight ? '#94a3b8' : '#6b7280', 'offline', 'offline')}
                </span>
              </span>
            );
          })()}
          {/* Round 64 / Loop: active-filter pills. When pinnedStatus or
              pinnedGroup is set, show a small "filter: <key> ×" pill so
              the user can see the pin from the chip row even if they
              scrolled the canvas off-screen. × button clears the
              specific pin (Esc still clears all — both paths are
              valid). pinnedStatus and pinnedGroup pin independently so
              both pills may render simultaneously. */}
          {/* R67: pills enter via anet-fade-in so they appear softly
              instead of popping. The "filter: " prefix collapses below
              sm — at narrow viewports the chip row is precious real
              estate (R47 already hides pressure / vendor / freshness),
              so dropping the redundant label keeps the working/idle/
              alpha keys readable without overflow. */}
          {/* R71: each pill picks up a "· N" match count tail. Tells the
              user at a glance how many sessions the active filter
              matches without scanning the canvas. Counts come from the
              already-computed workingCount + onlineNodes + offlineNodes
              for status, and groupKeys for group. */}
          {/* R73: entire pill body is a click-to-clear target — matches
              the Notion / Linear tag UX (the whole chip releases). The
              ×  keeps its dedicated <button> + aria-label for screen
              readers; the outer span just adds an extra mouse-friendly
              hit area with a title hint. ×'s onClick stopPropagation
              so the redundant outer onClick doesn't double-fire (no
              functional difference since both clear, but cleaner
              event flow). */}
          {pinnedStatus && (() => {
            const matchCount = pinnedStatus === 'working' ? workingCount
                            : pinnedStatus === 'idle'    ? (onlineNodes.length - workingCount)
                            : offlineNodes.length;
            // Round 97 / Loop: the pill says HOW MANY but not WHICH.
            // Hovering it now shows the matched alias list in the
            // tooltip — answers "exactly who is this filtering to"
            // without forcing the user to scan the dim mask on the
            // canvas. Truncates at 8 names so a 50-node working
            // bucket doesn't produce a 12-line tooltip; the count
            // chip already answers "how many overall".
            const matchAliases = pinnedStatus === 'working'
              ? onlineNodes.filter(s => s.status === 'working').map(s => s.alias)
              : pinnedStatus === 'idle'
              ? onlineNodes.filter(s => s.status !== 'working').map(s => s.alias)
              : offlineNodes.map(s => s.alias);
            const matchPreview = matchAliases.slice(0, 8).join(', ');
            const matchSuffix = matchAliases.length > 8 ? ` + ${matchAliases.length - 8} more` : '';
            return (
            <span
              data-active-filter="status"
              data-filter-match-count={matchCount}
              data-filter-match-aliases={matchAliases.join(',')}
              // R355: `group` lets the inner opacity-70 spans (prefix
              // `filter:` + count `· N`) brighten to 100 % on pill hover.
              // Sibling treatment on group + vendor pills below.
              // R495 — filter pills (3 sibling `group` variants) join the
              // active:scale-95 press-feedback family. R490's !important
              // transition list on .anet-topo-chip-focus already covers
              // transform, so just appending active:scale-95 to the
              // className wires the press tactile in one token. Compound
              // with R400-era hover:-translate-y-px gives lift-and-compress.
              className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono font-medium text-xs border anet-fade-in anet-topo-chip-focus transition-transform duration-200 ease-out hover:-translate-y-px active:scale-95 transform-gpu" data-topo-filter-pill-hover-lift="true"
              title={matchCount > 0 ? `${matchPreview}${matchSuffix} — click to clear` : 'Click to clear filter'}
              onClick={() => setPinnedStatus(null)}
              style={{
                background: pinnedStatus === 'working' ? (isLight ? '#05966914' : '#22c55e1f')
                          : pinnedStatus === 'idle'    ? (isLight ? '#0d948814' : '#2dd4bf1f')
                          : (isLight ? '#94a3b814' : '#6b72801f'),
                color:      pinnedStatus === 'working' ? (isLight ? '#047857' : '#86efac')
                          : pinnedStatus === 'idle'    ? (isLight ? '#0f766e' : '#5eead4')
                          : (isLight ? '#475569' : '#9ca3af'),
                borderColor: 'currentColor',
                cursor: 'pointer',
              }}
            >
              {/* Round 412 / Loop: filter pin pill VALUE picks up the
                  chip-internal-hierarchy arc. Pre-R412 the value span
                  (pinnedStatus / pinnedGroup / pinnedVendor) inherited
                  the parent's font-medium (fw=500); prefix and suffix
                  were opacity-70 label-tier but the VALUE itself sat
                  at the same baseline weight. R412 wraps the value in
                  a font-semibold span (fw=600) so the pill now reads
                  with proper data-tier emphasis — sibling treatment
                  to R333/R335-R341/R362/R369/R389/R410. data-filter-
                  value attr surfaces the value span for tests.
                  4-pill replace family — status / group / vendor / edge. */}
              <span><span className="hidden sm:inline opacity-70 transition-opacity duration-200 group-hover:opacity-100" data-filter-prefix>filter: </span><span className="font-semibold" data-filter-value>{pinnedStatus}</span><span className="opacity-70 tabular-nums transition-opacity duration-200 group-hover:opacity-100" data-filter-pill-count> · {matchCount}</span></span>
              <button
                type="button"
                aria-label={`Clear ${pinnedStatus} filter`}
                onClick={(e) => { e.stopPropagation(); setPinnedStatus(null); }}
                /* Round 356 / Loop: filter pin pill × buttons gain
                   hover:scale-110 (Tailwind 4 modern CSS `scale` property,
                   not legacy transform). Sibling polish to R354 vendor
                   letter glyph + R350/R352/R353 chrome icon hover-scales.
                   Pre-R356 the × had only hover:opacity-70 — the target
                   dimmed under cursor but didn't lift. R356 adds a 10 %
                   scale on hover so the click-target reads as "press me"
                   alongside the dim. transform-gpu hint promotes the
                   button to its own compositor layer for crisper edges
                   during the scale tween. transition-transform duration-
                   200 matches the chrome icon hover-scale timing family.
                   inline-block is default for <button> so no display
                   tweak needed. replace_all covers all 4 filter pin
                   pills (status / group / vendor / edge) at once. */
                className="ml-0.5 leading-none hover:opacity-70 transition-transform duration-200 ease-out hover:scale-110 transform-gpu"
                style={{ background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
              >×</button>
            </span>
            );
          })()}
          {pinnedGroup && (() => {
            const matchCount = Object.values(groupKeys).filter(k => k === pinnedGroup).length;
            // R97: list group members in the tooltip.
            const matchAliases = Object.entries(groupKeys)
              .filter(([, key]) => key === pinnedGroup)
              .map(([alias]) => alias);
            const matchPreview = matchAliases.slice(0, 8).join(', ');
            const matchSuffix = matchAliases.length > 8 ? ` + ${matchAliases.length - 8} more` : '';
            return (
            <span
              data-active-filter="group"
              data-filter-match-count={matchCount}
              data-filter-match-aliases={matchAliases.join(',')}
              // R355 sibling — `group` parent + group-hover on inner spans.
              // R495 — filter pills (3 sibling `group` variants) join the
              // active:scale-95 press-feedback family. R490's !important
              // transition list on .anet-topo-chip-focus already covers
              // transform, so just appending active:scale-95 to the
              // className wires the press tactile in one token. Compound
              // with R400-era hover:-translate-y-px gives lift-and-compress.
              className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono font-medium text-xs border anet-fade-in anet-topo-chip-focus transition-transform duration-200 ease-out hover:-translate-y-px active:scale-95 transform-gpu" data-topo-filter-pill-hover-lift="true"
              title={matchCount > 0 ? `${matchPreview}${matchSuffix} — click to clear` : 'Click to clear filter'}
              onClick={() => setPinnedGroup(null)}
              style={{
                background: isLight ? '#67e8f914' : '#67e8f91f',
                color: pal.legendAccent,
                borderColor: 'currentColor',
                cursor: 'pointer',
              }}
            >
              {/* R412: see status pill above — filter value fw=600 data tier. */}
              <span><span className="hidden sm:inline opacity-70 transition-opacity duration-200 group-hover:opacity-100" data-filter-prefix>filter: </span><span className="font-semibold" data-filter-value>{pinnedGroup}</span><span className="opacity-70 tabular-nums transition-opacity duration-200 group-hover:opacity-100" data-filter-pill-count> · {matchCount}</span></span>
              <button
                type="button"
                aria-label={`Clear group filter ${pinnedGroup}`}
                onClick={(e) => { e.stopPropagation(); setPinnedGroup(null); }}
                /* Round 356 / Loop: filter pin pill × buttons gain
                   hover:scale-110 (Tailwind 4 modern CSS `scale` property,
                   not legacy transform). Sibling polish to R354 vendor
                   letter glyph + R350/R352/R353 chrome icon hover-scales.
                   Pre-R356 the × had only hover:opacity-70 — the target
                   dimmed under cursor but didn't lift. R356 adds a 10 %
                   scale on hover so the click-target reads as "press me"
                   alongside the dim. transform-gpu hint promotes the
                   button to its own compositor layer for crisper edges
                   during the scale tween. transition-transform duration-
                   200 matches the chrome icon hover-scale timing family.
                   inline-block is default for <button> so no display
                   tweak needed. replace_all covers all 4 filter pin
                   pills (status / group / vendor / edge) at once. */
                className="ml-0.5 leading-none hover:opacity-70 transition-transform duration-200 ease-out hover:scale-110 transform-gpu"
                style={{ background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
              >×</button>
            </span>
            );
          })()}
          {/* R89: vendor pin gets its own filter pill, matching the R64
              status + group pattern. R88 added the pin but only the
              letter itself carried the state; the chip-row had no
              "filter: A · 2 ×" affordance the other two pins have. The
              pill colour borrows the vendor's own swatch so each pin
              still reads in its native hue (A green, O cyan, 书 blue,
              ? slate). Same body-click-clears + × button pattern as
              R64. */}
          {pinnedVendor && (() => {
            const matchEntry = vendorDist.find(v => v.initial === pinnedVendor);
            const matchCount = matchEntry?.count ?? 0;
            const vendorColor = matchEntry?.color ?? pal.legendText;
            // R97: list vendor users in the tooltip. The vendorIdentity
            // resolver maps model strings to a vendor initial — match
            // any session whose initial equals the pinned letter (with
            // unknowns folded to '?').
            const matchAliases = [...onlineNodes, ...offlineNodes]
              .filter(s => {
                const v = vendorForModel(s.model);
                return (v.id === 'unknown' ? '?' : v.initial) === pinnedVendor;
              })
              .map(s => s.alias);
            const matchPreview = matchAliases.slice(0, 8).join(', ');
            const matchSuffix = matchAliases.length > 8 ? ` + ${matchAliases.length - 8} more` : '';
            return (
            <span
              data-active-filter="vendor"
              data-filter-match-count={matchCount}
              data-filter-match-aliases={matchAliases.join(',')}
              // R355 sibling — `group` parent + group-hover on inner spans.
              // R495 — filter pills (3 sibling `group` variants) join the
              // active:scale-95 press-feedback family. R490's !important
              // transition list on .anet-topo-chip-focus already covers
              // transform, so just appending active:scale-95 to the
              // className wires the press tactile in one token. Compound
              // with R400-era hover:-translate-y-px gives lift-and-compress.
              className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono font-medium text-xs border anet-fade-in anet-topo-chip-focus transition-transform duration-200 ease-out hover:-translate-y-px active:scale-95 transform-gpu" data-topo-filter-pill-hover-lift="true"
              title={matchCount > 0 ? `${matchPreview}${matchSuffix} — click to clear` : 'Click to clear vendor filter'}
              onClick={() => setPinnedVendor(null)}
              style={{
                background: `${vendorColor}1f`,
                color: vendorColor,
                borderColor: 'currentColor',
                cursor: 'pointer',
              }}
            >
              {/* R412: see status pill above — filter value fw=600 data tier. */}
              <span><span className="hidden sm:inline opacity-70 transition-opacity duration-200 group-hover:opacity-100" data-filter-prefix>filter: </span><span className="font-semibold" data-filter-value>{pinnedVendor}</span><span className="opacity-70 tabular-nums transition-opacity duration-200 group-hover:opacity-100" data-filter-pill-count> · {matchCount}</span></span>
              <button
                type="button"
                aria-label={`Clear vendor filter ${pinnedVendor}`}
                onClick={(e) => { e.stopPropagation(); setPinnedVendor(null); }}
                /* Round 356 / Loop: filter pin pill × buttons gain
                   hover:scale-110 (Tailwind 4 modern CSS `scale` property,
                   not legacy transform). Sibling polish to R354 vendor
                   letter glyph + R350/R352/R353 chrome icon hover-scales.
                   Pre-R356 the × had only hover:opacity-70 — the target
                   dimmed under cursor but didn't lift. R356 adds a 10 %
                   scale on hover so the click-target reads as "press me"
                   alongside the dim. transform-gpu hint promotes the
                   button to its own compositor layer for crisper edges
                   during the scale tween. transition-transform duration-
                   200 matches the chrome icon hover-scale timing family.
                   inline-block is default for <button> so no display
                   tweak needed. replace_all covers all 4 filter pin
                   pills (status / group / vendor / edge) at once. */
                className="ml-0.5 leading-none hover:opacity-70 transition-transform duration-200 ease-out hover:scale-110 transform-gpu"
                style={{ background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
              >×</button>
            </span>
            );
          })()}
          {/* R119: edge pin filter pill — completes the R64 / R89 pill
              pattern across all four pin dimensions. R116 added
              pinnedEdgeKey but the chip row never grew the matching
              pill, leaving the locked flow visible only on the canvas +
              recent-signal row tint. This pill shows "filter:
              alpha→beta · 3" so the locked flow appears in the same
              row as the other three pin types. Body-click + × button
              clear, same pattern as R64. */}
          {pinnedEdgeKey && (() => {
            const link = flowLinks.find(l => l.key === pinnedEdgeKey);
            if (!link) return null;
            // R150 / Loop: extend the hot-lane amber convention from the
            // canvas badge (R126) / recent-row count (R127) / panel
            // header (R129) to the R119 edge filter pill — when the
            // pinned edge has count ≥ 10 the count tspan flips to
            // amber + 700 weight, and the tooltip grows a "(hot lane
            // · ≥ 10)" marker. Closes the 4th hot-lane surface,
            // completing R150's milestone: every place that surfaces
            // an edge count now uses the same amber-when-hot vocab.
            const isHot = link.count >= 10;
            const hotStroke = isLight ? '#d97706' : '#fbbf24';
            return (
            <span
              data-active-filter="edge"
              data-filter-match-count={link.count}
              data-filter-match-aliases={`${link.from},${link.to}`}
              data-active-filter-edge-hot={isHot ? 'true' : 'false'}
              // R495 sibling — 4th filter pill (no `group` prefix variant)
              // joins active:scale-95 press family alongside the 3 group
              // variants above. Same recipe.
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono font-medium text-xs border anet-fade-in anet-topo-chip-focus transition-transform duration-200 ease-out hover:-translate-y-px active:scale-95 transform-gpu" data-topo-filter-pill-hover-lift="true"
              title={`${link.from} → ${link.to} (${link.count} msg${link.count === 1 ? '' : 's'}${isHot ? ', hot lane · ≥ 10' : ''}) — click to clear`}
              onClick={() => setPinnedEdgeKey(null)}
              style={{
                background: isLight ? `${pal.flowEdge}14` : `${pal.flowEdge}1f`,
                color: pal.flowEdge,
                borderColor: 'currentColor',
                cursor: 'pointer',
              }}
            >
              {/* R412: filter pin pill value (edge variant) picks up fw=600.
                  Sibling treatment to the status/group/vendor pills above. */}
              <span>
                <span className="hidden sm:inline opacity-70" data-filter-prefix>filter: </span>
                <span className="font-semibold" data-filter-value>{link.from}→{link.to}</span>
                {/* Round 323 / Loop: edge filter pill count digit picks
                    up tabular-nums (Tailwind class on both cold +
                    hot branches). Sibling treatment to the status /
                    group / vendor pin pills (R323 replace_all upstream
                    in this same round added `tabular-nums` to those
                    three pills' count spans). Pre-R323 a matchCount /
                    link.count crossing 9→10 widened the digit and
                    shifted the trailing × button right ~3px in font-
                    mono (mono digits still have natural-vs-tabular
                    variance). Locks the slot so the × button stays
                    planted as the count grows. 9th surface in the
                    info-density tabular-nums sweep after R322 panel
                    hot count. */}
                {isHot ? (
                  <span
                    className="opacity-90 tabular-nums"
                    style={{ color: hotStroke, fontWeight: 700 }}
                    data-active-filter-edge-count-hot
                  >
                    {' · '}{link.count}
                  </span>
                ) : (
                  <span className="opacity-70 tabular-nums" data-active-filter-edge-count>
                    {' · '}{link.count}
                  </span>
                )}
              </span>
              <button
                type="button"
                aria-label={`Clear edge filter ${link.from} → ${link.to}`}
                onClick={(e) => { e.stopPropagation(); setPinnedEdgeKey(null); }}
                /* Round 356 / Loop: filter pin pill × buttons gain
                   hover:scale-110 (Tailwind 4 modern CSS `scale` property,
                   not legacy transform). Sibling polish to R354 vendor
                   letter glyph + R350/R352/R353 chrome icon hover-scales.
                   Pre-R356 the × had only hover:opacity-70 — the target
                   dimmed under cursor but didn't lift. R356 adds a 10 %
                   scale on hover so the click-target reads as "press me"
                   alongside the dim. transform-gpu hint promotes the
                   button to its own compositor layer for crisper edges
                   during the scale tween. transition-transform duration-
                   200 matches the chrome icon hover-scale timing family.
                   inline-block is default for <button> so no display
                   tweak needed. replace_all covers all 4 filter pin
                   pills (status / group / vendor / edge) at once. */
                className="ml-0.5 leading-none hover:opacity-70 transition-transform duration-200 ease-out hover:scale-110 transform-gpu"
                style={{ background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 }}
              >×</button>
            </span>
            );
          })()}
          {/* Round 124 / Loop: pin-intersection summary chip. The four
              filter pills (R64 status, R63 group, R89 vendor, R119
              edge) each report their own dim's match count in
              isolation — that answers "what does THIS filter catch"
              but not "what survives ALL pins". Since the node-opacity
              chain AND-composes the four pin dimensions, two active
              pins routinely produce an intersection smaller than
              either individual count. With three or four pins active
              the gap widens further. This chip appears ONLY when
              ≥ 2 pin dims are active (a single pin's pill already
              tells the whole story) and shows the count of nodes
              that satisfy every active pin simultaneously. Color is
              deliberately neutral (gray) since the chip represents
              the AND of mixed-color filters — borrowing any one of
              the pill hues would mis-signal which dim dominates.
              Tooltip lists the surviving aliases with the same
              8-truncate + "+N more" pattern as the individual pill
              tooltips (R97). No click handler — it's a pure readout;
              Esc / per-pill × are still the cancel paths. */}
          {(() => {
            const pinDimCount =
              (pinnedStatus  ? 1 : 0) +
              (pinnedGroup   ? 1 : 0) +
              (pinnedVendor  ? 1 : 0) +
              (pinnedEdgeKey ? 1 : 0);
            if (pinDimCount < 2) return null;
            const edgeLink = pinnedEdgeKey
              ? flowLinks.find(l => l.key === pinnedEdgeKey)
              : null;
            const edgeEndpoints: Set<string> | null = edgeLink
              ? new Set([edgeLink.from, edgeLink.to])
              : null;
            const allSessions = [...onlineNodes, ...offlineNodes];
            const survivors = allSessions.filter(s => {
              const isOnline = s.status !== 'offline';
              if (pinnedStatus === 'working' && s.status !== 'working') return false;
              if (pinnedStatus === 'idle'    && !(isOnline && s.status !== 'working')) return false;
              if (pinnedStatus === 'offline' && isOnline) return false;
              if (pinnedGroup) {
                const gk = groupKeys[s.alias] ?? s.alias;
                if (gk !== pinnedGroup) return false;
              }
              if (pinnedVendor) {
                const v = vendorForModel(s.model);
                const initial = v.id === 'unknown' ? '?' : v.initial;
                if (initial !== pinnedVendor) return false;
              }
              if (edgeEndpoints && !edgeEndpoints.has(s.alias)) return false;
              return true;
            });
            const matchAliases = survivors.map(s => s.alias);
            const matchPreview = matchAliases.slice(0, 8).join(', ');
            const matchSuffix  = matchAliases.length > 8 ? ` + ${matchAliases.length - 8} more` : '';
            const isEmpty = matchAliases.length === 0;
            const tooltip = !isEmpty
              ? `${matchPreview}${matchSuffix} — nodes passing all ${pinDimCount} pinned filters`
              : `No nodes pass all ${pinDimCount} pinned filters — release one to widen (Esc clears all)`;
            // R125: when the intersection drops to zero, the chip flips
            // from neutral gray to a warning amber. Zero-overlap is the
            // exact case users get confused — canvas dims to 0.28
            // everywhere, no positive signal explains why. The "· 0"
            // tail in neutral gray reads as just another number,
            // indistinguishable from "· 12". Amber + a ⚠ glyph lifts
            // it to "your filters cancel out" at a glance. Color
            // choice: amber (#d97706 light, #fbbf24 dark) — same hue
            // family as warning chips elsewhere in the dashboard,
            // distinct from any pill color (status green/teal/slate,
            // group cyan, vendor varies, edge cyan, neutral gray for
            // non-empty intersection) so the empty state stands out.
            const emptyColor = isLight ? '#d97706' : '#fbbf24';
            return (
              <span
                data-pin-intersection
                data-pin-dim-count={pinDimCount}
                data-pin-intersection-count={matchAliases.length}
                data-pin-intersection-empty={isEmpty ? 'true' : 'false'}
                data-pin-intersection-aliases={matchAliases.join(',')}
                /* Round 235 / Loop: pin-intersection chip joins the
                   info-density tabular-nums sweep. The chip has TWO
                   digits visible at once — '{pinDimCount} pins ·
                   {matchAliases.length}' — and the matchAliases count
                   in particular rolls frequently as filters tighten /
                   widen against the live fleet. font-mono already
                   makes the digits uniform-ish, but tabular-nums
                   further locks digit width within the mono cell so
                   the gap between 'pins' and '·' stays stable, and
                   the chip's overall width doesn't bump when either
                   number changes. 9th surface in the sweep — the
                   third and last HTML chip surface, completing
                   coverage across chip-row + vendor-row + pin-
                   intersection. */
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-mono tabular-nums text-xs border anet-fade-in anet-topo-chip-focus"
                title={tooltip}
                /* Round 236 / Loop: smooth the empty/non-empty colour
                   crossing. Pre-R236 the chip snap-flipped between
                   slate-on-slate (non-empty filter intersection) and
                   amber-on-amber (empty intersection — the 'your
                   pinned filters cancel out' warning). bg, color,
                   and borderColor (which inherits currentColor) all
                   changed in one frame. R236 adds a 200ms ease-out
                   transition on all three so when a filter tightens
                   matches across the 0-boundary the chip eases
                   through the colour shift instead of snapping. Same
                   200ms cadence the other chip-row members use
                   (R201 working/online tint, R193 active-links
                   tint, R202 vendor letter color-mix). One more
                   surface where colour state-changes ease rather
                   than snap — consistent with the topology's
                   broader transitions vocabulary. */
                style={{
                  background: isEmpty
                    ? (isLight ? '#d97706' + '14' : '#fbbf24' + '1f')
                    : (isLight ? '#94a3b814' : '#94a3b81f'),
                  color: isEmpty
                    ? emptyColor
                    : (isLight ? '#475569' : '#9ca3af'),
                  borderColor: 'currentColor',
                  transition: 'background-color 200ms ease-out, color 200ms ease-out, border-color 200ms ease-out',
                }}
              >
                <span>
                  <span className="hidden sm:inline opacity-70" data-pin-intersection-prefix>match: </span>
                  {/* Round 324 / Loop: pin-intersection chip carries TWO
                      numeric counts in one breath — pinDimCount ("how
                      many filter pins are active") and matchAliases.
                      length ("how many aliases land in the intersection
                      after pins compose"). Both jitter on digit-width
                      crossings (1→10 etc) without tabular-nums even
                      under font-mono. Pre-R324 a fleet busying up so
                      one dimension flips from 0→non-zero (chip mounts
                      via R237 always-mount opacity gate) AND the match
                      count digit ticks 9→10 simultaneously visibly
                      jolted the trailing `× pins` / ` × ` segments.
                      Two dedicated tabular-nums spans (one per count)
                      lock both digit slots so the chip's text geometry
                      stays planted through both crossings. 10th
                      surface in the info-density tabular-nums sweep
                      after R323 filter pin pill counts (R64/R89/R119/
                      R150 pin-pill family parity now complete with
                      this composed-pin sibling). data-pin-intersection-
                      count-* attrs expose both spans for tests. */}
                  {/* Round 341 / Loop: middle " pins" unit word
                      previously sat as a bare text node between the
                      two count spans, while the matches-count span
                      already carried opacity-0.7 (R335 + R324 era).
                      The pinDimCount span is prominent and the
                      matches count is recessive — but the literal
                      " pins" was at FULL opacity, breaking the
                      chip-internal hierarchy unified across R333/
                      R335/R336/R337/R338/R340. R341 wraps " pins"
                      in an opacity-0.7 span so the chip reads:
                        pinDimCount (prominent value)
                        " pins"     (recessive unit)
                        " · {N}"    (recessive count)
                      Three-tier hierarchy on a single chip; 7th
                      surface in the chip-internal-hierarchy arc. */}
                  <span className="tabular-nums" data-pin-intersection-count-dims>{pinDimCount}</span><span className="opacity-70" data-pin-intersection-unit> pins</span><span className="opacity-70 tabular-nums" data-pin-intersection-count-matches> · {matchAliases.length}</span>
                  {/* Round 237 / Loop: ⚠ warning glyph picks up the
                      always-mount-opacity-gate idiom. Pre-R237 the
                      glyph was conditionally rendered on isEmpty,
                      snap-mounting when filter intersection
                      narrowed to 0 AND introducing a layout shift
                      (ml-1 margin appears alongside the glyph,
                      widening the chip by ~16px). The R236 color
                      easing made the colour crossing smooth but
                      the glyph still pop-jumped, breaking the
                      polish that R236 just installed at this
                      same chip.

                      Always-mount the glyph with opacity gated by
                      isEmpty + the same 200ms ease-out that R236
                      uses on the chip's colour transition. Now the
                      whole isEmpty crossing — bg, color, border,
                      AND glyph visibility — eases as one
                      coordinated 200ms event. ml-1 margin is
                      reserved permanently, so the chip width
                      stays stable through the crossing (no
                      layout-shift jank against neighbouring
                      chips). data-pin-intersection-warning attr
                      surfaces the visibility state for test
                      introspection. 11th surface in the always-
                      mount-opacity-gate family (R181 / R182 /
                      R183 / R213 ×2 / R214 / R215 / R221 / R222 /
                      R223 / R237). */}
                  <span
                    className="ml-1"
                    aria-hidden
                    data-pin-intersection-warning={isEmpty ? 'true' : 'false'}
                    style={{ opacity: isEmpty ? 1 : 0, transition: 'opacity 200ms ease-out' }}
                  >⚠</span>
                </span>
              </span>
            );
          })()}
          {/* Round 281 / Loop: vendor letters chip threshold tightens
              from >1 to >2 per 减法 cut #7. Pre-R281 the chip showed
              whenever ≥2 vendor types existed in the fleet — for a
              typical demo (claude + 1 other = 2 types), the chip
              rendered "A:N C:M" adding ~50-80px to the chip-row width.
              Tightening to >2 keeps the chip useful for fleets with
              ACTUAL vendor diversity (3+ types) where the
              composition matters at a glance, but hides it for the
              common 1-2 vendor case where the info is low-signal.
              Continues the R275-R280 simplification arc. */}
          {vendorDist.length > 2 && (
            <span
              className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-gray-500/10 text-gray-400 border border-gray-500/20 font-mono"
              title="Hover to highlight; click to pin"
            >
              {vendorDist.map(v => {
                const isPinned = pinnedVendor === v.initial;
                // R88: click toggles a sticky filter the same way R60
                // pressure-bar segments toggle pinnedStatus. Visual
                // mirror = inset boxShadow using the vendor's own
                // colour, so each pinned letter sings in its own hue
                // (Anthropic green / OpenAI cyan / 书 blue / ?).
                // R101: tooltip lists the aliases that use this vendor —
                // completes the info-density triple started by R97 pills,
                // R98 node titles, R99 group-label titles. Anywhere the
                // UI shows "A:3" should hover-explain which 3.
                const aliases = [...onlineNodes, ...offlineNodes]
                  .filter(s => {
                    const vid = vendorForModel(s.model);
                    return (vid.id === 'unknown' ? '?' : vid.initial) === v.initial;
                  })
                  .map(s => s.alias);
                const preview = aliases.slice(0, 8).join(', ');
                const suffix = aliases.length > 8 ? ` + ${aliases.length - 8} more` : '';
                const tooltip = isPinned
                  ? `${preview}${suffix} — click again or Esc to clear`
                  : `${preview}${suffix} — click to pin`;
                return (
                  <span
                    key={v.initial}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isPinned}
                    /* Round 234 / Loop: vendor letter chip picks up
                       tabular-nums to lock the ':N' suffix's digit
                       width. Each vendor chip renders 'A:3', 'C:2',
                       etc. inline at gap-0.5 — when one vendor's
                       count rolls 9→10 the chip widens by the digit
                       glyph delta and pushes downstream chips right,
                       making the row visibly jitter. 8th surface
                       in the info-density tabular-nums sweep,
                       completing the HTML chip-side coverage after
                       R232 working/online/active-links chips. The
                       digit lives in the inner <span> at line 2194,
                       but font-variant-numeric inherits, so applying
                       it at the outer chip span reaches every
                       descendant glyph for free. */
                    /* Round 314 / Loop: vendor letter chip joins the
                       R312-R313 'HTML-context data chip = font-medium'
                       family. R313 weighted the 3 main chips
                       (working/online/active-links); R314 closes the
                       chip-row weight sweep by extending to the
                       vendor letter chips ('A:N', 'O:N', '书:N',
                       '?:N'). They display vendor-distribution
                       data; same tier as the sibling data chips. */
                    /* Round 401 / Loop: vendor letter chip closes the
                       hover-lift gesture family at its last unaddressed
                       interactive HTML surface. R397/R398/R399 lifted
                       filter pin pills + chip-row chips (working /
                       online / active-links); R400 lifted standalone
                       chrome buttons (reset / fullscreen). The vendor
                       letter chips (A:N / O:N / 书:N / ?:N) are
                       sibling interactive chips in the same chip-row
                       — clickable to toggle the vendor filter pin —
                       but were not yet on the hover-lift family.
                       R401 closes the gap with hover:-translate-y-px
                       + transition-transform + transform-gpu added
                       to the className. The inline transition list
                       (box-shadow + background-color) keeps eaching
                       independently — different property axes compose
                       cleanly. Existing R354 glyph scale-1.1 (inner
                       span) + R202 chip bg color-mix + R180 pin-mirror
                       box-shadow + R354 glyph hover transform all
                       preserved. data-vendor-letter-hover-lift attr
                       surfaces the lift for tests. */
                    // R417: `group` parent enables the count suffix to
                    // brighten on chip hover via group-hover:opacity-100
                    // — sibling to R355 filter-pill prefix/suffix + R414
                    // chip-row unit brighten. Closes the inner-span
                    // hover-brighten family at the vendor chip surface.
                    // R496 — vendor letter chip joins active:scale-95 press
                    // family. Last vendor-row clickable joining the family
                    // R495 cashed via R490's transition-cascade dividend.
                    // Same compound w/ R401 hover-lift idiom — lift-and-
                    // compress on press, springs back on release.
                    className="group tabular-nums font-medium inline-flex items-baseline gap-0.5 px-1 rounded anet-topo-chip-focus transition-transform duration-200 ease-out transform-gpu hover:-translate-y-px active:scale-95"
                    data-vendor-letter={v.initial}
                    data-vendor-letter-count={v.count}
                    data-vendor-letter-hover-lift="true"
                    data-vendor-pinned={isPinned ? 'true' : 'false'}
                    data-vendor-hovered={hoveredVendor === v.initial ? 'true' : 'false'}
                    data-vendor-aliases={aliases.join(',')}
                    title={tooltip}
                    // R180: smooth-pin-mirror family — see working chip above.
                    // Round 202 / Loop: vendor letter chip joins the "hover
                    // deepens own identity hue" family R193/R195/R201 built
                    // up across the rest of the chip row. Pre-R202 hovering
                    // a vendor letter (A/C/G/K/书/?) fired R88 canvas dim
                    // via setHoveredVendor, but the chip itself stayed at
                    // bg=transparent — cause silent, effect loud. R202
                    // tints the chip with its OWN vendor colour at 12%
                    // alpha via color-mix() so each vendor's chip lights
                    // up in its own hue (Anthropic green / OpenAI cyan /
                    // 书 blue / ?). No layout shift: only background-color
                    // changes, no border/padding swap. transition list
                    // extends the existing R180 box-shadow 150ms with
                    // background-color 200ms ease-out (same splice idiom
                    // R201 used on the working/online chips). color-mix()
                    // is supported Chrome ≥ 111 / Safari ≥ 16.2 / FF ≥ 113;
                    // for older browsers the chip falls back to its idle
                    // transparent bg (graceful degradation — the canvas-
                    // dim effect still fires regardless).
                    style={{
                      cursor: 'pointer',
                      backgroundColor: (hoveredVendor === v.initial && !isPinned)
                        ? `color-mix(in srgb, ${v.color} 12%, transparent)`
                        : 'transparent',
                      boxShadow: isPinned
                        ? `inset 0 0 0 1px ${v.color}, inset 0 0 0 2px rgba(255,255,255,0.45)`
                        : undefined,
                      transition: 'box-shadow 150ms ease-out, background-color 200ms ease-out',
                    }}
                    onMouseEnter={() => setHoveredVendor(v.initial)}
                    onMouseLeave={() => setHoveredVendor(prev => prev === v.initial ? null : prev)}
                    onClick={() => setPinnedVendor(prev => prev === v.initial ? null : v.initial)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPinnedVendor(prev => prev === v.initial ? null : v.initial);
                      }
                    }}
                  >
                    {/* Round 354 / Loop: vendor letter glyph scales
                        1.0 → 1.1 on hover. R88 already dims OTHER
                        vendors on hover via canvas-wide opacity
                        masking; R202 added a chip-level bg tint
                        (color-mix 12 % alpha) so the chip itself
                        responds. R354 closes the trio with a glyph-
                        level lift: the focused vendor LETTER actively
                        rises (transform scale) rather than the chip
                        merely changing colour. Three layers of positive
                        feedback on the hovered vendor + canvas-wide
                        negative feedback on the others — a clean
                        figure/ground separation.

                        display: inline-block is required for transform
                        to apply (inline elements ignore transform).
                        transformOrigin: 'center' so the glyph pivots
                        around its centre instead of arcing from the
                        baseline anchor. transition rides the existing
                        Tailwind 4 transform/scale list (no new
                        property — Tailwind already lists transform in
                        the default transition-property set). 200ms
                        matches the R202 chip bg-tint timing so the
                        glyph lift and chip background ease in concert. */}
                    {/* Round 369 / Loop: vendor letter glyph picks up
                        fontWeight 600 (font-semibold). The glyph is the
                        vendor identifier — the DATA the operator scans
                        in this chip (A / O / 书 / C / G / ?). R333 set
                        the count suffix `:N` to text-gray-400 + tabular-
                        nums and (via parent inheritance) fw 500. Pre-
                        R369 the LETTER also inherited fw 500 from the
                        chip's font-medium — letter and count read at
                        the same weight, contradicting the data-vs-label
                        hierarchy the rest of the chip-row already speaks.
                        R369 lifts the letter to fw 600 so the chip now
                        reads as the same two-tier pattern R362 closed
                        on the working / online / active-links chips:
                          chip      digit/letter  fw 600  (data)
                          chip      unit/count    fw 500  (label)
                        Sibling treatment to R362 — extends the R333-R341
                        chip-internal-hierarchy arc to the vendor-letter
                        chip surface (9th surface family). R354 transform-
                        scale-on-hover + R88 canvas-dim-others + R202
                        chip bg color-mix all preserved on the same span.
                        data-vendor-letter-glyph-font-weight attr exposes
                        the value for tests. */}
                    <span
                      data-vendor-letter-glyph={v.initial}
                      data-vendor-letter-glyph-hover={hoveredVendor === v.initial ? 'true' : 'false'}
                      data-vendor-letter-glyph-font-weight="600"
                      style={{
                        color: v.color,
                        display: 'inline-block',
                        fontWeight: 600,
                        transform: hoveredVendor === v.initial ? 'scale(1.1)' : 'scale(1)',
                        transformOrigin: 'center',
                        transition: 'transform 200ms ease-out',
                      }}
                    >{v.initial}</span>
                    {/* Round 333 / Loop: vendor count suffix `:{N}` joins
                        the R317 subordinate-text-lift family (gray-500 →
                        gray-400) plus picks up tabular-nums for digit
                        width-lock. Pre-R333 a vendor whose count
                        crossed 9→10 widened the suffix and (since the
                        parent chip has `px-2.5` padding but no fixed
                        width) shifted the chip-row's downstream chips
                        a couple px right. Tabular-nums locks the slot;
                        gray-400 lifts the digit into the band where eye
                        reads it as "deliberate subordinate metadata"
                        rather than near-invisible chrome. data-vendor-
                        letter-count exposes the span for tests. */}
                    {/* R417: count suffix opacity-70 + group-hover:
                        opacity-100 brightens on chip hover. Inner-span
                        hover-brighten family (3rd anchor) — sibling to
                        R355 filter pill prefix/suffix and R414 chip-row
                        unit. Effective shade at rest: text-gray-400 ×
                        70 % alpha; on hover: full gray-400. The label-
                        tier-vs-glyph differentiation persists on hover
                        since the glyph (R369 fw=600) stays at full
                        opacity. R333 :{count} format preserved. */}
                    <span
                      className="text-gray-400 tabular-nums opacity-70 transition-opacity duration-200 group-hover:opacity-100"
                      data-vendor-letter-count-suffix
                    >:{v.count}</span>
                  </span>
                );
              })}
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
            // R114: tooltip lists the actual flows. Closes the
            // info-density sweep on the last chip-row hover surface
            // (R97-R113 covered everything else). Format:
            //   "alpha→beta (3), gamma→delta (1) — hover brightens all"
            // Truncates at 6 flows with "+N more" so a busy fleet
            // doesn't paint a tall tooltip; the recent-signal panel
            // already shows the top 3 in detail.
            const flowList = flowLinks
              .slice(0, 6)
              .map(l => `${l.from}→${l.to} (${l.count})`)
              .join(', ');
            const flowSuffix = flowLinks.length > 6 ? ` + ${flowLinks.length - 6} more` : '';
            // R136: the chip already had cursor:pointer when flowLinks
            // > 0 (line 1877) — but no onClick was wired. The cursor
            // lied; users got the affordance signal with no follow-
            // through. Wire it to /messages, mirroring R133's footer-
            // nav idiom. Hover (R77) keeps its semantic "preview all
            // flows on canvas"; click is the action "open the full
            // list". Two distinct gestures, both meaningful. The
            // tooltip grows a "click to open" tail when interactive.
            // Drop the chip out of click territory entirely when
            // flowLinks is empty — no flows = no list to open.
            const isInteractive = flowLinks.length > 0;
            const tooltip = !isInteractive
              ? undefined
              : `${flowList}${flowSuffix} — hover brightens all · click to open /messages`;
            return (
              // Round 193 / Loop: the chip itself adopts a subtle cyan
              // tint on its own hover, mirroring the cyan flowEdge
              // highlight it fires on the canvas. Pre-R193 the gesture
              // was visually asymmetric:
              //   hover this chip → canvas edges brighten (cyan)
              //   chip itself     → stays gray (silent)
              // The *cause element* (chip) gave no response while the
              // *effect element* (canvas edges) painted loud. Same
              // pin-mirror logic R165 / R180 use on the four other
              // chip-row surfaces — the chip and the canvas edge it
              // pins should speak the same color vocabulary. Tailwind
              // :hover variant cyan-500/10 bg + cyan-500/30 border +
              // cyan-200 text matches the same palette R178/R163 use
              // for the active chrome buttons. transition-colors
              // duration-200 blends the swap smoothly. Hover variant
              // only attaches when isInteractive — a chip showing
              // "0 active links" has no list to open and should
              // stay gray. data-active-links-clickable already
              // exposes that gate to tests.
              <span
                // Round 206 / Loop: extend the R204/R205 empty-recede
                // family to the active-links chip. Pre-R206 "0 active
                // links" rendered at the same bg-gray-500/10 + full
                // opacity as "12 active links" — same eye-no-signal
                // problem the legend count (R204) and working/online
                // chips (R205) just solved at their own grain levels.
                // Inline opacity 0.5 when !isInteractive (flowLinks=0)
                // joins R136's already-removed cursor + R114's tooltip-
                // text gate to give the empty state visual + interactive
                // + affordance signals in lockstep.
                // Tailwind transition-colors duration-200 on className
                // would be overridden by the inline transition list, so
                // we replicate color/bg/border transitions inline
                // alongside the new opacity 200ms — same splice idiom
                // R201 used on the working/online chips.
                /* Round 232 / Loop: tabular-nums on active-links chip
                   (third chip in the row — matches working + online
                   chip treatment so all three digits in the chip row
                   stay width-stable across counter crossings). */
                /* Round 399 / Loop: active-links chip closes the 3-chip
                   chip-row by extending R398's hover translateY(-1px)
                   lift onto the third (rightmost) chip. The R398 family
                   already covered working + online chips on the
                   clickable variant; R399 adds the same gate (isInter-
                   active = flowLinks.length > 0) so empty active-links
                   stays planted at R206's opacity-50 receded paint.
                   transition-transform + ease-out + transform-gpu join
                   the inline transition list (different property axes
                   compose cleanly: inline handles color/bg/border/
                   opacity, className handles transform).
                   Gesture-vocabulary table (post-R399 — now complete
                   across the chip-row):
                     working chip      -1 px  (R398)
                     online chip       -1 px  (R398)
                     active-links chip -1 px  (R399, this round)
                     filter pin pills  -1 px  (R397)
                     recent-signal row -1 px  (R143)
                     legend row        -1 px  (R144)
                   Every interactive chip in TopoGraph lifts on hover.
                   data-chip-hover-lift attr exposes the lift surface
                   state ('true' clickable, 'false' empty) for tests. */
                // R414: `group` parent + inner unit span group-hover-brighten — see working chip above.
                // R496 — active-links chip joins active:scale-95 press
                // family. Sibling to working+online chips (R494). Gated
                // on `isInteractive` (flowLinks.length > 0) — same R399
                // conditional pattern used for hover-lift.
                className={`group tabular-nums font-medium hidden sm:inline px-2.5 py-1 rounded-md border anet-topo-chip-focus transition-transform duration-200 ease-out transform-gpu ${
                  isInteractive
                    ? 'bg-gray-500/10 text-gray-400 border-gray-500/20 hover:bg-cyan-500/10 hover:text-cyan-200 hover:border-cyan-500/30 hover:-translate-y-px active:scale-95'
                    : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                }`}
                data-chip-hover-lift={isInteractive ? 'true' : 'false'}
                data-chip-group-hover-brighten="true"
                data-active-links-chip
                data-active-links-flow-count={flowLinks.length}
                data-active-links-clickable={isInteractive ? 'true' : 'false'}
                data-active-links-empty={isInteractive ? 'false' : 'true'}
                title={tooltip}
                role={isInteractive ? 'link' : undefined}
                tabIndex={isInteractive ? 0 : undefined}
                style={{
                  cursor: isInteractive ? 'pointer' : undefined,
                  opacity: isInteractive ? 1 : 0.5,
                  transition: 'color 200ms ease-out, background-color 200ms ease-out, border-color 200ms ease-out, opacity 200ms ease-out',
                }}
                onMouseEnter={() => { if (isInteractive) setHoveredActiveLinks(true); }}
                onMouseLeave={() => setHoveredActiveLinks(false)}
                onClick={() => { if (isInteractive) router.push('/messages'); }}
                onKeyDown={(e) => {
                  if (!isInteractive) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push('/messages');
                  }
                }}
              >
                {/* R338 — active-links chip digit/unit split, completes
                    the 5th chip surface in the R333/R335/R336/R337
                    chip-internal-hierarchy arc. data-active-links-
                    chip-unit exposes the unit span for tests. */}
                {/* R362 sibling — active-links chip digit gains font-semibold. */}
                <span className="font-semibold transition-[font-weight] duration-200 group-hover:font-bold" data-active-links-chip-digit>{flowLinks.length}</span><span className="opacity-70 transition-opacity duration-200 group-hover:opacity-100" data-active-links-chip-unit> active link{flowLinks.length === 1 ? '' : 's'}</span>
                {rel ? (() => {
                  // Round 161 / Loop: extend R160's recency-pip
                  // vocabulary up one scope — from per-flow row to
                  // fleet-aggregate chip. The chip already shows
                  // recency in text ("last 5s ago"); the " · "
                  // separator bullet was dead gray. Color the
                  // bullet by freshness using the same alpha
                  // ramp R160 uses on recent-signal rows:
                  //   ageSec ≤ 30   → 1.0 (fully fresh)
                  //   30-300s       → smooth decay 1.0 → 0.25
                  //   > 300s        → 0.25 (stale floor)
                  // Cyan bullet pulse when fresh + gray text tail
                  // = "is the network firing right now" readable
                  // at a glance, without parsing the timestamp
                  // numerals. Same vocabulary the canvas uses
                  // (R10 edge fade) and the recent-signal panel
                  // uses (R160 row pip) — three nested scopes
                  // now share one freshness ladder.
                  const ageSec = recent !== null
                    ? Math.max(0, (Date.now() - recent) / 1000)
                    : 999;
                  const alpha = ageSec <= 30
                    ? 1
                    : ageSec <= 300
                      ? 1 - ((ageSec - 30) / 270) * 0.70 /* R358: floor 0.25 → 0.30 lift across 3 freshness scopes */
                      : 0.30; /* R358: stale floor lifted 0.25 → 0.30 — 20% legibility bump while preserving fresh/stale ratio */
                  // Cyan dark / teal light to match palette legendAccent.
                  const dotColor = isLight
                    ? `rgba(13, 148, 136, ${alpha.toFixed(2)})`
                    : `rgba(34, 211, 238, ${alpha.toFixed(2)})`;
                  // Round 342 / Loop: active-links chip freshness suffix
                  // wrapper text-gray-500 → text-gray-400 (R317
                  // subordinate-text-lift family applied to chrome
                  // inactive Layout toggle + R333 vendor count suffix).
                  // The "last 5s ago" suffix is chip-subordinate
                  // metadata; gray-500 sat near-invisible against the
                  // chip's outer color, gray-400 lifts it into the band
                  // where the eye reads it as deliberate freshness
                  // annotation. The freshness DOT keeps its own inline
                  // color: dotColor — the lift only affects the trailing
                  // literal "last {rel}" text.
                  return (
                    // Round 357 / Loop: active-links chip freshness
                    // suffix wrapper picks up `tabular-nums` for digit
                    // width-lock. Pre-R357 the literal "last {rel}"
                    // text (e.g. "last 5s ago", "last 10s ago",
                    // "last 1m ago") had natural-figure digits — the
                    // freshness ticker updates every second, so the
                    // 9→10 boundary on the seconds counter and the
                    // 59→60s → 1m flip both jittered ~1-2 px of glyph
                    // width which propagated through the chip-row's
                    // inline-flex layout, nudging the freshness DOT
                    // and the chip's left edge. Tabular-nums on the
                    // wrapper applies to all descendant digits only
                    // (letters render at natural widths) so the
                    // ticker stays planted across every count cross.
                    // Joins the R224-R232 info-density tabular-nums
                    // sweep at the chip-row freshness scope. Pure
                    // paint-level change, no geometry shift on rest.
                    // The R342 text-gray-400 lift + R161 dot freshness
                    // alpha ramp + R317 subordinate-text-lift family
                    // all preserved. data-active-links-freshness-
                    // wrapper attr exposes the wrapper for tests.
                    <span className="text-gray-400 tabular-nums" data-active-links-freshness-wrapper>
                      <span
                        data-active-links-freshness-dot
                        data-active-links-freshness-alpha={alpha.toFixed(2)}
                        style={{
                          color: dotColor,
                          fontWeight: alpha > 0.7 ? 700 : 400,
                          transition: 'color 200ms ease-out',
                        }}
                      >{' · '}</span>
                      last {rel}
                    </span>
                  );
                })() : null}
              </span>
            );
          })()}
          <FreshnessChip sessions={sessions} />
        </div>
      </div>

      <div
        ref={containerRef}
        /* Round 330 / Loop (milestone): canvas wrapper rounded-lg
           → rounded-xl (8px → 12px corner radius). The biggest
           single surface on the dashboard by pixel area now reads
           as modern-SaaS-contemporary rather than 2020-conservative
           — same 4px bump R197 applied to the legend swatch and
           R295 applied to the title-block crescent. R330 ports
           the gesture to the OUTER envelope.
           Inner content (SVG viewBox 1000×680) sits behind
           `overflow-hidden`, so corner-radius change only affects
           the wrapper's own paint area and the shadow contour;
           the topo-overlap-test reads SVG-internal geometry and is
           unaffected. R254 background-color / R254 border-color /
           R263 box-shadow transitions all carry through unchanged.
           Marks R330 milestone of 5 rounds (R326-R330) of layout-
           geometry polish (gap-tier + crescent fade + trailer
           compensator + corner radius). */
        className={`relative overflow-hidden rounded-xl border shadow-2xl ${isLight ? 'shadow-zinc-900/5' : 'shadow-cyan-950/30'} ${isFullscreen ? 'flex items-center justify-center' : ''}`}
        data-topo-wrapper
        /* Round 254 / Loop: top-level TopoGraph wrapper gains theme-
           toggle transition. This is the BIGGEST theme-driven surface
           on the dashboard by pixel area — pal.containerBg fills the
           entire visible canvas area (cyber #080814 ↔ light #ffffff),
           and pal.containerBorder rims it. Pre-R254 every inner
           element eased through theme but the outer wrapper hard-cut,
           visually anchoring the snap. R253 declared
           "no visible snap remains" prematurely — this wrapper was
           the largest holdout. 200ms ease-out matches the panel
           treatment (R247) so wrapper + panels ease as one unit.

           Round 263 / Loop: close R254's holdover gap — the wrapper's
           shadow-2xl + theme-conditional `shadow-{color}/{opacity}`
           Tailwind class (cyber `shadow-cyan-950/30` ↔ light
           `shadow-zinc-900/5`) ALSO changes on theme toggle, but the
           inline transition list only covered background-color +
           border-color. Result: every inner element eased through
           theme, the wrapper bg/border eased, but the wrapper's
           DROP-SHADOW snapped — a subtle but real holdover from
           R254's "TRULY complete" claim. Adding `box-shadow 200ms
           ease-out` to the transition list catches the className-
           driven box-shadow swap (CSS transition on box-shadow eases
           the shadow property even when its color comes from a
           Tailwind class change, because the property itself is
           transition-eligible regardless of source). */
        style={{
          background: pal.containerBg,
          borderColor: pal.containerBorder,
          transition: 'background-color 200ms ease-out, border-color 200ms ease-out, box-shadow 200ms ease-out',
        }}
      >
        {/* Round 265 / Loop: top-rail (1px-tall colored line at the top
            of the canvas wrapper) picks up theme-toggle transition.
            Pre-R265 the className `bg-gradient-to-r ${pal.topRail
            Gradient}` was theme-conditional — cyber `via-cyan-400/70`
            ↔ light `via-emerald-500/40` — but no inline transition,
            so the rail SNAPPED on theme flip while the wrapper bg
            (R254) + border (R254) + shadow (R263) all eased. The top-
            rail is the THIN BRIGHT LINE that visually anchors the
            canvas top edge — its hard color flip was a small but real
            theme-snap that broke the otherwise-eased canvas envelope.
            transition: background-image catches the className-driven
            gradient swap; Chrome ≥ 89 / Safari ≥ 14.1 / FF ≥ 96
            interpolate linear-gradients with matching stop structures
            (both gradients are `from-transparent via-X to-transparent`
            → same 3-stop layout). data-topo-top-rail makes the probe
            deterministic. */}
        <div
          className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${pal.topRailGradient}`}
          data-topo-top-rail
          style={{ transition: 'background-image 200ms ease-out' }}
        />

        {/* Round 158 / Loop: give the canvas SVG itself an accessible
            name + role description. R151-R157 added a11y to every
            interactive surface inside the canvas (nodes, group labels,
            badges, rows, minimap, chrome buttons) — but the canvas
            container itself was a nameless 1000×680 box. A screen
            reader that hit the SVG before tab-diving into its
            children heard nothing identifying it as "the topology".
            aria-roledescription gives it a meaningful announcement;
            aria-label provides a live snapshot of the network
            (online / working / active links / offline) plus the two
            canvas-scope gestures (Tab + double-click). Default SVG
            role is graphics-document so children remain navigable —
            we deliberately don't override role with "img" which
            would flatten the SVG to a single opaque image. */}
        <svg
          ref={svgRef}
          viewBox="0 0 1000 680"
          className="w-full h-auto block"
          preserveAspectRatio="xMidYMid meet"
          aria-roledescription="agent network topology"
          aria-label={(() => {
            const online = onlineNodes.length;
            const working = workingCount;
            const offline = offlineNodes.length;
            const flows = flowLinks.length;
            const parts: string[] = [];
            parts.push(`${online} agent${online === 1 ? '' : 's'} online`);
            if (working > 0) parts.push(`${working} working`);
            if (offline > 0) parts.push(`${offline} offline`);
            parts.push(`${flows} active link${flows === 1 ? '' : 's'}`);
            return `Agent network topology — ${parts.join(' · ')}. Tab to navigate nodes, double-click canvas to reset view.`;
          })()}
          data-topo-canvas-aria
          /* Round 469 / Loop — fleet-split numeric attrs on the root
             svg. The aria-label already encodes online/working/offline
             /flow counts in text form (R7 origin) but DOM probes had
             to PARSE the label string to extract the numbers. R469
             surfaces them as 4 numeric data-attrs alongside the R462
             dashboard-version + R466 any-hover + R467 any-pinned set
             that already live on the root svg:
               data-topo-online-count      total online sessions
               data-topo-working-count     subset currently working
               data-topo-offline-count     offline / ghost-purged
               data-topo-flow-count        active flow links
             Use cases:
               - Playwright: one-line `svg.getAttribute('data-topo-
                 working-count')` instead of parsing aria-label
               - external CSS: data-attribute selectors for empty
                 vs populated states (`[data-topo-online-count='0']`)
               - a11y enrichment: screen-reader scripts can read the
                 numeric attrs directly
               - hub-aria parity: the hub-center text already shows
                 `workingCount` digit (R130); R469 puts the same scalar
                 on the canvas root for non-visual consumers.
             Composed from existing onlineNodes / workingCount /
             offlineNodes / flowLinks — no new state. */
          /* Round 502 / Loop — categorical density-tier paired with the
             R469 numeric counts. data-topo-fleet-density-tier classifies
             the fleet size into 5 buckets so external consumers (CSS
             selectors, Playwright probes, future density-conditional
             polish gates like R109 dense-label collapse at 16+ nodes)
             can branch on a stable tier name without re-deriving the
             threshold logic from the raw numeric. Buckets:
               'empty'      — onlineNodes.length === 0
               'sparse'     — 1-3 nodes
               'normal'     — 4-15 nodes
               'dense'      — 16-30 nodes  (matches R109 collapse gate)
               'very-dense' — 31+ nodes
             Picks the gate boundaries that already drive CONDITIONAL
             RENDER decisions elsewhere (R109 denseLayout = >16, R110
             plain-text fallback) so the tier name is semantically
             aligned with the visual mode the canvas already switches
             to. Composed from existing onlineNodes — no new state.
             12th attr in the canvas state surface set (R462/R466/R467/
             R469×4/R471×2/R487/R488/R502). 12 attrs covers: build
             identity, transient/sticky inspection modes, fleet split
             numerics, fleet density tier, canvas layout/theme, canvas
             zoom, hover identity. A test harness can snapshot the
             full canvas state with 12 getAttribute calls. */
          data-topo-fleet-density-tier={
            onlineNodes.length === 0 ? 'empty' :
            onlineNodes.length <= 3 ? 'sparse' :
            onlineNodes.length <= 15 ? 'normal' :
            onlineNodes.length <= 30 ? 'dense' :
            'very-dense'
          }
          data-topo-online-count={onlineNodes.length}
          data-topo-working-count={workingCount}
          data-topo-offline-count={offlineNodes.length}
          data-topo-flow-count={flowLinks.length}
          /* Round 471 / Loop — surface 2 remaining canvas-level mode
             attrs alongside the R462/R466/R467/R469 set. Pre-R471 the
             root svg exposed 7 attrs but tests probing "what layout
             is active" had to query DOM internals (data-topo-chrome-
             layout-active on the chrome button row) or parse the URL
             for theme. R471 puts both modes on the root for one-stop
             snapshot reads:
               data-topo-layout — 'ring' | 'grid'
               data-topo-theme  — 'cyber' | 'light'
             Together with R469 the canvas root now carries 9 cross-
             cutting attrs (1 build identity + 2 inspection mode + 4
             fleet split + 2 layout/theme). Test harness can read the
             FULL canvas state with 9 getAttribute calls; no traversal
             into chrome strip / theme provider / panel rows.
             Composed from existing `layout` (R138 ring↔grid toggle
             state) + `isLight` (R12 theme palette gate) — no new
             state, zero re-render cost. */
          data-topo-layout={layout}
          data-topo-theme={isLight ? 'light' : 'cyber'}
          /* Round 487 / Loop — extends R469/R471 root-svg state surface
             with current zoom level (numeric attr, 2 decimals). Pre-
             R487 the canvas zoom was queryable via `data-topo-minimap-
             viewport-glow='true'` boolean (R481, gated at > 1.5) but
             the exact zoom number only lived in the chrome-strip span
             (`{Math.round(view.zoom * 100)}%`). Tests + external CSS
             that need the zoom value had to traverse to the chrome
             strip or read view state via React internals.
             R487 surfaces it at the canvas root, consistent with
             R469's fleet-count numeric pattern. Two-decimal precision
             matches the internal `view.zoom` float without losing
             info. Composed from existing state — no new state.
             Root svg attribute set now 10 attrs total:
               R462 data-dashboard-version    build identity
               R466 data-topo-any-hover       transient mode
               R467 data-topo-any-pinned      sticky mode
               R469 data-topo-online-count    fleet (4 numeric)
               R469 data-topo-working-count
               R469 data-topo-offline-count
               R469 data-topo-flow-count
               R471 data-topo-layout          canvas mode
               R471 data-topo-theme           canvas mode
               R487 data-topo-zoom            canvas zoom */
          data-topo-zoom={view.zoom.toFixed(2)}
          /* Round 488 / Loop — pairs the R466 hover-aggregate BOOLEAN
             with the corresponding hover IDENTITY attr. Pre-R488 a
             test harness could query "is anything hovered" but had to
             traverse per-node `data-node` elements with focus-state
             attrs to recover WHICH alias. R488 surfaces it directly
             at canvas root. Empty string when null (always-present
             attr, consistent with the 10-attr state-surface set —
             never `undefined`-collapsed so observers can rely on a
             single `getAttribute('data-topo-hovered-alias')` returning
             either '' or the alias string).
             Note: only the `hoveredAlias` axis (R466's first source)
             gets the identity twin in R488. The other 5 hover sources
             (hoveredHub / hoveredEdgeKey / hoveredGroupLabel / hovered
             Status / hoveredVendor) are non-alias-shaped (hub center
             is singleton; edge has `from→to` key; status/vendor are
             categorical) — separate dedicated attrs if/when needed.
             Root svg attribute set now 11 attrs total. */
          data-topo-hovered-alias={hoveredAlias ?? ''}
          /* Round 466 / Loop — aggregate hover signal on the root SVG.
             Exposes a single boolean `data-topo-any-hover` that
             reflects whether ANY hover state in the topology is
             active. Composed from the existing per-surface hover
             vars; doesn't introduce new state. Useful for:
               - Playwright tests asserting "topology entered a hover
                 mode" without enumerating per-surface attrs
               - external CSS hooks targeting `[data-topo-any-hover=
                 "true"]` to dim adjacent UI (e.g. chrome strip)
                 while the user is inspecting the canvas
               - debug overlays that visualise hover dwell-time
             The 6 hover sources contributing:
               hoveredAlias       (node circle / card / alias text)
               hoveredHub         (hub center, halo, ring)
               hoveredEdgeKey     (flow link path / particle / endpoint)
               hoveredGroupLabel  (cluster name / count / pips)
               hoveredStatus      (legend row)
               hoveredVendor      (vendor chip in chip row)
             Read-only computed attr — zero re-render cost beyond the
             React update that already fires when any of those state
             vars flips. Geometry / paint untouched. */
          data-topo-any-hover={
            (hoveredAlias || hoveredHub || hoveredEdgeKey || hoveredGroupLabel ||
             hoveredStatus || hoveredVendor) ? 'true' : 'false'
          }
          /* Round 467 / Loop — pin-aggregate sibling to R466 hover-
             aggregate. Exposes `data-topo-any-pinned` reflecting
             whether ANY sticky inspection mode is active. Composed
             from the 4 pinned state vars:
               pinnedStatus    (legend row click → status filter)
               pinnedGroup     (group label click → cluster lock)
               pinnedVendor    (vendor chip click → vendor filter)
               pinnedEdgeKey   (edge click → edge focus)
             Together with R466 the root svg now carries a 2-bit
             inspection-mode surface:
               data-topo-any-hover  — transient (mouse hover)
               data-topo-any-pinned — sticky (click-to-lock)
             Useful for:
               - Playwright tests: one-line query for either mode
               - external CSS hooks: render a persistent "filter
                 active" badge when pinned, distinct from the
                 transient hover dim
               - Esc-handler tests: assert all 4 pins clear after
                 the universal-cancel Escape press (R62/R63/R88/
                 R116 — single Esc collapses every pin)
             Read-only computed disjunction; no new state, zero
             re-render cost beyond the React pin-flip updates. */
          data-topo-any-pinned={
            (pinnedStatus || pinnedGroup || pinnedVendor || pinnedEdgeKey) ? 'true' : 'false'
          }
          /* Round 462 / Loop — surface DASHBOARD_VERSION on the root SVG
             element as `data-dashboard-version`. Directly closes the
             feedback_dash_zombie_port_3000.md memory rule: "verify ships
             via SVG DOM, not tmux 'Ready' — zombie next-servers + stale
             global installs silently serve old code". Pre-R462 the only
             ways to know which preview the dash was serving were:
               1. parse the npm registry for the latest tag (network)
               2. fetch /api/dashboard/version (API surface, no DOM)
               3. inspect the /login footer or /settings page (off-route)
             Test scripts that probe TopoGraph DOM (overlap, group-label
             tint, pip strip, etc.) couldn't tell whether the dash was
             actually serving the build they expected to verify. R462
             threads DASHBOARD_VERSION through to the root <svg> so:
               - Playwright probes can read svg[data-dashboard-version]
                 directly + fail-fast on stale-build mismatch
               - the memory rule's manual zombie check ("inspect SVG
                 dom") becomes a one-attr probe
               - operators DOM-inspect to confirm the live version
                 matches the npm tag without leaving the topology page
             Geometry/visual impact: ZERO (data-* attrs don't paint).
             The version string is build-time injected via the existing
             DASHBOARD_VERSION constant (R51 footer + R51 settings page
             already consume it from app/lib/version.ts → reads
             package.json pkg.version). No business logic added. */
          data-dashboard-version={DASHBOARD_VERSION}
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
            {/* R142 / Loop: drop-shadow filter for group-box hover-lift.
                Mirrors R135's panel hover-elevation idiom but applied
                at the per-group canvas level. R68 already gives a
                hovered/pinned group box a solid accent stroke; R142
                adds a soft outward shadow on top so the box visually
                "rises off the canvas" when selected — same visual
                vocabulary as the panels + the Overview KPI cards
                (R18). Theme-aware flood: darker shadow on cyber so
                it reads above the dark canvas, lighter for light
                theme. Bounding box of the group box is unchanged —
                filters only affect paint area, not bbox geometry, so
                the overlap-test invariant is preserved. */}
            <filter id="topo-groupbox-lift" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow
                dx="0" dy="3" stdDeviation="4"
                floodColor={isLight ? '#0f172a' : '#000000'}
                floodOpacity={isLight ? 0.18 : 0.55}
              />
            </filter>
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
              together. transform order = translate then scale.
              Round 168 / Loop: smoothView arms a one-shot transition on
              the transform attribute, active only when resetView/fitView
              fires. Pan (R103 pointer drag) and wheel zoom never set the
              flag, so they stay snappy with no lag. Pressing `0`, `f`,
              clicking the hub (R52), or chrome reset/fit buttons triggers
              a 300ms ease-out glide instead of a jolt. Respects prefers-
              reduced-motion via the R29 globals.css blanket override that
              neutralises transition-duration universally. */}
          <g
            transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}
            data-topo-viewport
            data-topo-viewport-smooth={smoothView ? 'true' : 'false'}
            data-topo-viewport-layout-switching={layoutSwitching ? 'true' : 'false'}
            data-topo-viewport-nodesize-switching={nodeSizeSwitching ? 'true' : 'false'}
            style={{
              // R170 / Loop: opacity always carries a transition so the
              // layout-switch crossfade fires cleanly. R168 smoothView
              // transition on transform is added only when armed (pan
              // and wheel zoom MUST stay snappy). The two arming flags
              // compose without conflict — different visual axes.
              // R171: nodeSizeSwitching shares the same opacity-dim
              // pathway as layoutSwitching — clicking S/M/L in the
              // chrome triggers the same soft-blink masking. ORing
              // both flags keeps the opacity expression simple while
              // the two distinct data-* attributes let tests
              // disambiguate which gesture armed the crossfade.
              transition: smoothView
                ? 'opacity 250ms ease-out, transform 300ms ease-out'
                : 'opacity 250ms ease-out',
              opacity: (layoutSwitching || nodeSizeSwitching) ? 0.45 : 1,
            }}
          >
          {/* Issue #87: radar/ring ambiance renders only in ring layout —
              grid mode drops it so the concentric rings don't sit behind a
              rectangular grid. */}
          {layout === 'ring' && (<>
          {/* R52: radar bg is pure decoration — drop its pointer events so
              the hub <g> under it (and any future inner-disk affordances)
              can receive clicks. Previously the r=330 disc intercepted
              the hub click outright. */}
          <circle cx={cx} cy={cy} r="330" fill="url(#topo-radar)" style={{ pointerEvents: 'none' }} />

          {/* Round 45: subtle star field — deterministic dots scattered
              across the canvas give the radar bg some depth. Skipped on
              light theme so the white surface stays clean.
              Round 291 / Loop: starfield dot count 28 → 14 (50%
              reduction). Post-R290 inner radar ring retirement the
              canvas has cleared meaningfully — sweep + 3 radar rings
              + tier guides + nodes + edges are doing the visual work.
              The starfield's role is atmospheric depth, not
              information; cutting density by half preserves the
              "space/radar" feel while removing decoration the eye
              has to skip. Same R275-R281 减法 family idiom as the
              orbit / halo / spoke retirements; same R290 pivot back
              to subtractive register. data-topo-starfield-dot
              attribute makes the dots probe-able for the regression
              test. */}
          {!isLight && (
            <g opacity="0.5" style={{ pointerEvents: 'none' }} data-topo-starfield>
              {Array.from({ length: 14 }).map((_, i) => {
                // Deterministic pseudo-random scatter so positions are
                // stable between renders (no JS hydration mismatch).
                const seed = i * 9301 + 49297;
                const x = ((seed * 13) % 1000);
                const y = ((seed * 7) % 680);
                const r = (i % 3 === 0) ? 1.2 : 0.7;
                return <circle key={i} cx={x} cy={y} r={r} fill="#a5b4fc" opacity={0.35 + (i % 4) * 0.05} data-topo-starfield-dot={i} />;
              })}
            </g>
          )}

          {/* Round 45: rotating radar sweep — a 40° wedge with a soft
              leading-edge gradient. Slow 6s rotation reads as a radar
              scan without being noisy. Inline transform-origin on the
              <g> wrapper ensures Chrome / Firefox rotate around (cx,cy)
              instead of the SVG viewBox corner.

              v0.10.0 Hero 3 Wave 1 / RFC §3.B (Vincent 5222 holdover):
              sweep arc retired. The diagonal rotating wedge competes
              with working-halo SMIL, hub busyness breath, and edge
              flow animation — on a 16:9 Twitter screenshot it reads
              'wow lots of motion' rather than 'agents communicating'.
              Same idiom as R278/R279/R280 retirements — `false &&`
              short-circuits the IIFE so it's a one-line rollback. */}
          {false && (() => {
            // R146: radar sweep rotation buckets on workingCount, joining
            // R84 hub breath / R131 outer orbit / R132 group march /
            // R145 idle spokes as the 5th and final layer in the busyness-
            // driven motion family. 8 / 6 / 4 / 3 seconds — same 0 / 1-2 /
            // 3-5 / 6+ thresholds R84 uses. "Busier fleet = more frequent
            // scans" feels semantically right for a radar idiom. R45
            // baseline 6s sits at bucket 1 so the calm/busy spread bracks
            // around the historical default.
            const busy = workingCount === 0 ? 0
                       : workingCount <= 2 ? 1
                       : workingCount <= 5 ? 2
                       : 3;
            const sweepDur = [8, 6, 4, 3][busy];
            return (
              <g
                style={{
                  transformOrigin: `${cx}px ${cy}px`,
                  transformBox: 'view-box',
                  pointerEvents: 'none',
                  // CSS var consumed by `.anet-topo-sweep` (line 848 of
                  // globals.css). React's CSSProperties type doesn't model
                  // custom properties → cast through Record<string, string>.
                  ...({ ['--sweep-dur']: `${sweepDur}s` } as Record<string, string>),
                } as React.CSSProperties}
                className="anet-topo-sweep"
                opacity={isLight ? 0.7 : 1}
                data-topo-sweep-bucket={busy}
                data-topo-sweep-dur={sweepDur}
              >
                <path
                  d={`M ${cx} ${cy} L ${cx + 330} ${cy} A 330 330 0 0 0 ${cx + 330 * Math.cos(-Math.PI / 4.5)} ${cy + 330 * Math.sin(-Math.PI / 4.5)} Z`}
                  fill="url(#topo-sweep)"
                />
              </g>
            );
          })()}

          {/* radar rings — pure decoration at fixed radii, independent of
              node positions so the radar aesthetic is preserved across tier
              changes.
              Round 290 / Loop: drop the innermost radar ring at r=90.
              That ring sat ~66px outside the hub (hub radius 24, halo
              r=18), in the exact zone R276 (orbit particles) / R278
              (working halo) / R280 (backdrop spokes) cleared during
              the R275-R281 减法 arc. Post-cleanup the lone r=90 ring
              read as a leftover decorative loop hugging the hub — a
              visual element with no remaining sibling to anchor.
              Dropping it returns to the subtractive register after
              R282-R289's 8 加法 rounds and lets the hub breathe. The
              outer three rings (170 / 250 / 330) still carry the
              radar aesthetic across the canvas. New data-topo-radar-
              ring attribute exposes each remaining ring radius for
              test probing. */}
          {[170, 250, 330].map(radius => (
            <circle
              key={radius}
              cx={cx} cy={cy} r={radius}
              fill="none" stroke={pal.ringStroke} strokeWidth="1"
              opacity={isLight ? 0.6 : 0.35}
              data-topo-radar-ring={radius}
            />
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
          {(() => {
            const tierRadii = onlineNodes.length > onlineTripleThreshold
              ? [onlineTripleInnerR, onlineTripleMidR, onlineTripleOuterR]
              : onlineNodes.length > onlineTierThreshold
                ? [onlineInnerRadius, onlineOuterRadius]
                : onlineNodes.length > 0
                  ? [onlineRadius]
                  : [];
            // Round 92 / Loop: tier-ring occupancy. R54 drew the guide
            // rings at fixed opacity regardless of how many nodes lived
            // on each tier. With pinned filters dimming most nodes to
            // 0.28, the ring at a deserted tier looked identical to a
            // crowded one — wasting a free piece of canvas. Count
            // online nodes whose hub-distance falls within ±15 px of
            // each ring (15 px = half the inter-tier gap, so each
            // node is assigned to exactly one ring). Empty tier → skip
            // entirely. Crowded tier → stronger opacity, says "look
            // here". Buckets so the ladder feels intentional, not
            // jittery as one node migrates between tiers.
            const occupancyOf = (r: number) => onlineNodes.reduce((acc, s) => {
              const p = nodePositions[s.alias];
              if (!p) return acc;
              const d = Math.hypot(p.x - cx, p.y - cy);
              return Math.abs(d - r) < 15 ? acc + 1 : acc;
            }, 0);
            // Round 93 / Loop: when any pin is active, tint the tier
            // rings to the legend accent so the spatial guide visually
            // shares the canvas's "filtered mode" colour. The chip
            // row already says WHICH filter is on (pills + letter
            // mirror); rings answering "we're filtered" reinforces
            // the state when the eye is on the canvas, not the chip
            // row. Composes cleanly with R92 occupancy — same opacity
            // bucket logic; just the stroke colour swaps.
            const anyPin = !!(pinnedStatus || pinnedGroup || pinnedVendor);
            const tierStroke = anyPin ? pal.legendAccent : pal.ringStroke;
            return tierRadii.map((r, tierIdx) => {
              const n = occupancyOf(r);
              if (n === 0) return null;
              const bucket = n <= 2 ? 0 : n <= 6 ? 1 : 2;
              const opLight = [0.24, 0.36, 0.50][bucket];
              const opDark  = [0.32, 0.46, 0.62][bucket];
              // Round 174 / Loop: tier guide rings fade-in alongside
              // the R9/R72/R172/R173 first-paint wave. Ring layout's
              // structural scaffolding (R54 dashed concentric guides)
              // was the last instant-pop element after R173 closed
              // group boxes in grid. Same vocabulary — .anet-fade-in
              // mount-once CSS animation + per-ring stagger 60ms ×
              // tierIdx (cap 8). Tier rings are at most 3 (single /
              // dual / triple), so the visible range is 0-120ms.
              // Inner ring leads outward — emanates from the hub.
              // transition list grows `opacity 250ms ease-out` so the
              // post-animation snap from animation's end state (1) to
              // the bucket opacity (0.24-0.62) eases instead of cuts.
              // Same pattern node fade-in uses (R9 + transition-opacity
              // from R3 className). data-tier-fade-delay exposes the
              // computed delay for test probing.
              const fadeDelay = Math.min(tierIdx, 8) * 60;
              return (
                <circle
                  key={`tier-${r}`}
                  cx={cx} cy={cy} r={r}
                  fill="none"
                  stroke={tierStroke}
                  strokeWidth="0.7"
                  /* Round 303 / Loop: tier guide dashes tighten from
                     "2 8" → "2 6" (8px gap → 6px gap). R54 set "2 8"
                     to read as a faint hint behind everything else;
                     after R290 (inner radar ring retired) + R291
                     (starfield 50%) cleared the surrounding backdrop
                     density, the tier guides carry more "this is the
                     ring nodes sit on" visual responsibility. Pulling
                     the gap from 8→6 puts dashes closer together so
                     the ring reads as a clearer continuous mark
                     rather than scattered dots, without bumping
                     strokeWidth (0.7) or opacity (R92 bucketed). The
                     2px dash itself unchanged — same density signal
                     per dash, just fewer-px space between them. */
                  strokeDasharray="2 6"
                  opacity={isLight ? opLight : opDark}
                  className="anet-fade-in"
                  style={{
                    pointerEvents: 'none',
                    transition: 'stroke 200ms ease-out, opacity 250ms ease-out',
                    animationDelay: `${fadeDelay}ms`,
                  }}
                  data-tier-ring={r}
                  data-tier-occupancy={n}
                  data-tier-bucket={bucket}
                  data-tier-tinted={anyPin ? 'true' : 'false'}
                  data-tier-fade-delay={fadeDelay}
                />
              );
            });
          })()}

          {/* Round 50: 4 small particles slowly orbiting the outer ring
              (r=330). Each starts at a different angle (offset 0/0.25/0.5/0.75
              of the cycle) so they're evenly spaced. 16s per revolution is
              slow enough to feel ambient, not noisy. Skipped on light theme
              so the white surface stays clean.

              R131 / Loop: orbit period now buckets on workingCount,
              mirroring R84's hub-busyness breath cadence. An idle
              fleet keeps the original 16s "calm sweep"; as work
              accumulates the orbit subtly accelerates (capped at
              10s so it never feels frantic). Two-layer motion
              coordination now: R84 breathes the hub, R131 spins
              the outer ring — both reading the same underlying
              "is the network busy" signal, both visible
              simultaneously without competing. Same bucket
              thresholds (0 / 1-2 / 3-5 / 6+) the R84 block uses
              at line ~2702 so the two cadences stay in sync if
              a future refactor shifts buckets.

              Round 276 / Loop: orbit particles DISABLED by default
              per Vincent 5214/5215-5217 visual-audit relay
              (clutter cleanup for Twitter screenshot). The 4
              particles encode workingCount busyness via speed
              (R131) + opacity (R216) — but that signal is
              ALREADY conveyed by:
                · hub halo opacity breath (R244, R84)
                · hub digit workingCount text (R130)
                · pressure-bar working/idle/offline ratio (R31)
              So orbit particles are info-redundant decoration:
              they don't add new signal, just add visual noise at
              the canvas outer edge. R276 gates the render block
              with `false &&` so the code stays (commented context
              + tests preserved for hypothetical rollback) but
              nothing renders. R131 busy-bucket constant + R216
              opacity-bucket constant are dead code post-R276 —
              acceptable since the family was R50/R131/R216 and
              R276 retires the family entirely. Net: 4 fewer
              moving dots on canvas. */}
          {false && !isLight && (() => {
            const busy = workingCount === 0 ? 0
                       : workingCount <= 2 ? 1
                       : workingCount <= 5 ? 2
                       : 3;
            const dur = [16, 14, 12, 10][busy];
            // Round 216 / Loop: orbit particle opacity scales with busy
            // bucket alongside R131's speed scaling. Pre-R216 the
            // particles sat at flat opacity 0.9 regardless of fleet
            // workload — speed conveyed busyness but brightness was
            // mute. R216 layers brightness on top of speed so idle
            // fleets read calm (dim particles) and busy fleets read
            // bright (loud particles). Same R84 hub-breath /
            // R131 orbit-speed bucket thresholds (0 / 1-2 / 3-5 / 6+)
            // so the three motion layers (hub breath / orbit / group
            // march) plus the new brightness channel all derive from
            // one busyness metric. transition: opacity 300ms ease-out
            // matches R167 status-flip + R213 hub crossfade timing —
            // when first working node appears, hub focal point AND
            // outer ring particles brighten on the same 300ms beat.
            const orbitOpacity = [0.5, 0.7, 0.85, 1.0][busy];
            return [0, 0.25, 0.5, 0.75].map((phase, i) => (
              <g
                key={`orbit-${i}`}
                data-topo-orbit-bucket={busy}
                data-topo-orbit-dur={dur}
                data-topo-orbit-opacity={orbitOpacity}
              >
                <circle
                  cx={cx + 330} cy={cy}
                  r={i === 0 ? 2.8 : 2.2}
                  fill="#22d3ee"
                  opacity={orbitOpacity}
                  filter="url(#topo-glow)"
                  style={{ transition: 'opacity 300ms ease-out' }}
                >
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from={`${phase * 360} ${cx} ${cy}`}
                    to={`${phase * 360 + 360} ${cx} ${cy}`}
                    dur={`${dur}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              </g>
            ));
          })()}

          {/* Round 240 / Loop: extend R93 anyPin tinting from tier-rings
              to backdrop spokes. Pre-R240 the 6 radar-style spokes
              stayed at pal.ringStroke regardless of filter state,
              while R93 already shifted tier-rings to pal.legendAccent
              on any active pin. Result: ring scaffolding said
              'filtered mode' but spoke scaffolding said 'rest' — the
              two halves of the canvas's spatial guide were out of
              sync. R240 ties them together; whole backdrop now reads
              as one filtered-mode-coloured unit when a pin is active.

              Same anyPin signal R93 uses (pinnedStatus || pinnedGroup
              || pinnedVendor). Same legendAccent tint colour. Same
              200ms ease-out transition timing — pin a status, both
              tier-rings AND spokes ease to cyan together. */}
          {/* Round 280 / Loop: backdrop spokes RETIRED (R93 family with
              R240 tinting) per 减法 cut #6. The 6 radial lines at
              every 30° formed 12 rays from canvas center — even at
              opacity 0.18 (cyber) / 0.35 (light) they added explicit
              radial-line clutter behind the hub-and-spoke topology.
              The radial-gradient backdrop (topo-radar) ALREADY
              provides soft hub-centered glow; explicit lines on top
              were decorative density without structural signal that
              the topology itself doesn't already convey (hub at
              center + nodes on rings = radial structure inherent).
              `false &&` gates the render; code preserved for
              rollback. Same idiom as R276 orbit / R278 working halo
              / R279 ping+pulse retirements. */}
          {false && (() => {
            const anyPin = !!(pinnedStatus || pinnedGroup || pinnedVendor);
            const spokeStroke = anyPin ? pal.legendAccent : pal.ringStroke;
            return [0, 30, 60, 90, 120, 150].map(angle => (
              <line
                key={angle}
                x1={cx - 360 * Math.cos(angle * Math.PI / 180)}
                y1={cy - 360 * Math.sin(angle * Math.PI / 180)}
                x2={cx + 360 * Math.cos(angle * Math.PI / 180)}
                y2={cy + 360 * Math.sin(angle * Math.PI / 180)}
                stroke={spokeStroke}
                strokeWidth="1"
                opacity={isLight ? 0.35 : 0.18}
                data-topo-spoke-angle={angle}
                data-topo-spoke-tinted={anyPin ? 'true' : 'false'}
                style={{ transition: 'stroke 200ms ease-out' }}
              />
            ));
          })()}
          </>)}

          {/* hub links — round 46: idle spokes now have animated
              stroke-dashoffset so dashes flow outward from the hub
              ("command relay" feel). Active spokes carrying live message
              flow stay as solid bright strokes.
              R145 / Loop: idle-spoke animation cadence buckets on
              workingCount, mirroring R84 hub-breath / R131 outer-
              ring orbit / R132 groupbox-march coordination. Same
              0 / 1-2 / 3-5 / 6+ thresholds. Idle ↔ idle network
              has a slow "command relay" feel; as work accumulates
              the dashes accelerate outward, completing the 4th
              motion layer in the busyness-driven family:
                R84  hub breath          (centre)
                R131 outer ring orbit    (periphery)
                R132 groupbox march      (per-team, grid layout)
                R145 idle-spoke flow     (ring layout, hub→nodes)
              4 surfaces, 1 signal. Same cadence ladder 2.8/2.4/2.0/
              1.6s — 1.75× range from calm to busy, capped so the
              network never feels frantic. */}
          {layout === 'ring' && (() => {
            const busy = workingCount === 0 ? 0
                       : workingCount <= 2 ? 1
                       : workingCount <= 5 ? 2
                       : 3;
            const spokeDur = [2.8, 2.4, 2.0, 1.6][busy];
            return onlineNodes.map((session, idx) => {
              const pos = nodePositions[session.alias];
              if (!pos) return null;
              const path = curvePath({ x: cx, y: cy }, pos, 0);
              const isActiveSpoke = activeAliases.has(session.alias);

              /* Round 241 / Loop: hub-link spokes (agent→hub paths in
                 ring layout) eased state-flip between idle and active.
                 Pre-R241 when a node sent or received a message its
                 hub-spoke jumped one-frame from idle gray (pal.spoke-
                 Stroke.idle + strokeWidth=1 + opacity=0.45) to active
                 cyan (pal.spokeStroke.active + strokeWidth=2 + opacity
                 =0.7) — three discrete property snaps in lockstep.
                 R241 adds a 250ms ease-out transition list covering
                 stroke + stroke-width + opacity so the activation
                 'lights up' smoothly. strokeDasharray stays binary
                 (none ↔ '6 14') — dasharray doesn't interpolate
                 cleanly between continuous and discrete forms across
                 browsers (same lesson R167 documented for the node
                 status ring). The CSS keyframe animation on idle
                 spokes (anet-topo-spoke-flow) drives stroke-dashoffset
                 separately and stays untouched. data-topo-hub-spoke-
                 active surfaces the activity state for test probes
                 (active spokes don't carry the bucket/dur attrs so
                 they need their own data anchor). */
              // Round 382 / Loop: hub-spoke path picks up
              // strokeLinecap='round'. Sibling polish to R378 flow-
              // rail dashes + R380 group box dashes — three dashed-
              // stroke surfaces now share 'round' linecap:
              //   R378 flow-rail   '2 12'  -> soft 3-px pills
              //   R380 group box   '6 6'   -> soft 7.5-px pills
              //   R382 hub spoke   '6 14'  -> soft 7-px pills (this round)
              // For idle spokes (dashed at sw=1), each 6-px dash gains
              // 0.5-px round caps and reads as a soft pill instead of
              // a sharp 6 x 1 rectangle. Active spokes (solid, no
              // dasharray) have caps mostly hidden by the hub center +
              // node radius. Geometry-safe; paint-only. R51 sentinel
              // strokeWidth 1.5/3 untouched (idle=1, active=2). data-
              // topo-hub-spoke-linecap attr exposes the value for tests.
              // Round 419 / Loop: hub-spoke idle opacity 0.45 → 0.50.
              // Stale-state legibility lift family 9th anchor — pairs
              // with R391 (active 0.7 → 0.8) and R415 (active sw 2 →
              // 2.25) so the same spoke path is now polished on BOTH
              // active AND idle tiers. Pre-R419 idle spokes painted
              // at α=0.45 with R46 anet-topo-spoke-flow dashed
              // animation; the dashed pulses sat at the "background
              // chatter" floor — visible but understated. R419
              // lifts to 0.50 so idle spokes read more confidently
              // while the active/idle contrast ratio stays clear
              // (0.8/0.50 = 1.6× vs prior 0.8/0.45 = 1.78×; still
              // a sharp two-tier distinction).
              // Stale-state legibility lift family (9 anchors now):
              //   R317 subordinate-text gray-500 → gray-400
              //   R358 freshness floor 0.25 → 0.30
              //   R372 minimap offline-dot 0.5 → 0.6
              //   R404 hub-halo cyber trough 0.08 → 0.10
              //   R405 hub-halo light trough 0.32 → 0.34
              //   R406 edge freshness floor 0.35 → 0.40
              //   R407 node halo offline opacity (cyber + light)
              //   R413 active-node pulse trough (cyber + light)
              //   R419 hub-spoke idle opacity 0.45 → 0.50 (this round)
              // data-topo-hub-spoke-opacity attr (R391) updates to
              // surface the resolved per-state value.
              //
              // Round 415 / Loop: hub-spoke active strokeWidth 2 → 2.25.
              // Pairs with R391 (active opacity 0.7 → 0.8) so the same
              // active-state path lifts BOTH stroke weight AND opacity
              // in concert. Pre-R415 active strokes sat at sw=2 — clear
              // step over idle sw=1, but a touch lighter than the
              // weight family's other "active" indicators (R385 hub
              // hover-ring sw=1.75 / R402 legend pin-ring sw=1.75 /
              // R367 edge-badge rest sw=1.25). R415 bumps to 2.25 so
              // the active spoke reads with proportional weight to its
              // role — the line connecting the focal point to the
              // active node deserves the heaviest active stroke in the
              // family (after pin/hot edge-badge sw=2). Stays clear of
              // R51 sentinels (1.5 / 3) at 2.25.
              // Visual-weight bump family (14 anchors now):
              //   R287 minimap viewport stroke    1   → 1.5
              //   R295 legend swatch radius       5.5 → 6
              //   R359 recent-row pip radius      1.6 → 1.8
              //   R360 hub digit fontSize         11  → 12
              //   R361 edge-badge digit fontSize  10  → 11
              //   R365 hub-highlight radius       5   → 5.5
              //   R367 edge-badge rest stroke     1   → 1.25
              //   R374 pressure-bar height        1.5 → 2
              //   R383 recent-row pip radius      1.8 → 2.0
              //   R384 minimap online dot         1.7 → 1.9
              //   R385 hub hover-ring stroke      1.5 → 1.75
              //   R402 legend pin-ring stroke     1.5 → 1.75
              //   R408 hub-halo radius            18  → 20
              //   R415 hub-spoke active stroke    2   → 2.25  (this round)
              // R382 strokeLinecap='round' + R391 opacity 0.45/0.8 +
              // R51-safe idle sw=1 all preserved. 250ms transition
              // list already covers stroke-width — the new tier eases
              // naturally. data-topo-hub-spoke-stroke-width-active
              // attr surfaces the active value for tests.
              //
              // Round 391 / Loop: hub-spoke active opacity 0.7 → 0.8.
              // Pre-R391 active spokes (the spoke connecting the hub
              // to the currently-active alias — hovered or pinned)
              // lifted opacity from rest 0.45 to active 0.7 — a clear
              // step but slightly understated against the canvas
              // chrome. R391 lifts active to 0.8 so the "this spoke
              // connects to your active node" signal reads with
              // matching weight to the R370 hub hover-ring opacity
              // (0.7 → 0.8 cyber) — paired canvas signals now share
              // the same active-state alpha (0.8) so when a user
              // hovers a node, both the spoke and the hub-ring lift
              // to identical opacity. Rest 0.45 invariant preserved.
              // Theme-consistency / canvas-presence polish family
              // (6th anchor):
              //   R370 hub hover-ring opacity      0.7  → 0.8   cyber
              //   R371 edge-badge rest opacity     0.82 → 0.85  cyber
              //   R372 minimap offline-dot opacity 0.5  → 0.6
              //   R386 hub-highlight idle opacity  0.9  → 0.95
              //   R387 hover-detail panel opacity  0.94 → 0.97  cyber
              //   R391 hub-spoke active opacity    0.7  → 0.8   (this round)
              // Idle path (45% alpha + dashed flow animation) entirely
              // untouched — R391 is an active-state-only lift.
              // data-topo-hub-spoke-opacity attr exposes the resolved
              // value for tests. R382 strokeLinecap='round' + R51
              // sentinel-safe sw (1 idle / 2 active) preserved.
              /* Round 430 / Loop: hub-spoke opacity hover lift on
                 hoveredAlias === session.alias. Adds a "this node's
                 spoke" affordance to the node-hover gesture — in a
                 dense ring layout the spokes are visually quiet
                 (idle α=0.50 dashed, active α=0.80 solid) so hovering
                 a node didn't telegraph which line connects to it.
                 R430 lifts the matched spoke's opacity:
                   idle    0.50 → 0.70   (hover-α=0.70, +0.20)
                   active  0.80 → 0.95   (hover-α=0.95, +0.15)
                 The +0.15-to-0.20 lift keeps the active/idle two-tier
                 distinction (0.95 vs 0.70 still a clear gap) while
                 making the hovered-node's spoke visibly brighter than
                 every other spoke at its own activity tier. R241
                 transition list already covers opacity 250ms so the
                 lift eases for free. Sibling to R429 label-card body
                 solidity lift — both surface a single-node-focused
                 attention cue with the same easing cadence.
                 Stacks with the 6-layer node hover cue stack at the
                 inter-node-link scope:
                   R26  group translateY -2px           (per-node)
                   R217 stroke tint legendAccent        (per-node card)
                   R142 drop-shadow boost               (per-node card)
                   R427 alias letter-spacing            (per-node text)
                   R428 sub-text letter-spacing         (per-node text)
                   R429 body opacity 0.94 → 1.0         (per-node card)
                   R430 spoke opacity α+ (this round)   (link to hub)
                 data-topo-hub-spoke-hovered exposes the gate. */
              const isHoveredSpoke = !reducedMotion && hoveredAlias === session.alias;
              const spokeOpacity = isActiveSpoke
                ? (isHoveredSpoke ? 0.95 : 0.80)
                : (isHoveredSpoke ? 0.70 : 0.50);
              /* Round 435 / Loop: hub-spoke stroke-width hover lift —
                 sibling to R430 opacity hover at the same surface. When
                 hoveredAlias matches, BOTH opacity AND stroke-width
                 lift on the matched spoke so the eye registers a
                 2-axis "this node's spoke" gesture (paint + geometry).
                   idle    1.00 → 1.25  (Δ +0.25, +25%)
                   active  2.25 → 2.50  (Δ +0.25, +11%)
                 Same +0.25 absolute delta keeps the idle/active visual
                 progression consistent — at rest sw ratio 2.25:1 = 2.25,
                 on hover 2.50:1.25 = 2.0; both still clearly two-tier.
                 R241 transition list already covers stroke-width 250ms
                 so the lift eases for free.
                 R51 sentinel-safe: spoke is canvas <path>, not
                 data-node <circle> (the sentinel selector is gated to
                 g[data-node] descendants). 1.25 and 2.5 are not in the
                 reserved {1.5, 3} set so the overlap-test sentinel
                 attribute selector wouldn't match either way. */
              const spokeStrokeWidth = isActiveSpoke
                ? (isHoveredSpoke ? 2.5 : 2.25)
                : (isHoveredSpoke ? 1.25 : 1);
              return (
                <path
                  key={`hub-${session.alias}`}
                  d={path}
                  fill="none"
                  stroke={isActiveSpoke ? pal.spokeStroke.active : pal.spokeStroke.idle}
                  strokeWidth={spokeStrokeWidth}
                  strokeDasharray={isActiveSpoke ? 'none' : '6 14'}
                  strokeLinecap="round"
                  opacity={spokeOpacity}
                  className={isActiveSpoke ? undefined : 'anet-topo-spoke-flow'}
                  data-topo-spoke-bucket={isActiveSpoke ? undefined : busy}
                  data-topo-spoke-dur={isActiveSpoke ? undefined : spokeDur}
                  data-topo-hub-spoke-active={isActiveSpoke ? 'true' : 'false'}
                  data-topo-hub-spoke-hovered={isHoveredSpoke ? 'true' : 'false'}
                  data-topo-hub-spoke-opacity={spokeOpacity}
                  data-topo-hub-spoke-stroke-width={spokeStrokeWidth}
                  data-topo-hub-spoke-stroke-width-active="2.25"
                  data-topo-hub-spoke-linecap="round"
                  style={{
                    transition: 'stroke 250ms ease-out, stroke-width 250ms ease-out, opacity 250ms ease-out',
                    ...(isActiveSpoke ? {} : {
                      animationDelay: `${-(idx * 0.25)}s`,
                      // CSS var consumed by `.anet-topo-spoke-flow`
                      // (line 859 of globals.css). React's CSSProperties
                      // type doesn't model custom properties → cast
                      // through Record<string, string>.
                      ...({ ['--spoke-dur']: `${spokeDur}s` } as Record<string, string>),
                    }),
                  } as React.CSSProperties}
                />
              );
            });
          })()}

          {/* #111: prefix-group boundary boxes (Vincent 4722). Grid layout
              only — groupBoxes is empty in ring mode. Rendered behind the
              flow links + nodes; pointer-events off so they never intercept
              a node click. Restrained dashed container + group-name label. */}
          {groupBoxes.map((box, boxIdx) => {
            const isHovered = activeGroup === box.key;
            // R68: distinguish "locked by click" from "currently hovered".
            // R63 made pinned and hovered identical (both hit isHovered
            // via activeGroup). A user with one team pinned should see at
            // a glance which is the locked one even while their cursor
            // sweeps elsewhere. isPinned reads pinnedGroup directly
            // (NOT activeGroup) so the visual is specific to the sticky
            // state — transient hover keeps the R63 isHovered styling.
            const isPinned = pinnedGroup === box.key;
            // Round 18 / Loop: group-box hover linkage. The Round 8 fade
            // already dropped OUT-of-focus groups to 0.28, but the IN-focus
            // group sat at its baseline appearance — no positive emphasis.
            // Hovering now upgrades the box to an "accent" treatment:
            // solid stroke (not dashed), thicker, accent-coloured; brighter
            // text and slightly stronger fill. Label and box read as one
            // selected unit. Geometry unchanged → overlap test untouched.
            // R132: per-group marching-ants duration computed once,
            // reused on the data attribute + the inline custom property.
            const w = box.statuses.working;
            const marchDur = w >= 6 ? 8 : w >= 4 ? 10 : w >= 2 ? 12 : 14;
            // Round 468 / Loop — single-tier classifier. Surfaces the
            // semantic the R319 pip-strip already encodes implicitly:
            // a cluster where every member sits in one status tier
            // renders as `name · count` only (offending duplicate pip
            // dropped). Pre-R468 that "all members in tier X" fact
            // was visible to the eye (no pips) but not queryable from
            // the DOM. R468 attaches the classifier as
            // `data-group-tier`:
            //   'all-working' — w===count, fleet uniformly busy
            //   'all-idle'    — i===count, fleet uniformly waiting
            //   'all-offline' — o===count, fleet uniformly down
            //   'mixed'       — at least 2 tiers present
            // Sibling R466/R467 pattern — expose composed state as a
            // data-attr without changing paint. Use cases: Playwright
            // assertions, external CSS hooks, accessibility enrichment.
            const groupTier =
              box.statuses.working === box.count ? 'all-working' :
              box.statuses.idle    === box.count ? 'all-idle' :
              box.statuses.offline === box.count ? 'all-offline' :
                                                    'mixed';
            return (
              <g
                key={`grp-${box.key}`}
                data-group={box.key}
                data-group-tier={groupTier}
                // Round 173 / Loop: group boxes pick up the first-paint
                // fade-in wave alongside R9 staggered nodes (0-540ms)
                // and R172 staggered edges (280-980ms). Pre-R173 the
                // structural box frames appeared instantly while the
                // nodes inside eased in — the reveal felt like
                // 'frame slams down, nodes drift in'. The .anet-fade-in
                // CSS animation (R3 origin, 0.15s ease-out, mount-once)
                // plays alongside the node R9 stagger; each box offset
                // by boxIdx × 60ms (cap at 8 indices so a fleet with
                // many groups still finishes within ~500ms) so boxes
                // appear like a soft sweep across the grid rather than
                // a single pop. animation-fill-mode default 'none' →
                // post-animation control reverts to the inline opacity
                // style below (1 / 0.28 based on filter pin state).
                // data-group-fade-delay exposes the computed delay for
                // test probes.
                /* Round 470 / Loop — sync the R8 out-of-focus dim
                   transition cadence from Tailwind's `transition-
                   opacity` default (150ms ease-in-out) to 200ms
                   ease-out to match the rest of the cluster's
                   motion vocabulary. Hero D #147 stack established
                   200ms ease-out across every cluster axis:
                     parent text   (codex p.125)
                     parent rect   (R461 xywh + R464 rx + R248 paint)
                     hitbox rect   (R459 fill+opacity + R460 x+width
                                    + R465 rx)
                   The wrapper <g>'s opacity flip (1 → 0.28 when
                   another group is active) was the LAST surface
                   still at 150ms — when the user hovers a group
                   label, out-of-focus groups dimmed 50ms faster
                   than the focused group's tint brightened, a
                   small but perceivable rate-desync. R470 lifts
                   the wrapper to 200ms ease-out. duration-200 +
                   ease-out are Tailwind v4 utility classes; the
                   anet-fade-in mount-once keyframe stays in the
                   className for first-paint stagger (R173). */
                className="transition-opacity duration-200 ease-out anet-fade-in"
                data-group-fade-delay={Math.min(boxIdx, 8) * 60}
                data-group-fade-transition="200ms"
                // R63: drop the blanket pointerEvents:'none' that
                // previously sat here. Chrome's SVG impl doesn't let a
                // child override a parent's `none` even though the spec
                // says it should — moving the property onto just the
                // rect (where it's needed so nodes underneath stay
                // clickable) lets the label text receive its own click.
                style={{
                  opacity: !activeGroup || isHovered ? 1 : 0.28,
                  animationDelay: `${Math.min(boxIdx, 8) * 60}ms`,
                }}
              >
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  /* Round 464 / Loop: group-box rx 14 → 16 on isPinned.
                     Geometric softening at the corner radius — locked
                     groups read with subtly rounder shoulders than
                     hovered/idle. +2px reads as a calm \"settled in\"
                     posture (subtler than a fill or stroke bump but
                     unmistakable across the whole cluster boundary).
                     Pin signature on the group-box rect now spans 7
                     axes:
                       R63   text fill brighten
                       R142  drop-shadow filter
                       R432  text letter-spacing 0→0.5
                       R444  count tspan fw 500→600
                       R457  parent text fw 700→800
                       codex p.125  text opacity 0.55→1
                       R464  corner rx 14→16  (this round)
                     transition list (R461) already covers x/y/width/
                     height 200ms ease-out; appended `rx 200ms ease-
                     out` so the rounding eases alongside the geometry
                     axes. SVG2 CSS animation on rx: Chrome 95+ /
                     Safari 16+ / FF 70+ (same matrix as x/y/w/h).
                     data-group-box-rx exposes the resolved value. */
                  rx={isPinned ? '16' : '14'}
                  data-group-box-rx={isPinned ? '16' : '14'}
                  fill={isLight ? '#0f172a' : '#a5b4fc'}
                  // R68: 3-tier opacity + stroke ladder.
                  //   pinned   → fill 0.08 / 0.13, stroke 3 px (locked)
                  //   hovered  → fill 0.05 / 0.09, stroke 2 px (inspecting)
                  //   idle     → fill 0.025 / 0.045, stroke 1.5 px dashed
                  fillOpacity={isPinned ? (isLight ? 0.08 : 0.13)
                              : isHovered ? (isLight ? 0.05 : 0.09)
                              : (isLight ? 0.025 : 0.045)}
                  stroke={(isPinned || isHovered) ? pal.legendAccent : pal.ringStroke}
                  strokeWidth={isPinned ? 3 : isHovered ? 2 : 1.5}
                  strokeDasharray={(isPinned || isHovered) ? 'none' : '6 6'}
                  /* Round 380 / Loop: cluster box stroke gets round
                     linecap + round linejoin. Sibling SVG stroke-
                     softening polish to R378 flow-rail linecap + R379
                     minimap viewport linejoin — extends the family to
                     the group cluster boundary box (grid layout only):
                       R288 chrome icons         strokeLinecap='round'
                       R378 flow-rail dashes     strokeLinecap='round'
                       R380 group box dashes     strokeLinecap='round' (this round)
                       R379 viewport rect        strokeLinejoin='round'
                       R380 group box corners    strokeLinejoin='round' (this round)
                     Linecap rounds the R85 '6 6' marching-ants dash
                     pills at rest — each 6 px dash gains a ~0.75 px
                     round cap (sw=1.5 idle), reading as soft pills
                     instead of sharp 6 × 1.5 px rectangles. Linejoin
                     rounds the 4 sharp 90° corners (any state — solid
                     or dashed); at sw=1.5 the join arc is ~0.75 px,
                     matching R379 viewport vocabulary. Geometry-safe:
                     stroke-* properties only affect paint, not bbox.
                     The R51 sentinel 1.5/3 strokeWidth values stay
                     intact (the overlap probe is gated to g[data-
                     node], so this cluster-internal rect is invisible
                     to it anyway). data-group-box-linecap + -linejoin
                     attrs expose the values for tests. */
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  data-group-box-pinned={isPinned ? 'true' : 'false'}
                  data-group-box-linecap="round"
                  data-group-box-linejoin="round"
                  data-group-box-geom-transition="x,y,width,height"
                  // R85: ambient "marching ants" drift on the perimeter
                  // when this group has at least one working member, and
                  // neither pin nor hover is active (those treatments
                  // already shout for attention via solid stroke). 12s
                  // cycle reads as ambient — the eye parses "live work
                  // here" without registering the box as animating.
                  // R132: per-group ant rate buckets on box.statuses.working
                  // — the same coupling-to-busyness idiom R84 uses for the
                  // hub and R131 uses for the outer-ring orbit, applied at
                  // the GROUP scale. A team with one working member ambles;
                  // a team with five working members visibly accelerates.
                  // Bucket boundaries (1 / 2-3 / 4-5 / 6+) chosen to land
                  // on the same 14/12/10/8 cadence ladder so the three
                  // motion layers (hub / ring / group) keep a coherent
                  // tempo grammar. Default 12s when working=0 doesn't
                  // matter — the className is only applied when working>0.
                  data-group-box-live={!isPinned && !isHovered && box.statuses.working > 0 ? 'true' : 'false'}
                  data-group-box-march-dur={marchDur}
                  data-group-box-lifted={(isPinned || isHovered) ? 'true' : 'false'}
                  className={!isPinned && !isHovered && box.statuses.working > 0 ? 'anet-topo-groupbox-live' : undefined}
                  // R142: drop-shadow filter when pinned or hovered. Box
                  // visually "rises off the canvas" — same vocabulary
                  // R18 KPI cards + R135 overlay panels use. Idle group
                  // boxes carry no filter (purely flat dashed outline)
                  // so the unstyled canvas stays uncluttered. Filter
                  // affects paint area only, not the geometric bbox
                  // the overlap-test reads, so zero-overlap invariant
                  // is preserved.
                  filter={(isPinned || isHovered) ? 'url(#topo-groupbox-lift)' : undefined}
                  style={{
                    /* Round 248 / Loop: append fill 200ms ease-out to
                       the existing R66 transition list. Pre-R248 the
                       rect's fill (isLight ? '#0f172a' (slate-900) :
                       '#a5b4fc' (indigo-300)) snapped on theme toggle
                       while stroke / fill-opacity / filter all eased.
                       Closes the last theme-toggle snap on the group
                       box surface — same idiom R246 + R247 used at
                       per-node label-card and side-panel scopes.
                       Round 461 / Loop: extend the transition list to
                       all 4 geometry axes (x, y, width, height) so
                       when a cluster grows / shrinks (member joins,
                       leaves, prefix rebalance, dense toggle, status
                       flip) the BIG outer container slides into the
                       new bounds at the same 200ms cadence the R460
                       inner hitbox tint rect now uses. Pre-R461 the
                       outer 200×140 px box snap-jumped on cluster
                       resize while the inner 160×18 hitbox slid —
                       jarring two-rate motion at the same surface.
                       R461 unifies both rects to slide as one, with
                       the parent box driving the visual envelope and
                       the inner hitbox tracking the bottom-edge tint.
                       Hero D #147 motion-coherence at the FULL cluster
                       container tier (not just the label tint).
                       data-group-box-geom-transition attr exposed. */
                    transition: 'stroke 200ms ease-out, stroke-width 200ms ease-out, fill-opacity 200ms ease-out, filter 200ms ease-out, fill 200ms ease-out, x 200ms ease-out, y 200ms ease-out, width 200ms ease-out, height 200ms ease-out, rx 200ms ease-out',
                    pointerEvents: 'none',
                    // CSS var consumed by `.anet-topo-groupbox-live`
                    // (line 877 of globals.css). React's CSSProperties
                    // type doesn't model custom properties, so cast
                    // through Record<string, string>.
                    ...({['--march-dur']: `${marchDur}s`} as Record<string, string>),
                  }}
                />
                {/* R63: wrap label in a clickable <g> with an invisible
                    rect hitbox. The text alone wasn't getting hit-tested
                    reliably — the SVG-wide topo-panel <rect> intercepts
                    at the label's screen position when the label sits at
                    a high viewBox-y (it lands below where the compositor
                    expects the text to paint on top, same gotcha as the
                    recent-signal panel rows in R56). Hitbox rect + the
                    parent <g> taking the click + onPointerDown stop-
                    propagation match the R55/R56/R61 pattern. */}
                <g
                  role="button"
                  tabIndex={0}
                  aria-pressed={pinnedGroup === box.key}
                  data-group-label-hit={box.key}
                  className="anet-topo-svg-focus"
                  style={{ pointerEvents: 'all', cursor: 'pointer' }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setPinnedGroup(prev => prev === box.key ? null : box.key)}
                  // R86: hover the label → transient group focus. Releases
                  // on leave; activeGroup = hoveredGroup ?? pinnedGroup
                  // formula already handles transient-over-pin so a
                  // user can spot-compare teams without losing their
                  // pinned one. Closes the same R83-style hover/click
                  // gap (segments) — now group labels carry it too.
                  onPointerEnter={() => setHoveredGroupLabel(box.key)}
                  onPointerLeave={() => setHoveredGroupLabel(prev => prev === box.key ? null : prev)}
                  // R152: a11y completeness — R63 added role + tabIndex +
                  // aria-pressed but never wired onKeyDown, so the focused
                  // group label was tab-reachable but Enter/Space was a
                  // no-op. Closes the last keyboard gap among the
                  // role="button" surfaces. Other group-pin trigger paths
                  // (R69 palette, R74 cmdk, R86 hover, dispatchEvent) are
                  // unchanged. Matches the onKeyDown idiom from R116 /
                  // R139 / R140 / R151 (Enter & Space → same setter as
                  // onClick, preventDefault on Space to stop SVG scroll).
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPinnedGroup(prev => prev === box.key ? null : box.key);
                    }
                  }}
                >
                  {/* R99: SVG <title> tooltip listing group members +
                      status breakdown. Same info-density spirit as
                      R97 pill tooltips + R98 node tooltips — anywhere
                      a UI element says "alpha · 3" should hover-
                      explain WHICH 3. Truncates at 8 aliases with a
                      "+N more" suffix so a 20-member band doesn't
                      paint a 22-line tooltip. */}
                  {(() => {
                    const members = Object.entries(groupKeys)
                      .filter(([, key]) => key === box.key)
                      .map(([alias]) => alias);
                    const memberPreview = members.slice(0, 8).join(', ');
                    const suffix = members.length > 8 ? ` + ${members.length - 8} more` : '';
                    const statusSummary = [
                      box.statuses.working > 0 ? `${box.statuses.working} working` : null,
                      box.statuses.idle    > 0 ? `${box.statuses.idle} idle`       : null,
                      box.statuses.offline > 0 ? `${box.statuses.offline} offline` : null,
                    ].filter(Boolean).join(' · ');
                    return (
                      <title>{[
                        `${box.key} (${members.length} member${members.length === 1 ? '' : 's'})`,
                        statusSummary || null,
                        `${memberPreview}${suffix}`,
                        pinnedGroup === box.key ? 'click to release pin' : 'click to pin this group',
                      ].filter(Boolean).join('\n')}</title>
                    );
                  })()}
                  {/* v0.11.0 #147 Hero D — Vincent 5401: "太大太丑,
                     都放到框的右下角的小字". First-cut bottom-right
                     placement collided with bottom-row nodes (cluster
                     geometry has no bottom padding; only GROUP_TOP=12
                     top band). Pivoted to Option C from #147 spec:
                     keep top-left anchor BUT shrink fontSize (13 → 9)
                     and dim default opacity (1 → 0.55, hover/pin
                     restore to 1). Satisfies "太大太丑" via the size +
                     opacity axes while keeping the existing geometry
                     contract that topo-overlap-test gates. Hitbox
                     rect width tightens to min(box.w-12, 160) to
                     track the narrower label render. */}
                  {/* Round 465 / Loop — hitbox tint rect rx 4 → 5 on
                     pinnedGroup match. Mirrors R464 (parent group-box
                     rx 14 → 16 on isPinned) at the hitbox tier. The
                     R460 hitbox carried fixed rx=4 since codex p.125
                     pivoted it to the bottom-of-band position; the
                     pin-state geometric softening was only on the BIG
                     outer container, not the small hitbox underneath.
                     R465 adds +1 px corner rounding on pin so the
                     tint rect echoes the parent's locked posture at
                     its own scale (8% relative bump matches R464's
                     14→16 ≈ 14% scaled to the smaller rect).
                     Transition list (R460 fill/opacity/x/width 200ms
                     ease-out) extends to include `rx 200ms ease-out`
                     so the rounding eases under the same cadence.
                     SVG2 CSS animation on rx: Chrome 95+ / Safari
                     16+ / FF 70+ (same matrix as x/y/w/h).
                     data-group-label-tint-rx exposes the resolved
                     value for tests. */}
                  <rect
                    x={box.x + 6}
                    y={box.y + 2}
                    width={Math.min(box.w - 12, 160)}
                    height={18}
                    rx={pinnedGroup === box.key ? '5' : '4'}
                    data-group-label-tint-rx={pinnedGroup === box.key ? '5' : '4'}
                    fill={pinnedGroup === box.key || hoveredGroupLabel === box.key ? pal.legendAccent : 'transparent'}
                    opacity={pinnedGroup === box.key ? (isLight ? 0.16 : 0.20)
                            : hoveredGroupLabel === box.key ? (isLight ? 0.09 : 0.13)
                            : 1}
                    data-group-label-tinted={pinnedGroup === box.key ? 'pinned' : hoveredGroupLabel === box.key ? 'hover' : 'none'}
                    /* Round 459 / Loop — cadence-sync follow-on to codex
                       preview.125 (Hero D #147). Codex's parent <text>
                       transition list now reads:
                         'fill 200ms, letter-spacing 200ms,
                          font-weight 200ms, opacity 200ms'
                       — 200ms ease-out across every axis. The label
                       hitbox tint rect underneath was still at 150ms
                       (legacy R107 cadence), so the tint snapped in
                       50ms ahead of the parent label brightening —
                       a small but perceivable mistimed cascade when
                       hovering or clicking to pin a cluster. R459
                       lifts both axes to 200ms to lock the tint
                       under the label as one motion-coherent state
                       flip. Hover/pin/unpin all feel as a single
                       unified ease rather than "tint pops, label
                       follows". data-group-label-tint-transition
                       attr exposes the timing for tests. */
                    /* Round 460 / Loop — extend the R459-200ms tint rect
                       transition list to include `x` + `width` so the
                       hitbox slides into place when a cluster grows or
                       shrinks (member joins / leaves / status change
                       re-pricing box.w). Pre-R460 every resize snap-
                       jumped the hitbox bounds — a small but visible
                       glitch right at the moment the operator's
                       attention is on the cluster. SVG2 CSS animation
                       on geometry attrs has shipped in Chrome 95+ /
                       Safari 16+ / FF 70+; the runtime gracefully
                       no-ops on older browsers. Sibling motion idiom
                       to R134 / R141 / R142 (panel rect transitions)
                       at the group-label hitbox tier.
                       data-group-label-tint-geom-transition attr
                       exposes the geometry-axis presence for tests. */
                    data-group-label-tint-transition="200ms"
                    data-group-label-tint-geom-transition="x,width,rx"
                    style={{ transition: 'fill 200ms ease-out, opacity 200ms ease-out, x 200ms ease-out, width 200ms ease-out, rx 200ms ease-out' }}
                  />
                {/* Round 218 / Loop: group label gains a letter-spacing
                    transition on pin — the text subtly spaces out
                    (0px → 0.5px) when the group is locked, giving the
                    pinned state its own typographic signature distinct
                    from R63's transient hover fill brighten. Hover and
                    pin share the same fill colour (legendHeadline), so
                    pre-R218 the only thing distinguishing them was
                    R142 drop-shadow + R68 rect stroke. R218 adds a
                    type-level signal: pinned text spreads slightly,
                    feels "locked in" / "open and held". Letter-
                    spacing is one of the few SVG text properties that
                    interpolates smoothly across the major browsers.
                    Hover stays at default tracking — the spread is
                    pin-exclusive so users can read pinned vs
                    hovered at the text alone. transition 200ms
                    matches R142 fill timing so all the group-label
                    state-flip channels (fill colour, rect stroke,
                    rect drop-shadow, label tracking) ease as one. */}
                {/* Round 432 / Loop: extend the group-label letter-
                    spacing tween from 2-tier (rest/pin) to 3-tier
                    (rest/hover/pin → 0/0.25/0.5). Pre-R432 R218
                    spread the text only on pin; hover got an
                    R63 fill brighten (legendText → legendHeadline)
                    but no typographic axis of its own. R432 adds
                    the missing mid tier so hover telegraphs through
                    BOTH the fill brighten AND a subtle kerning
                    spread — sibling pattern to R427 node-alias
                    (0/0.3/0.5) and R431 edge-badge (0/0.2/0.4) at
                    group-label scope. Pin tier (0.5) still wins.
                    Subtler mid tier (0.25 vs alias 0.3) because the
                    group label is a structural anchor — too much
                    spread would steal weight from the per-node
                    alias identity it groups. Hover-letter-spacing
                    family extension (8 anchors now):
                      R344 chip count digit
                      R345 panel title
                      R347 active-links chip
                      R351 vendor chip
                      R420 zoom-level chip
                      R427 node alias text
                      R431 edge-badge digit
                      R432 group label text (this round)
                    R218 transition list ('fill 200ms, letter-spacing
                    200ms') untouched — additive conditional case. */}
                {/* Round 457 / Loop: group label parent text fontWeight
                    700 → 800 on isPinned. Adds typographic weight axis
                    to the group-label parent text, sibling to R432
                    letter-spacing tween at the same surface. Pre-R457
                    pin lifted ls 0 → 0.5px (R218→R432 3-tier) but the
                    fw stayed planted at R63's 700 — locked groups
                    read as wider-but-same-weight. R457 adds the
                    weight axis so pinned groups read as tightened
                    AND wider, matching the R416/R424/R425/R426/R444/
                    R445/R446 "data tightens under attention" idiom
                    (now extended to the parent-text scope at the
                    group-label tier). R63 fill brighten + R432
                    letter-spacing 0/0.25/0.5 3-tier + R55 transition
                    list all preserved; extends to include 'font-
                    weight 200ms ease-out' so the bump eases under
                    the same cadence. */}
                {/* v0.11.0 #147 Hero D — Vincent 5401 ask: "dash 网络
                   图里面这个工程的名字也太大了, 超级丑". Per Vincent
                   screenshot 实测. Initial attempt moved label to
                   bottom-right (#147 spec Option A); topo-overlap-test
                   caught 7 grid collisions because cluster boxes have
                   no bottom padding. Pivot to Option C: keep top-left
                   anchor, shrink fontSize 13 → 9 (-31%, watermark
                   register), dim default opacity 1 → 0.55 (hover/pin
                   restore to 1). Net Twitter-grok improvement:
                   cluster labels no longer dominate the canvas at
                   rest; operator still hovers to find specific groups.
                   Position unchanged to preserve the existing
                   geometry that overlap-test gates. */}
                <text
                  x={box.x + 12}
                  y={box.y + 12}
                  fill={isHovered ? pal.legendHeadline : pal.legendText}
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight={isPinned ? '800' : '700'}
                  opacity={isPinned || isHovered ? 1 : 0.55}
                  data-group-label-hovered={isHovered && !isPinned ? 'true' : 'false'}
                  data-group-label-font-weight={isPinned ? '800' : '700'}
                  /* Round 479 / Loop — extend drop-shadow visual-polish
                     family to a 4th anchor: group-label parent text
                     on isPinned. Continues the R476/R477/R478 arc:
                       R476  hub digit           hover-gated     emerald
                       R477  legend pin-ring     pin-gated       row.fill
                       R478  recent-row pip      freshness-gated cyan
                       R479  group-label text    pin-gated       cyan
                     Hue: pal.legendAccent at 0x80 alpha (≈50%) — same
                     accent family R107/R477 use for tint surfaces. 3px
                     blur reads as a soft cyan halo around the locked
                     cluster name. Stacks with the R432 letter-spacing
                     spread + R457 fw lift + R63 fill brighten + R142
                     drop-shadow on the parent rect — pin signature on
                     group label scope now spans typography + chroma +
                     paint + container-lift + text-glow.
                     Filter is paint-only; bbox unchanged; overlap-test
                     invariants hold (R51 selector gated to g[data-node]
                     descendants, this label is invisible to the probe).
                     transition list extends to include 'filter 200ms
                     ease-out' alongside the existing fill/ls/fw/opacity
                     200ms tweens. */
                  data-group-label-glow={isPinned ? 'true' : 'false'}
                  /* Round 499 / Loop — orphan band "其他" label gets
                     fontStyle: italic to visually distinguish the
                     catchall from real prefix-group bands. Pre-R499
                     the orphan box label rendered identically to
                     prefix-group labels (Hero D fontSize=9, fw=700,
                     opacity 0.55 rest), so users had to read the
                     literal text "其他" to identify the catchall. R499
                     adds a pure-typography differentiation: italic
                     signals "this is the misc bucket, not a real
                     named group" while preserving full opacity
                     affordance on hover/pin — the orphan box stays
                     equally inspectable, just typographically marked
                     as a different category. No geometry change
                     (italic shifts glyph slant within the same bbox),
                     no opacity loss, no behavior change. Sibling to
                     R432 letter-spacing 3-tier + R457 pin fw-lift +
                     R479 pin drop-shadow at the group-label scope.
                     Falls under 配色 / 节点视觉 themes per the prompt;
                     advances the "信息密度" axis by encoding
                     category-distinction into a single typography
                     channel without adding visual chrome. */
                  style={{
                    transition: 'fill 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out, opacity 200ms ease-out, filter 200ms ease-out',
                    letterSpacing: isPinned ? '0.5px' :
                                   isHovered ? '0.25px' : '0px',
                    fontStyle: box.isOrphan ? 'italic' : undefined,
                    filter: isPinned
                      ? `drop-shadow(0 0 3px ${pal.legendAccent}80)`
                      : undefined,
                  }}
                  data-group-label={box.key}
                  data-group-label-pinned={isPinned ? 'true' : 'false'}
                  data-group-label-orphan={box.isOrphan ? 'true' : 'false'}
                >
                  {box.key}
                  {/* Round 19 / Loop: member-count chip. Inline tspan stays
                      in the single <text> bbox the overlap test reads, so
                      the node↔label guard still catches if the chip ever
                      pushes the label far enough right to clip a node.
                      Smaller + lighter weight reads as metadata, not name. */}
                  {/* Round 229 / Loop: member-count chip drops its explicit
                      fill so it inherits from the parent <text>, which means
                      R142's hover-fill transition (legendText → legend-
                      Headline, 200ms ease-out) NOW carries the count chip
                      with it. Pre-R229 the parent name brightened on
                      hover while the count tspan stayed at legendText —
                      "name lit, count dimmer than at rest" inverted the
                      tonal hierarchy. Inheriting matches the name's
                      transition; both rest and hover keep the SAME
                      tonal relationship between name and count.
                      7th surface in the hover-deepen-own-hue family
                      (legend rows, chip-row counts, status pip, recent
                      row text, pressure-bar segments, group-box fill +
                      this round's group-label-count chip).

                      Also picks up tabular-nums (5th surface in the
                      info-density tabular-nums sweep after R224 edge
                      badge / R225 hub digit / R225 panel header /
                      R225 recent row count). The member count rolls
                      over often (4→5→…→9→10 as a group grows) and
                      lives at a fixed dx=6 offset from the name, so a
                      digit-width jitter at 9→10 used to shift the
                      whole count visibly. Tabular locks it. */}
                  {/* Round 366 / Loop: group label member-count tspan
                      fontWeight 400 → 500. Sibling polish to R363
                      recent-row alias text fw 400 → 500 + R364 legend-
                      row label fw 400 → 500 — closes the per-row 'count
                      is fw 500 against label-tier fw 700' pattern at
                      the group-label scope (grid layout cluster mark).
                      Hierarchy snapshot post-R366 across all 3 row
                      surfaces:
                        recent  count(hot/cold)  fw 700/600  (R320)
                        recent  alias            fw 500      (R363)
                        legend  count            fw 600      (R309)
                        legend  label            fw 500      (R364)
                        group   name             fw 700      (legacy)
                        group   count            fw 500      (R366, this round)
                      Monospace family + R225 tabular-nums lock digit
                      width, so the fw bump is paint-only — bbox
                      unchanged + overlap-test invariants hold. R229
                      fill-inherit from parent label (hover-deepen-own-
                      hue family) preserved. data-group-label-count-
                      font-weight attr exposes the value for tests. */}
                  {/* Round 444 / Loop: group label count tspan
                      fontWeight 500 → 600 on isPinned. Extends the
                      "data tightens under attention" typographic-
                      weight pattern to a 5th anchor at the group-
                      label-count scope:
                        R416 chip-digit       (chip hover)
                        R424 panel-digit      (panel hover)
                        R425 hub-digit        (hub hover)
                        R426 edge-badge-digit (pin/hot)
                        R444 group-label-count (pinned)   ← this round
                      Same idiom — when the group is locked, its
                      member-count tightens typographically alongside
                      the R432 letter-spacing spread (0 → 0.5px) on
                      the parent label. Hover keeps rest fw (500) so
                      the locked vs preview distinction at the type
                      level stays intact — same gate R432 used.
                      Monospace + R225 tabular-nums lock the digit
                      width across fw changes; bbox unchanged; overlap-
                      test invariants hold. transition list adds
                      'font-weight 200ms ease-out' matching R432
                      letter-spacing cadence. R229 fill-inherit
                      preserved (parent text fill still drives the
                      hover/pin color). data-group-label-count-font-
                      weight + -pinned attrs exposed for tests. */}
                  {/* v0.11.0 #147 — count tspan tracks parent fontSize:
                     11 → 8 to match the new 9px label scale (parent
                     dropped 13 → 9 with same -2px gap to the count
                     suffix). dx="4" replaces dx="6" — the smaller
                     glyph baseline doesn't need the wider gutter. */}
                  <tspan
                    dx="4"
                    fontSize="8"
                    fontWeight={isPinned ? '600' : '500'}
                    data-group-label-count={box.key}
                    data-group-label-count-value={box.count}
                    data-group-label-count-pinned={isPinned ? 'true' : 'false'}
                    data-group-label-count-font-weight={isPinned ? '600' : '500'}
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      transition: 'font-weight 200ms ease-out',
                    }}
                  >· {box.count}</tspan>
                  {/* Round 58 / Loop: status mix pip strip. Compact text-
                      based chips (e.g. "2w 1i") so the strip stays inside
                      the same <text> bbox the overlap-test reads — keeps
                      the R27 label↔label and R19 node↔label guards intact.
                      Each tier is colour-coded against the legend swatches
                      and only renders when count > 0, so a healthy all-
                      working group reads simply " · 2w".

                      Round 207 / Loop: each tspan eases in on mount
                      via anet-fade-in. Pre-R207 when a group's first
                      working node went idle (or first idle node went
                      working), the new tier's tspan snap-popped into
                      the label. Same snap-on-mount issue R203 fixed
                      for recent-signal rows, applied at the group-
                      label scope. Each tier is keyed on its boolean
                      mount, so the animation fires once when the
                      tspan first appears (count crosses 0 → 1+),
                      not on every count update (e.g., 1 → 2 working
                      preserves the tspan via React reconciliation).
                      Exit remains snap — matches R190's "fade-IN
                      smooth, accept exit snap" trade-off used for
                      the R129 hot-tail. */}
                  {/* Round 230 / Loop: tabular-nums on the 3 status pips
                      so the count digit doesn't jitter the adjacent
                      pip when a tier crosses 9 → 10. The pips render
                      in sequence at dx=8/4/4 — width-shift on any
                      tier propagates rightward through the strip,
                      visibly compressing or stretching the gap
                      between adjacent tier chips. Tabular locks the
                      digit so the strip stays stable as tiers grow.
                      6th surface in the info-density tabular-nums
                      sweep after R224 edge badge / R225 hub digit /
                      R225 panel header / R225 recent row count /
                      R229 group-label count. Tier-specific fill
                      colours stay (semantic — working green /
                      idle teal / offline slate). */}
                  {/* Round 253 / Loop: append fill 200ms ease-out to
                      each tspan's style so theme toggle eases the
                      tier-coloured pips alongside every other
                      theme-driven element. R230's tabular-nums
                      stays. */}
                  {/* Round 319 / Loop: drop a tier pip when its count
                      equals box.count — i.e. single-tier groups (all
                      working, all idle, all offline). Pre-R319 a 4-all-
                      idle group rendered as `P站 · 4 4i` with the "4"
                      visually doubled; Vincent telegram 5304 flagged
                      this as 比较难看 in a real-data screenshot
                      (ai-insight · 6 6i, blueleap · 3 3i, P站 · 4 4i).
                      The dropped pip's information is already conveyed
                      by the group-box stroke colour (R68 isPinned/
                      hover accent uses the dominant-tier hue) plus
                      the SVG <title> tooltip listing the status
                      breakdown. Multi-tier groups (e.g. `alpha · 3
                      2w 1i`) render unchanged — those pips genuinely
                      add breakdown info that the total doesn't carry. */}
                  {/* Round 458 / Loop — Hero D #147 finishing polish on top of
                      N站牛/codex preview.125 (Option C: top-left label fontSize
                      13→9 + opacity 0.55 rest / 1 hover+pin, count tspan 11→8).
                      That ship left the 3 status pips at fontSize=11 — visibly
                      DOMINATING the now-9px parent label they trail. Result on
                      a 5-member cluster: `alpha · 5 3w 2i` renders inside-out
                      as "tiny name + tiny count + BIG bright pips" rather than
                      a coherent right-tail of metadata. R458 scales the 3 pips
                      to fontSize=8 (matches count tspan) and tightens dx 8/4/4
                      → 6/3/3 (gutter ratio 0.73/0.36 glyph-widths @ 11px ≈
                      0.75/0.38 glyph-widths @ 8px — same visual rhythm at the
                      smaller scale). The whole group-label bottom-right strip
                      now reads as a unified 9/8/8/8 typographic ladder:
                        name (parent <text>)     fontSize 9   fw 700/800
                        · count    (1st tspan)   fontSize 8   fw 500/600
                        Nw         (2nd tspan)   fontSize 8   fw 600
                        Ni         (3rd tspan)   fontSize 8   fw 600
                        No         (4th tspan)   fontSize 8   fw 600
                      Closes Vincent /goal 5401 ("太大太丑") at the pip-strip
                      tier; with codex preview.125 the spec is fully realized.
                      Geometry-only attribute changes — bbox tightens slightly
                      (8px chars vs 11px chars stay inside the original 240px
                      hitbox max) so topo-overlap-test invariants hold.
                      tabular-nums + anet-fade-in + theme-eased fill 200ms
                      preserved on every tspan. */}
                  {box.statuses.working > 0 && box.statuses.working !== box.count && (
                    <tspan
                      dx="6"
                      fill={isLight ? '#059669' : '#22c55e'}
                      fontSize="8"
                      fontWeight="600"
                      className="anet-fade-in"
                      data-group-pip="working"
                      style={{ fontVariantNumeric: 'tabular-nums', transition: 'fill 200ms ease-out' }}
                    >{box.statuses.working}w</tspan>
                  )}
                  {box.statuses.idle > 0 && box.statuses.idle !== box.count && (
                    <tspan
                      dx="3"
                      fill={isLight ? '#0d9488' : '#2dd4bf'}
                      fontSize="8"
                      fontWeight="600"
                      className="anet-fade-in"
                      data-group-pip="idle"
                      style={{ fontVariantNumeric: 'tabular-nums', transition: 'fill 200ms ease-out' }}
                    >{box.statuses.idle}i</tspan>
                  )}
                  {box.statuses.offline > 0 && box.statuses.offline !== box.count && (
                    <tspan
                      dx="3"
                      fill={isLight ? '#94a3b8' : '#6b7280'}
                      fontSize="8"
                      fontWeight="600"
                      className="anet-fade-in"
                      data-group-pip="offline"
                      style={{ fontVariantNumeric: 'tabular-nums', transition: 'fill 200ms ease-out' }}
                    >{box.statuses.offline}o</tspan>
                  )}
                </text>
                </g>
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
            // Round 231 / Loop: per-edge phase stagger lifted into a
            // named constant so the R75 arrival ping + R76 dispatch
            // pulse SMIL animates can RE-COUPLE to the R103 particle's
            // cycle. Pre-R103 (when particle started at phase 0) the
            // ping fired at "near end of cycle" (-0.92*dur) and dispatch
            // at "cycle start" (0) — both phase-coincident with particle
            // arrival/departure respectively. R103's golden-ratio
            // stagger broke that coupling — particle now started at
            // phase (index*0.37)%dur while ping+pulse stayed at fixed
            // offsets, so the rings fired at random moments relative
            // to particle position. R231 expresses dispatch_begin and
            // arrival_begin in terms of THIS stagger so they fire
            // exactly when the particle is at source / near destination
            // respectively — restoring R75/R76's original semantic
            // and unifying the three SMIL elements into one
            // synchronised per-edge animation set.
            const stagger = (index * 0.37) % duration;
            // Round 10 / Loop: freshness fade. An edge that fired ≤30s ago
            // stays at full intensity; over 5 minutes it decays to a
            // floor. Surfaces "what's happening now" vs background
            // chatter without hiding old flow entirely (some context
            // still useful). `now` captured at useMemo-recompute time
            // (every 5s message refresh) — accuracy is within the poll
            // interval, plenty.
            //
            // Round 406 / Loop: edge freshness fade floor 0.35 → 0.40.
            // Stale-state legibility lift family (6th anchor) — pre-
            // R406 edges older than 5 minutes faded to α=0.35 (a 65 %
            // dim against full intensity). The decay rate is the same
            // 1 - ageMs/300s curve; only the FLOOR shifts. Sibling
            // treatment to:
            //   R317 subordinate-text gray-500 → gray-400
            //   R358 freshness ramp floor 0.25 → 0.30
            //   R372 minimap offline-dot opacity 0.5 → 0.6
            //   R404 hub-halo cyber trough 0.08 → 0.10
            //   R405 hub-halo light trough 0.32 → 0.34
            //   R406 edge freshness floor 0.35 → 0.40 (this round)
            // Edges past 5min now sit at 40% intensity instead of 35%
            // — they still recede against fresh edges but read
            // legibly enough to convey "this conversation existed".
            // ageMs threshold for the 5-minute decay unchanged; the
            // decay curve shape (linear) unchanged. The visual delta
            // is most pronounced on edges between 5-60 minutes old —
            // where the floor was binding pre-R406.
            const ageMs = link.last_at ? Math.max(0, Date.now() - Date.parse(link.last_at)) : 0;
            const fresh = Math.max(0.40, 1 - ageMs / (5 * 60 * 1000));
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
            // R116: composes hover ?? pin — a pinned edge stays "hot" after the cursor leaves.
            const isHoveredEdge = activeEdgeKey === link.key;
            const fromGroup = groupKeys[link.from] ?? link.from;
            const toGroup = groupKeys[link.to] ?? link.to;
            const bothInHoveredGroup = !!activeGroup && fromGroup === activeGroup && toGroup === activeGroup;
            // R63: also gate "no filter" on activeGroup so pinnedGroup
            // alone activates the in-group 1.3× boost + non-group dim.
            // When neither a node nor a group is in focus, mul is 1.
            // R77: when the user hovers the "N active links" chip, the
            // baseline 1× becomes 1.5× — every flow brightens at once.
            // Sits inside the no-other-hover branch so it doesn't fight
            // the edge-hover (2.0×) or node-hover (1.7×) priorities.
            const edgeOpacityMul = isHoveredEdge
              ? 2.0
              : activeEdgeKey
                ? 0.35
                : !hoveredAlias && !activeGroup
                  ? (hoveredActiveLinks ? 1.5 : 1)
                  : (link.from === hoveredAlias || link.to === hoveredAlias)
                    ? 1.7
                    : bothInHoveredGroup
                      ? 1.3
                      : 0.35;
            // Round 50: the hovered edge also visibly thickens so the eye
            // tracks it even at low message counts (width was 3 → 4.5 on
            // hover). 1.4× is enough to read as "lifted" without
            // breaching the 16-px hitbox bound.
            // Round 436 / Loop: extend the thickening to the
            // "hovered-endpoint" case — when hoveredAlias matches one
            // of this edge's endpoints, lift width by 1.15× (capped at
            // 8 px to stay clear of the 16-px hitbox). Pre-R436 the
            // edgeOpacityMul=1.7 (line 4703) lifted the matched edge's
            // OPACITY when an endpoint was hovered but the stroke-WIDTH
            // stayed at base — so the edge faded brighter without
            // thickening, leaving the paint+geometry axes mismatched.
            // Mirror of R430/R435 hub-spoke pattern (opacity + stroke-
            // width co-lift on hoveredAlias); R436 brings the same
            // dual-axis "this node's link" gesture to the edge scope.
            // 1.15× is subtler than isHoveredEdge=1.4× because
            // endpoint-hover lifts MANY edges at once (every edge
            // incident on the hovered node) while edge-hover lifts ONE
            // — the gesture should read as "highlighted" not "loud".
            // R166 stroke-width 300ms transition already in the
            // visible-path style list so the lift eases for free.
            const isEndpointHoveredEdge = !!hoveredAlias && (link.from === hoveredAlias || link.to === hoveredAlias);
            const renderWidth = isHoveredEdge ? Math.min(width * 1.4, 10)
                              : isEndpointHoveredEdge ? Math.min(width * 1.15, 8)
                              : width;
            return (
              <g
                key={link.key}
                // Round 172 / Loop: edges fade-in alongside the R9
                // staggered node reveal so the canvas first-paint
                // reads as one coordinated wave instead of "edges
                // pop, nodes ease in". The .anet-fade-in CSS
                // animation (0.15s ease-out, runs once on mount,
                // R3 origin) plays only on first render — React
                // preserves the <g> via the link.key on subsequent
                // re-renders so the animation doesn't replay when
                // flowLinks recomputes (every 5s SSE poll).
                // Animation-delay offsets each edge by 280ms +
                // 35ms × index so edges start fading in AFTER
                // most nodes have appeared (node R9 stagger caps
                // at ~600ms; ring layout R72 emanates 0→540ms).
                // Cap at 20 indices so a busy fleet with 50
                // flowLinks still finishes within ~1s. Respects
                // prefers-reduced-motion via R29 globals.css
                // blanket that neutralises animation-duration.
                className="anet-fade-in"
                style={{
                  animationDelay: `${280 + Math.min(index, 20) * 35}ms`,
                }}
                data-edge-group={link.key}
              >
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
                {/* Round 166 / Loop: stroke-width transition pairs
                    with R164 edge badge r-lift. Pre-R166 the
                    visible flow path's hover thickening (R50:
                    renderWidth = isHoveredEdge ? width * 1.4 :
                    width) snapped instantly even though opacity
                    transitioned smoothly. Edge hover now lifts
                    the line AND the badge in coordinated 300ms
                    ease-out motion. Drop the Tailwind transition
                    class for inline style so both opacity and
                    stroke-width pick up the same timing without
                    arbitrary-property class compilation risk.
                    data-edge-visible exposes the path for test
                    probes (the R48 hitbox sibling already has
                    data-edge-hitbox). Respects prefers-reduced-
                    motion via the R29 globals.css blanket
                    override that neutralises transition-duration
                    universally. */}
                {/* Round 245 / Loop: edge surface picks up stroke
                    color transition for theme-toggle smoothing.
                    R166 already eased opacity + stroke-width on the
                    visible flow path; the stroke COLOR (pal.flowEdge:
                    cyber cyan ↔ light emerald) and the underlying
                    flow-rail's stroke (pal.flowPath: cyber pale-sky
                    ↔ light slate-600) still snapped on theme switch.
                    The rest of the topology smooths theme through R4
                    transitions (status rings) / R242 chat-target ring
                    / R244 halos / R241 hub spokes / R240 backdrop
                    spokes — R245 closes the edge surface.

                    Visible flow path: append 'stroke 300ms ease-out'
                    to the existing transition list (300ms matches
                    R166 opacity + stroke-width pace).

                    Flow rail (dashed underline): convert the Tailwind
                    `transition-opacity` className to inline style so
                    we can list opacity AND stroke together at 300ms
                    ease-out (same idiom R201 used on the working/
                    online chips to splice in additional properties
                    beside Tailwind's). data-edge-flow-rail attr
                    surfaces the path for test introspection. */}
                {/* Round 381 / Loop: edge visible flow path picks up
                    strokeLinecap='round'. Sibling polish to R378
                    flow-rail dashed linecap — both flow-element paths
                    (visible primary + dashed secondary rail) now share
                    'round' linecap vocabulary. The visible path runs
                    source-node → dest-node as one continuous line, so
                    the dest-end is covered by the markerEnd arrow and
                    the source-end usually sits inside the source-node
                    circle. At certain alignments (post-zoom, post-
                    layout-switch transitions), the source-end may peek
                    out by a fraction of a px past the node edge —
                    round caps render that overshoot as a smooth half-
                    disc instead of a sharp rectangle. Pure paint
                    refinement, geometry-safe (bbox of the stroke
                    unchanged at the join with the arrow marker).
                    data-edge-visible-linecap attr exposes the value
                    for tests. */}
                <path
                  d={path}
                  fill="none"
                  stroke={pal.flowEdge}
                  strokeWidth={renderWidth}
                  strokeLinecap="round"
                  opacity={Math.min(1, (isLight ? 0.22 : 0.28) * fresh * edgeOpacityMul)}
                  filter={isLight ? undefined : 'url(#topo-glow)'}
                  markerEnd={`url(#${arrowId})`}
                  data-edge-visible={link.key}
                  data-edge-visible-linecap="round"
                  data-edge-visible-endpoint-hovered={isEndpointHoveredEdge ? 'true' : 'false'}
                  data-edge-visible-stroke-width={renderWidth}
                  style={{
                    pointerEvents: 'none',
                    transition: 'opacity 300ms ease-out, stroke-width 300ms ease-out, stroke 300ms ease-out',
                  }}
                />
                {/* Round 378 / Loop: edge flow-path dashed-rail picks
                    up strokeLinecap='round'. Pre-R378 the rail
                    rendered '2 12' dashes as sharp 1×2 rectangles
                    against the canvas backdrop; default 'butt' caps
                    leave dash ends square. R378 rounds each cap so
                    the dashes read as soft 3-px pills (1 px stroke +
                    0.5 px round cap each end). The flow-rail is the
                    secondary 'invisible-spine' line that gives the
                    R57 spoke flow a directional rail to slide along
                    — rounding the dashes softens its presence
                    against the primary visible flow path (R245 has
                    no strokeLinecap so it inherits 'butt' on a
                    continuous line, irrelevant). Geometry-safe:
                    round caps only widen the visible dash; the
                    bbox of the path is unchanged so overlap-test
                    invariants hold. data-edge-flow-rail-linecap
                    attr exposes the value for tests. */}
                <path
                  id={`flow-path-${index}`}
                  d={path}
                  fill="none"
                  stroke={pal.flowPath}
                  /* Round 437 / Loop: flow-rail strokeWidth hover lift —
                     1 → 1.5 on (isHoveredEdge || isEndpointHoveredEdge).
                     Pre-R437 the dashed rail sat at sw=1 always while the
                     visible flow path above it lifted (R50 ×1.4 on
                     isHoveredEdge / R436 ×1.15 on isEndpointHoveredEdge).
                     The two edge paint layers were mismatched on hover:
                     top layer thickened, underline stayed thin — so the
                     hover gesture lifted only half the edge surface.
                     R437 lifts the underline too so the whole edge
                     reads as "raised" on hover, not just its bright
                     top stripe. Same +0.5 absolute delta R435 used at
                     hub-spoke scope (1→1.25 there, slightly bigger
                     here because the rail's base 1 is at the kerning
                     floor and needs more lift to register).
                     Transition list extends to include stroke-width
                     300ms so the new lift eases under the same R166
                     cadence as the visible path's stroke-width. */
                  strokeWidth={(isHoveredEdge || isEndpointHoveredEdge) ? 1.5 : 1}
                  strokeDasharray="2 12"
                  strokeLinecap="round"
                  opacity={Math.min(1, (isLight ? 0.4 : 0.75) * fresh * edgeOpacityMul)}
                  data-edge-flow-rail={link.key}
                  data-edge-flow-rail-linecap="round"
                  data-edge-flow-rail-stroke-width={(isHoveredEdge || isEndpointHoveredEdge) ? 1.5 : 1}
                  data-edge-flow-rail-lifted={(isHoveredEdge || isEndpointHoveredEdge) ? 'true' : 'false'}
                  style={{ transition: 'opacity 300ms ease-out, stroke 300ms ease-out, stroke-width 300ms ease-out' }}
                />
                {!reducedMotion && (
                  /* Round 103 / Loop: phase-stagger the particles so
                     concurrent edges don't pulse in lockstep. SMIL
                     `begin` accepts negative offsets to shift the cycle
                     backwards in time, which means the particle starts
                     mid-flight on first paint — no visible "all
                     particles spawn from source simultaneously" tell.
                     `(index * 0.37) % duration` gives a deterministic,
                     well-distributed offset (the golden-ratio-ish 0.37
                     fraction prevents lining up when N is a small
                     multiple). Edge order is stable (sorted by recent
                     activity), so the offsets feel calm rather than
                     reshuffling each refresh. */
                  /* Round 422 / Loop: edge flow particle radius 4 → 4.5.
                     Visual-weight bump family (15th anchor) — particles
                     riding along the edge animateMotion path get +0.5px
                     radius lift, increasing visual area by ~27%
                     (π·4.5² / π·4² = 1.27). Sibling magnitude to R383
                     recent-row pip 1.8 → 2.0 (+25% area), R384 minimap
                     online dot 1.7 → 1.9 (+25% area). R251 fill +
                     R252 transitions + R103 phase-stagger animateMotion
                     all preserved. data-edge-particle-radius attr
                     exposes the value for tests. */
                  <circle
                    /* Round 439 / Loop: edge flow particle radius hover
                       lift — r 4.5 → 5.5 on (isHoveredEdge ||
                       isEndpointHoveredEdge). Continues edge paint-
                       layer parity arc (R436 visible path sw / R437
                       flow-rail sw / R439 particle r) so the whole
                       edge surface — including the moving particle —
                       lifts on hover, not just the static stripes.
                       +1px radius gives ~50% area boost. Subtler than
                       1.4× sw bump on visible path because the
                       particle is already small + motion-bright;
                       +1px reads as "the dot caught attention"
                       without overshadowing the path lift. R252
                       transition list extends to include r 200ms so
                       the size change eases under the same fill/
                       opacity cadence. */
                    r={(isHoveredEdge || isEndpointHoveredEdge) ? 5.5 : 4.5}
                    fill={pal.flowParticle}
                    filter={isLight ? undefined : 'url(#topo-glow)'}
                    /* Round 485 / Loop — extends R484's "inspection
                       overrides encoding" pattern to a 2nd anchor:
                       edge particle opacity lifts to 1.0 on
                       isHoveredEdge OR isEndpointHoveredEdge (user
                       hovering the edge directly OR hovering one
                       of its endpoint nodes). Pre-R485 the particle
                       inherited freshness × edgeOpacityMul decay
                       so a stale edge's particle painted near the
                       0.30 floor even when the operator was
                       inspecting it; R485 lifts to 1.0 on attention.
                       data-recent-row-ts-alpha-attribute analog —
                       freshness encoding preserved on rest tier,
                       opacity override engages only on inspection.
                       Sibling lift family — inspection-overrides-
                       encoding pattern, now 2 anchors:
                         R484 recent-row timestamp   freshness → 1.0
                         R485 edge particle          freshness → 1.0  (this)
                       data-edge-particle-opacity-lifted attr exposes
                       the override gate; data-edge-particle-opacity-
                       rest preserves the freshness reading. */
                    opacity={(isHoveredEdge || isEndpointHoveredEdge) ? 1 : Math.min(1, fresh * edgeOpacityMul)}
                    data-edge-particle={link.key}
                    data-edge-particle-radius={(isHoveredEdge || isEndpointHoveredEdge) ? 5.5 : 4.5}
                    data-edge-particle-lifted={(isHoveredEdge || isEndpointHoveredEdge) ? 'true' : 'false'}
                    data-edge-particle-opacity-rest={Math.min(1, fresh * edgeOpacityMul).toFixed(2)}
                    data-edge-particle-opacity-lifted={(isHoveredEdge || isEndpointHoveredEdge) ? 'true' : 'false'}
                    style={{ transition: 'fill 200ms ease-out, opacity 200ms ease-out, r 200ms ease-out' }}
                  >
                    <animateMotion
                      dur={`${duration}s`}
                      begin={`-${stagger.toFixed(3)}s`}
                      repeatCount="indefinite"
                      path={path}
                    />
                  </circle>
                )}
                {/* Round 75 / Loop: arrival ping at the destination. The
                    particle currently fades into the arrow marker
                    silently — adding a small radiating ring synchronised
                    to the particle's period turns message delivery into
                    a visible event. begin = -dur*0.92 offsets the
                    animation so the ring expands NEAR the end of each
                    cycle (≈when the particle arrives). Gated by
                    reducedMotion and on fresh > 0.5 — stale edges that
                    haven't fired in minutes don't need the eye-grab.
                    data-arrival-ping for testability.

                    Round 279 / Loop: arrival ping RETIRED (R75 + R228
                    + R231 + R252 family) per 减法 cut #5. Per active
                    edge the SMIL family was: particle (R50
                    animateMotion) + arrival ping (R75 r+opacity SMIL)
                    + dispatch pulse (R76 r+opacity SMIL). For a 5-
                    edge fleet that's 5×3 = 15 simultaneous SMIL.
                    The PARTICLE (a moving dot along the path) is the
                    primary "data flowing from A → B" visual signal;
                    ping + pulse are secondary "arrival/dispatch
                    confirmation" that the moving particle already
                    conveys. Cull ping + pulse, keep particle.
                    `false &&` gates the render; code preserved for
                    rollback. */}
                {false && !reducedMotion && fresh > 0.5 && (
                  <circle
                    cx={to.x}
                    cy={to.y}
                    r="0"
                    fill="none"
                    stroke={pal.flowEdge}
                    strokeWidth="1.5"
                    opacity="0"
                    /* Round 252 / Loop: stroke transition for theme
                       toggle. SMIL animates r + opacity continuously;
                       stroke is static per render but theme-driven
                       (pal.flowEdge: cyber cyan ↔ light emerald). */
                    style={{ pointerEvents: 'none', transition: 'stroke 200ms ease-out' }}
                    data-arrival-ping={link.key}
                  >
                    {/* Round 228 / Loop: pulse-pop ease curves on the
                        arrival ping SMIL — extends R227's keySplines
                        adoption from the click ripple (one-shot, two-
                        value linear) to the canvas's repeating delivery-
                        confirmation surfaces. Both <animate>s use
                        calcMode=spline with keyTimes='0;0.5;1' (two
                        segments).
                        • r grows 0→14→22 (monotonic): unified ease-out
                          across both segments — the ring decelerates
                          as it expands, settling at its widest.
                        • opacity bumps 0→0.55→0 (pulse): ease-out on
                          the rise (fast appearance), ease-in on the
                          fall (slow start of fade then accelerates) —
                          the canonical "pulse-pop" kinetic shape.
                        Together r decelerating and opacity pulse-popping
                        give the arrival ping a real-event physicality
                        instead of the prior linear-velocity tick. */}
                    <animate
                      attributeName="r"
                      values="0;14;22"
                      dur={`${duration}s`}
                      begin={`-${((stagger + duration * 0.92) % duration).toFixed(3)}s`}
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.5;1"
                      keySplines="0.25 0.1 0.25 1;0.25 0.1 0.25 1"
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.55;0"
                      dur={`${duration}s`}
                      begin={`-${((stagger + duration * 0.92) % duration).toFixed(3)}s`}
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.5;1"
                      keySplines="0.25 0.1 0.25 1;0.42 0 1 1"
                    />
                  </circle>
                )}
                {/* Round 76 / Loop: source dispatch pulse — mirror to the
                    R75 arrival ping. begin = 0s (start of cycle) so the
                    ring expands as the particle LEAVES the source. Only
                    fires for high-traffic edges (link.count >= 3) — on
                    quiet conversations the canvas should stay calm; on
                    busy senders the pulse plus arrival ping bookend
                    every message in flight, making the topology feel
                    alive. Same fresh/reducedMotion gates as R75. Slightly
                    smaller radius (0→12→18 vs R75's 0→14→22) so the
                    source reads as "smaller event than arrival" — the
                    destination is the meaningful endpoint.

                    Round 279 / Loop: dispatch pulse RETIRED with the
                    arrival ping (R75) above — same 减法 rationale.
                    Particle remains as the sole "data flow" SMIL
                    signal per active edge. */}
                {false && !reducedMotion && fresh > 0.5 && link.count >= 3 && (
                  <circle
                    cx={from.x}
                    cy={from.y}
                    r="0"
                    fill="none"
                    stroke={pal.flowEdge}
                    strokeWidth="1.5"
                    opacity="0"
                    /* Round 252 / Loop: stroke transition for theme
                       toggle. Same idiom as arrival ping above. */
                    style={{ pointerEvents: 'none', transition: 'stroke 200ms ease-out' }}
                    data-dispatch-pulse={link.key}
                  >
                    {/* Round 228 / Loop: same pulse-pop curves as the
                        arrival ping above. r ease-out + opacity
                        ease-out→ease-in. The dispatch pulse is smaller
                        (0→12→18 vs arrival's 0→14→22), but the kinetic
                        feel should be identical — both bookend a
                        single message in flight, so they should
                        physically ease the same way. */}
                    <animate
                      attributeName="r"
                      values="0;12;18"
                      dur={`${duration}s`}
                      begin={`-${stagger.toFixed(3)}s`}
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.5;1"
                      keySplines="0.25 0.1 0.25 1;0.25 0.1 0.25 1"
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.45;0"
                      dur={`${duration}s`}
                      begin={`-${stagger.toFixed(3)}s`}
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.5;1"
                      keySplines="0.25 0.1 0.25 1;0.42 0 1 1"
                    />
                  </circle>
                )}
                {/* Round 100 / Loop: midpoint count badge for high-
                    traffic edges. Width already gauges intensity but
                    "5 vs 12" is hard to read off stroke alone. Render
                    a compact pill at the bezier midpoint (t=0.5 →
                    midpoint + perpendicular × lift/2) showing the
                    integer count. Threshold link.count >= 3 keeps
                    the canvas quiet for sparse traffic. Bezier
                    midpoint math: for a quadratic curve M A Q C B,
                    the t=0.5 point is (A + 2C + B) / 4, which
                    simplifies to (midAB) + 0.5 × (control - midAB)
                    = midAB + perpendicular × lift/2. */}
                {(() => {
                  // Round 215 / Loop: badge always-mounts; visibility
                  // crossfades via the wrapper <g>'s opacity instead of
                  // React conditional mount/unmount on link.count >= 3.
                  // Pre-R215 a flow's first 2 → 3 message crossing made
                  // the badge appear in one frame, and a hot flow
                  // tapering 3 → 2 vanished in one frame. R215 extends
                  // the always-mount-opacity-gate idiom (R181 / R182 /
                  // R183 ring family + R213 hub digit/highlight + R214
                  // pulse dot) to the canvas-edge surface. Inner R164
                  // r-lift / R188 stroke transitions continue to ease
                  // their respective state flips independently. pointer
                  // events gated to 'none' when invisible so a sub-
                  // threshold badge can't intercept the hitbox click.
                  const visible = link.count >= 3;
                  const midX = (from.x + to.x) / 2;
                  const midY = (from.y + to.y) / 2;
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const len = Math.hypot(dx, dy) || 1;
                  const badgeX = midX + (-dy / len) * lift * 0.5;
                  const badgeY = midY + ( dx / len) * lift * 0.5;
                  const badgeOpacity = visible ? Math.min(1, fresh * edgeOpacityMul) : 0;
                  /* R121: the badge becomes a canvas-side click-to-pin
                     affordance. R100 introduced it as a passive count
                     display; R116 added pinnedEdgeKey. Joining them
                     lets users pin a flow directly from the canvas
                     without crossing to the recent-signal panel.
                     pointerEvents move from 'none' to 'all' on the
                     wrapper <g>; the underlying R48 edge hitbox is
                     wider (16 px) than the 18-px badge diameter so
                     clicks landing on either still route correctly
                     — the badge consumes its small footprint, the
                     hitbox owns the rest. stopPropagation on
                     pointerdown so the SVG pan capture doesn't
                     redirect the click. */
                  const isPinned = pinnedEdgeKey === link.key;
                  // R126: hot-edge accent. The edge stroke width (line
                  // 2344) already scales with count but clamps at 7 —
                  // so count=5 and count=50 look identical at the line,
                  // and the only signal differentiating them is the
                  // integer in the badge. Bucket count into a "hot"
                  // band (≥ 10) and flip the badge stroke to a warmer
                  // tone + thicker ring so busy lanes telegraph at a
                  // glance without reading the digit. Reuses the amber
                  // family from R125 (chip empty-state) — semantic is
                  // "draw the eye here"; R125 amber is in the chip row
                  // above the SVG, R126 amber is on the canvas, so the
                  // surfaces never compete in the same eye-sweep. Pin
                  // still wins (uses legendHeadline) so a pinned hot
                  // edge reads as "locked + busy" via the badge text
                  // and edge brightness, not via a third stroke colour.
                  const isHot = link.count >= 10;
                  const hotStroke = isLight ? '#d97706' : '#fbbf24';
                  return (
                    <g
                      data-edge-count-badge={link.key}
                      data-edge-count-badge-pinned={isPinned ? 'true' : 'false'}
                      data-edge-count-badge-hot={isHot ? 'true' : 'false'}
                      data-edge-count-badge-visible={visible ? 'true' : 'false'}
                      role={visible ? 'button' : undefined}
                      tabIndex={visible ? 0 : -1}
                      aria-pressed={visible ? isPinned : undefined}
                      aria-hidden={visible ? undefined : true}
                      className="anet-topo-svg-focus"
                      style={{
                        pointerEvents: visible ? 'all' : 'none',
                        cursor: visible ? 'pointer' : undefined,
                        transition: 'opacity 300ms ease-out',
                      }}
                      opacity={badgeOpacity}
                      onPointerDown={(e) => e.stopPropagation()}
                      // R122: badge hover propagates to hoveredEdgeKey so
                      // moving the cursor onto the badge lights the
                      // same endpoint rings + edge brighten as hovering
                      // the line. R121 only wired click; the badge sat
                      // visually separate from the line on hover,
                      // which felt like two surfaces rather than one.
                      onMouseEnter={() => setHoveredEdgeKey(link.key)}
                      onMouseLeave={() => setHoveredEdgeKey(prev => prev === link.key ? null : prev)}
                      // Round 185 / Loop: edge badge click fires the same
                      // one-shot expanding-ring ripple R14 uses for node
                      // click and R52 uses for hub click — anchored at
                      // the badge midpoint with the edge's own flowEdge
                      // colour. Closes the click-feel idiom across all
                      // three pinnable canvas surfaces (hub / node /
                      // edge badge). Reused setClickRipple state machine
                      // so only one ripple at a time; ts coordinate
                      // guard in the setTimeout cleanup prevents an
                      // older ripple from clobbering a newer one if
                      // the user clicks two badges in quick succession.
                      onClick={(e) => {
                        e.stopPropagation();
                        setPinnedEdgeKey(prev => prev === link.key ? null : link.key);
                        const ts = Date.now();
                        setClickRipple({ ts, x: badgeX, y: badgeY, r0: 10.5, color: pal.flowEdge });
                        setTimeout(() => setClickRipple(prev => prev && prev.ts === ts ? null : prev), 600);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setPinnedEdgeKey(prev => prev === link.key ? null : link.key);
                          const ts = Date.now();
                          setClickRipple({ ts, x: badgeX, y: badgeY, r0: 10.5, color: pal.flowEdge });
                          setTimeout(() => setClickRipple(prev => prev && prev.ts === ts ? null : prev), 600);
                        }
                      }}
                    >
                      <title>{isPinned
                        ? `${link.from} → ${link.to} (${link.count}) — click to release pin`
                        : `${link.from} → ${link.to} (${link.count}) — click to pin`}</title>
                      {/* Round 164 / Loop: edge badge gains hover-lift
                          to match the 5-surface hover-elevation
                          family (R51 node / R135 panel / R142 group
                          box / R143 recent row / R144 legend row).
                          Pre-R164 the badge had R122 hover→edge-brighten
                          propagation but the badge ITSELF stayed
                          static, so the cursor-on-target feedback
                          felt mismatched with every other interactive
                          surface. Bumping r 9 → 10.5 on hover OR pin
                          gives the same "lift" gesture in canvas
                          space (the badge sits on a curved path, so
                          translate-Y wouldn't track the line; radius
                          growth is the SVG-native equivalent). Pin
                          and hover share the lift so a pinned badge
                          stays visually raised even after mouseleave —
                          mirrors R143/R144 where row pin gets the
                          same lift as row hover. Pinned still keeps
                          its R121 stroke change (legendHeadline +
                          width 2) so pin and hover stay
                          discriminable on the same lifted state.
                          strokeWidth stays at 1 / 2 — won't trip the
                          R51 overlap-test sentinels (1.5 / 3 are
                          reserved). transition keeps the lift smooth
                          (180ms ease-out) and respects prefers-
                          reduced-motion via the globals.css blanket
                          override that neutralises transitions.

                          Six surfaces now share the hover-elevation
                          idiom: nodes (R51), panels (R135), group
                          boxes (R142), recent rows (R143), legend
                          rows (R144), edge badges (R164). */}
                      {/* Round 188 / Loop: extend the badge transition to
                          include stroke + stroke-width. R164 added the
                          r 9↔10.5 lift; R188 closes the smoothness gap
                          on the R121 pin-stroke flip (cyan flowEdge ↔
                          legendHeadline) and R126 hot-lane flip (cyan
                          ↔ amber). Both used to snap when crossing the
                          state boundary (pin click, or count crossing
                          10). Now they ease 300ms through the colour
                          and width change — same idiom R167 uses for
                          the node status ring. The badge strokeWidth
                          values are 1/2 (not R51 sentinels 1.5/3) so
                          the always-rendered badge stays invisible to
                          the overlap-test guard rails. */}
                      {/* Round 251 / Loop: edge badge circle transition
                          list grows fill + opacity at 200ms so theme
                          toggle no longer snaps the badge background
                          while the rest of the circle eases.
                          Pre-R251:
                            r 180ms (R164 hover lift)
                            stroke 300ms (R188 hot/pinned colour flip)
                            stroke-width 300ms (R188 hot/pinned width flip)
                          fill (pal.legendBox.fill: cyber #020617 ↔ light
                          #ffffff) and opacity (cyber 0.82 ↔ light 0.95)
                          were theme-driven but missed from the list —
                          the badge chrome snapped on theme switch while
                          the per-edge ring + visible flow path (R245)
                          and per-node surfaces (R246) all eased.
                          R251 closes the per-edge surface theme-toggle
                          smoothness — every theme-driven property on
                          every edge element now eases under cyber↔light. */}
                      {/* Round 367 / Loop: edge midpoint badge rest
                          stroke-width 1 → 1.25. Sibling visual-weight
                          bump family (7th canvas anchor now):
                            R287 minimap viewport stroke 1 → 1.5
                            R295 legend swatch base radius 5.5 → 6
                            R359 recent-row pip base radius 1.6 → 1.8
                            R360 hub digit fontSize 11 → 12
                            R361 edge-badge digit fontSize 10 → 11
                            R365 hub-highlight base radius 5 → 5.5
                            R367 edge-badge rest stroke 1 → 1.25 (this round)
                          Cold edge badges gain ~25 % stroke presence
                          (1.25/1.0 = 1.25). Stays clear of the R51
                          overlap-test sentinel values (1.5 / 3 reserved
                          for node strokes — the test selector is gated
                          to g[data-node] ancestors so this edge-internal
                          circle is invisible to that probe anyway, but
                          1.25 is a safe non-sentinel value regardless).
                          R188 transition list 'stroke-width 300ms ease-
                          out' still smoothes the hot/pin flip — now
                          1.25 → 2 instead of 1 → 2, same ease pace.
                          data-edge-badge-stroke-width-rest exposes the
                          new baseline for tests. */}
                      {/* Round 371 / Loop: edge-badge cyber opacity 0.82
                          → 0.85. Sibling theme-consistency polish to R370
                          hub hover-ring 0.7 → 0.8. R251 designed this
                          badge with opacity 0.82 (cyber) / 0.95 (light)
                          — 13 % delta. Cyber-theme dark bg needs more
                          alpha to read as 'present'; R371 narrows the
                          gap to 10 %, bringing the badge closer to light
                          theme's 0.95 floor. Light stays at 0.95
                          (already in the legibility band). data-edge-
                          badge-opacity attr exposes the resolved value.
                          Theme-consistency polish family:
                            R246/R247  panel transition family
                            R251       edge badge fill/opacity baseline
                            R370       hub hover-ring cyber 0.7 → 0.8
                            R371       edge badge cyber 0.82 → 0.85 (this round)
                          R164 r=9/10.5 hover-lift + R188/R251 transition
                          list + R367 strokeWidth=1.25 cold rest preserved. */}
                      {/* Round 394 / Loop: edge-badge gains a hover
                          strokeWidth tier (1.5) between cold rest
                          (R367 1.25) and pin/hot (2). Pre-R394 the
                          badge lifted only its radius on hover (R164
                          9 → 10.5); the stroke stayed at cold rest
                          1.25 unless pin/hot kicked in, so a plain
                          hover felt half-lifted — geometry expanded
                          while the contour stayed thin. R394 adds
                          strokeWidth=1.5 on isHoveredEdge so hover
                          now lifts both r AND stroke in concert —
                          same pattern R385 used for the hub hover-
                          ring (1.5 → 1.75) where the ring's three
                          hover axes (r grow / opacity fade-in /
                          stroke thicken) all rise together.
                          Three-tier stroke hierarchy now:
                            cold rest          1.25  (R367)
                            hovered            1.5   (R394 — this round)
                            pinned / hot       2.0   (R188)
                          R51 sentinel concern: strokeWidth=1.5 is
                          one of the two sentinels reserved for node
                          detection, but the R51 selector is gated
                          to `g[data-node]` ancestors so this edge-
                          internal circle is invisible to the probe
                          (same lesson R177 hub hover-ring + R367
                          cold rest documented). 300ms strokeWidth
                          transition already in the style list eases
                          the new tier naturally. data-edge-badge-
                          stroke-width-hover attr exposes the hover
                          value for tests. */}
                      {/* Round 395 / Loop: edge-badge gains a third
                          hover axis — opacity 0.85 (cyber) / 0.95
                          (light) → 1.0 on isHoveredEdge. Pre-R395
                          hovering thickened the stroke (R394 1.25 →
                          1.5) and grew the radius (R164 9 → 10.5)
                          but the badge's translucency stayed put at
                          R371's rest alpha (cyber 0.85 / light 0.95).
                          R395 lifts hover to a clean 1.0 — fully
                          opaque — so the hovered badge reads as
                          "in focus" against the dim siblings.
                          Three-axis hover-lift parity now complete:
                            hub hover-ring (R177/R370/R385):
                              r 14 → 17, opacity 0 → 0.8 cyber, sw 1.5 → 1.75
                            edge badge (R164/R394/R395):
                              r 9 → 10.5, sw 1.25 → 1.5, opacity → 1.0
                          200ms opacity transition (already in the
                          style list) eases the new axis naturally.
                          R371 rest opacity (0.85 cyber / 0.95 light)
                          preserved as the resting alpha — R395
                          adds an isHoveredEdge override on top.
                          data-edge-badge-opacity-hover attr exposes
                          the hover value for tests. */}
                      {/* Round 396 / Loop: extend the R395 opacity → 1.0
                          lift to the pinned state. Pre-R396 the badge
                          shared `r=10.5` on both hover AND pin (R164
                          unified-lift) but R395's opacity lift fired
                          ONLY on isHoveredEdge — pinned badges stayed
                          at R371 rest alpha (cyber 0.85 / light 0.95).
                          That left pin (sticky selection) reading
                          softer than hover (transient preview), even
                          though pin is the stronger commitment.
                          R396 unifies hover + pin at opacity=1.0
                          so the same data-edge-badge-lifted='true'
                          surface uniformly carries full alpha. Pin
                          stroke (R188 sw=2 + pal.legendHeadline color)
                          continues to differentiate pin from hover —
                          the opacity track now closes the lift parity.
                          The new gate (isHoveredEdge || isPinned)
                          mirrors the existing R164 r-lift gate, so
                          the badge has a single "active state"
                          signature across r + opacity.
                          200ms opacity transition (already in style
                          list) eases pin/unpin naturally. R371 rest
                          opacity preserved as the resting alpha.
                          data-edge-badge-opacity-hover renamed
                          semantically to -active (covers hover+pin)
                          via the new -opacity-active attr; the
                          legacy -opacity-hover attr kept for R395
                          test compatibility. */}
                      {/* Round 480 / Loop — 5th anchor in the drop-shadow
                         visual-polish family. Gates on isHot (link.
                         count >= 10, R129 hot-lane threshold) so the
                         badge gets a warm-amber halo when its edge
                         crosses the high-traffic boundary.
                         Drop-shadow family ledger now:
                           R476  hub digit       hover-gated      emerald
                           R477  legend pin-ring pin-gated        row.fill
                           R478  freshness pip   freshness-gated  cyan
                           R479  group label     pin-gated        cyan
                           R480  edge badge      hot-lane-gated   amber  ← this round
                         5th gate type — traffic volume — joins hover,
                         pin, freshness, pin. Each polish anchor uses
                         a distinct semantic gate but the same paint
                         vocabulary. Hue: hotStroke (amber-tinted
                         palette member) at 0x80 alpha — picks up the
                         R126/R188 hot-edge accent colour family so
                         the glow reads as a chromatic extension of
                         the existing hot-lane stroke. 3-px blur
                         radius reads as soft heat rather than
                         emergency klaxon.
                         R51 sentinel safety: badge sw=2 only matters
                         when the overlap probe runs on g[data-node]
                         descendants, which this edge-internal badge
                         is not. Filter is paint-only, bbox unchanged.
                         transition list extends to include 'filter
                         200ms ease-out' so the heat halo eases on
                         the count-crosses-threshold flip. */}
                      <circle
                        cx={badgeX} cy={badgeY}
                        r={isHoveredEdge || isPinned ? 10.5 : 9}
                        fill={pal.legendBox.fill}
                        stroke={isPinned ? pal.legendHeadline : isHot ? hotStroke : pal.flowEdge}
                        strokeWidth={isPinned ? 2 : isHot ? 2 : isHoveredEdge ? 1.5 : 1.25}
                        opacity={(isHoveredEdge || isPinned) ? 1 : (isLight ? 0.95 : 0.85)}
                        data-edge-badge-lifted={(isHoveredEdge || isPinned) ? 'true' : 'false'}
                        data-edge-badge-stroke-width-rest="1.25"
                        data-edge-badge-stroke-width-hover="1.5"
                        data-edge-badge-opacity={(isHoveredEdge || isPinned) ? 1 : (isLight ? 0.95 : 0.85)}
                        data-edge-badge-opacity-rest={isLight ? 0.95 : 0.85}
                        data-edge-badge-opacity-hover="1"
                        data-edge-badge-opacity-active="1"
                        data-edge-badge-glow={isHot ? 'true' : 'false'}
                        style={{
                          filter: isHot
                            ? `drop-shadow(0 0 3px ${hotStroke}80)`
                            : undefined,
                          transition: 'r 180ms ease-out, stroke 300ms ease-out, stroke-width 300ms ease-out, fill 200ms ease-out, opacity 200ms ease-out, filter 200ms ease-out',
                        }}
                      />
                      {/* Round 224 / Loop: edge badge text gains the 4th
                          pin-signature typography. Pre-R224 the digit
                          rendered with no transition surface: when the
                          flow crossed count=10 (isHot flip) the badge
                          stroke eased 300ms (R188) but the digit itself
                          stayed dead-typographic. R224 adds two clean
                          improvements stacked on the same <text> node:

                          1) fontVariantNumeric: 'tabular-nums' — locks
                             digit width so a 9→10 transition doesn't
                             jitter the textAnchor='middle' centering by
                             half a glyph. The badge is on a curved
                             flow path; any width-change of the centered
                             digit visibly shifts the anchor relative
                             to the underlying circle. Info-density
                             win — digits transition cleanly without
                             pixel-jitter at the boundary.

                          2) letterSpacing pin signature, 4th surface
                             after R218 group label / R219 legend row /
                             R220 recent row. Baseline 0px; widens to
                             0.4px when isPinned || isHot. The transition
                             marks the "this lane just went special"
                             event typographically — same 300ms cadence
                             as the R188 stroke flip, so the badge stroke
                             + text co-ease on the hot/pin threshold.
                             '0px' resolves to keyword 'normal' in
                             computed style (R218 test trap learned);
                             test parsers must accept either form.

                          data-edge-badge-text-pin attr surfaces the
                          isPinned||isHot state for introspection. */}
                      <text
                        x={badgeX} y={badgeY + 3}
                        textAnchor="middle"
                        fill={pal.legendHeadline}
                        /* Round 361 / Loop: edge midpoint badge text
                           fontSize 10 → 11. Sibling visual-weight bump
                           to R360 hub digit 11 → 12. The badge digit
                           is the per-edge equivalent of the hub digit
                           — a high-information scalar (link.count) at
                           a stable canvas position. Pre-R361 fontSize=
                           10 + R220 letter-spacing 0.4 + R224 tabular-
                           nums made the digit READABLE but small
                           against the r=9 / 18-px badge envelope;
                           fontSize=11 nudges the glyph ~10 % bigger
                           (bbox ~7×10 px from ~6×9 px) so the count
                           reads more cleanly at glance — still well
                           inside the r=9 idle circle and the r=10.5
                           hover/pin lift (R164). y=badgeY+3 empirical
                           vertical centring kept (1px drift at the
                           bumped size is below the noise floor in
                           the on-curve flow path).
                           Visual-weight bump family:
                             R287 minimap viewport stroke 1 → 1.5
                             R295 legend swatch base radius 5.5 → 6
                             R359 recent-row pip base radius 1.6 → 1.8
                             R360 hub digit fontSize 11 → 12
                             R361 edge-badge digit fontSize 10 → 11 (this round)
                           data-edge-badge-text-font-size attr exposes
                           the value for tests. R220 pin/hot letter-
                           spacing tween + R224 tabular-nums + R188
                           stroke-width pin/hot transitions all preserved. */
                        fontSize="11"
                        fontFamily="monospace"
                        /* R426 — edge-badge digit fontWeight 700 → 800 on
                           (isPinned || isHot). 4th anchor on the "data
                           tightens under attention" typographic-weight
                           pattern:
                             R416 chip-digit  (chip-row hover trigger)
                             R424 panel-digit (panel hover trigger)
                             R425 hub-digit   (hub hover trigger)
                             R426 edge-badge-digit (pin/hot trigger) ← this
                           The badge digit is the per-edge equivalent of
                           the hub digit (R361 sibling fontSize bump
                           reasoning). Stacks with R188 stroke-width pin/
                           hot lift (1.25 → 1.5) + R220 letter-spacing pin/
                           hot tween (0 → 0.4) for a 3-axis pin/hot signa-
                           ture (edge structure + text spacing + text
                           weight). The R408 transition is letter-spacing
                           300ms; R426 appends font-weight 300ms so the
                           weight bump co-eases under the same cadence. */
                        fontWeight={(isPinned || isHot) ? '800' : '700'}
                        data-edge-badge-text={link.key}
                        data-edge-badge-text-pin={(isPinned || isHot) ? 'true' : 'false'}
                        data-edge-badge-text-font-size="11"
                        style={{
                          pointerEvents: 'none',
                          fontVariantNumeric: 'tabular-nums',
                          /* R431 — edge-badge digit 3-tier letter-spacing:
                             rest 0 / isHoveredEdge 0.2 / (isPinned || isHot) 0.4.
                             Mirrors R427 node-alias 3-tier (rest/hover/chat-
                             target → 0/0.3/0.5) at edge-badge scope. Pre-R431
                             letter-spacing only fired on pin/hot (R220) while
                             pure edge hover lifted stroke (R394) + opacity
                             (R395) + radius (R164) but left the text dead-
                             typographic. R431 adds the missing typographic
                             spacing axis to the edge-hover gesture so the
                             text rises with the badge geometry. Pin/hot
                             tier (0.4) still wins; hover is the mid step.
                             Hover-letter-spacing family extension (7 anchors
                             now): R344/R345/R347/R351/R420/R427/R431. */
                          letterSpacing: (isPinned || isHot) ? '0.4px' :
                                         isHoveredEdge ? '0.2px' : '0px',
                          transition: 'letter-spacing 300ms ease-out, font-weight 300ms ease-out',
                        }}
                      >{link.count}</text>
                    </g>
                  );
                })()}
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
            data-topo-hub-hovered={hoveredHub ? 'true' : 'false'}
            // Round 159 / Loop: the hub is the most visually
            // prominent interactive element on the canvas (R39
            // enlarged it, R52 made it click to fitView, R115
            // added a hover ring, R43 gave it a tooltip) — but
            // R151-R157's a11y sweep skipped it. role/tabIndex/
            // aria-label/onKeyDown bring it to parity with node <g>
            // (R151), group label hit (R152), and minimap (R157).
            // anet-topo-svg-focus picks up R156's explicit cyan
            // focus ring (default browser SVG focus rect is hard
            // to see against the dark canvas).
            role="button"
            tabIndex={0}
            aria-label={(() => {
              const parts = ['Network hub'];
              if (onlineNodes.length > 0) parts.push(`${onlineNodes.length} online`);
              if (workingCount > 0) parts.push(`${workingCount} working`);
              if (flowLinks.length > 0) parts.push(`${flowLinks.length} active link${flowLinks.length === 1 ? '' : 's'}`);
              return parts.join(' · ') + ' — Enter to fit view';
            })()}
            // Round 176 / Loop: hub joins the first-paint fade-in
            // family as the 6th surface. The hub is the visual anchor
            // — every other ring-layout reveal layer (R174 tier rings,
            // R9 nodes, R172 edges) emanates outward FROM it — yet
            // pre-R176 the hub itself popped in instantly while the
            // wave it should be leading staggered around it. Adding
            // .anet-fade-in at delay 0 (no animation-delay needed)
            // places the hub as the canvas-center anchor that the
            // tier wave grows from. Composes cleanly with the existing
            // anet-topo-svg-focus class (R159 keyboard focus ring).
            className="anet-topo-svg-focus anet-fade-in"
            data-topo-hub-fade-delay={0}
            style={{ cursor: 'pointer' }}
            // Stop pointerdown from reaching the SVG pan handler — same
            // reason as the node <g>: a captured pointer makes Chromium
            // fire the follow-up click on the SVG, not this group.
            onPointerDown={(e) => e.stopPropagation()}
            onMouseEnter={() => setHoveredHub(true)}
            onMouseLeave={() => setHoveredHub(false)}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fitView();
                setClickRipple({ ts: Date.now(), x: cx, y: cy, r0: 18, color: isLight ? '#059669' : '#10b981' });
                setTimeout(() => setClickRipple(prev => prev && prev.x === cx && prev.y === cy ? null : prev), 600);
              }
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
            {/* grounding halo — breathes in opacity, no expansion.
                R84: breath amplitude + tempo reflect workingCount. An
                idle fleet keeps the original gentle 0.32→0.52 (light) /
                0.08→0.16 (dark) cycle over 4s — "heart at rest". As
                working sessions accumulate, the peak climbs and the
                period shortens, capped at 2.4s so it never feels
                manic. Quiet fleets see zero change; busy fleets feel
                the canvas working. */}
            {(() => {
              // Bucket workingCount to keep the visual feedback discrete
              // rather than continuous: 0 / 1-2 / 3-5 / 6+. Three buckets
              // are enough — finer gradations are imperceptible.
              const busy = workingCount === 0 ? 0
                         : workingCount <= 2 ? 1
                         : workingCount <= 5 ? 2
                         : 3;
              // Round 404 / Loop: hub-halo cyber trough opacity 0.08 →
              // 0.10. Pre-R404 the breath's low-point sat at α=0.08
              // cyber (per R84 family tuning) — the halo nearly faded
              // out at trough on the dark canvas. R404 lifts cyber
              // trough to 0.10. Per-bucket peak amplitudes [0.16/0.20/
              // 0.26/0.32] stay exactly tuned.
              //
              // Round 405 / Loop: hub-halo LIGHT trough 0.32 → 0.34 —
              // symmetric +0.02 lift to mirror R404's cyber treatment
              // across both themes. Pre-R405 only cyber got the lift
              // (R404 docstring noted "light already at the strong
              // end" as deliberate); but the cyber/light delta in
              // R404 was an inconsistency in the family pattern.
              // R405 closes the symmetry — both themes get +0.02
              // baseline lift, so the breath low-point reads with
              // matching confidence regardless of theme. Light peak
              // array [0.52/0.58/0.65/0.72] stays tuned.
              //
              // Stale-state legibility lift family (5 anchors now):
              //   R317 subordinate-text gray-500 → gray-400
              //   R358 freshness floor 0.25 → 0.30
              //   R372 minimap offline-dot opacity 0.5 → 0.6
              //   R404 hub-halo cyber trough 0.08 → 0.10
              //   R405 hub-halo light trough 0.32 → 0.34  (this round)
              //
              // R84 per-bucket peak/dur + R245 ease-in-out spline
              // keySplines all preserved. Test fixture probes the
              // SMIL <animate> values via data-topo-hub-halo-trough
              // attr (now exposes both light + cyber resolved values).
              const peakLight   = [0.52, 0.58, 0.65, 0.72][busy];
              const peakDark    = [0.16, 0.20, 0.26, 0.32][busy];
              const troughLight = 0.34;
              const troughDark  = 0.10;
              const dur         = [4.0, 3.2, 2.7, 2.4][busy];
              const valuesLight = `${troughLight};${peakLight};${troughLight}`;
              const valuesDark  = `${troughDark};${peakDark};${troughDark}`;
              // Round 408 / Loop: hub-halo radius 18 → 20. The
              // grounding halo (the breathing outer circle around
              // the hub center) is the canvas's signature breath
              // element — R84 family. R408 bumps r=18 → 20 so the
              // breath extends slightly further while keeping 4px
              // clearance before the spoke origin (still room for
              // spoke start anchors). Visual presence on the
              // canvas focal point lifts ~23% area (π·20²/π·18²
              // = 1.23) without changing the per-bucket opacity
              // envelope or breath rhythm. Visual-weight bump
              // family 13th anchor — pairs with R404/R405 trough
              // lifts so the halo now breathes both with more
              // visible amplitude AND more visual footprint.
              // R84 per-bucket peak/dur invariants + R244 calc-
              // Mode='spline' + R245 ease-in-out keySplines all
              // preserved. data-topo-hub-halo-radius attr exposes
              // value for tests.
              /* Round 451 / Loop: hub center halo radius lift on
                 hoveredHub — r 20 → 22 (+2px, ~21% area). Adds another
                 geometric axis to the hub-hover signature stack
                 alongside R177 ring radius lift + R209 digit scale +
                 R425 digit fw + R370 halo opacity + R386 highlight
                 opacity + R441 core fill chroma. Pre-R451 the halo
                 r stayed planted at R408's 20px while the rest of
                 the hub structure responded to hover. R451 makes
                 the halo breath outward on hover so the focal pulse
                 intensifies under attention. SMIL `<animate>` on
                 opacity continues independently (animateAttr=
                 'opacity' vs CSS-property r — non-conflicting). R408
                 base radius 20 preserved as rest; +2 hover delta
                 keeps clearance from the R177 hub-hover-ring at
                 r=17 hover (halo is BEHIND the ring, halo r=22 sits
                 5px beyond the ring's hover-r=17, still well within
                 the hub canvas envelope). data-topo-hub-halo-radius
                 attr now reports the dynamic value. */
              const isHaloHovered = !reducedMotion && hoveredHub;
              const haloR = isHaloHovered ? 22 : 20;
              return (
                <circle
                  cx={cx} cy={cy}
                  fill={isLight ? '#d1fae5' : '#10b981'}
                  opacity={isLight ? 0.42 : 0.12}
                  data-hub-busyness={busy}
                  data-topo-hub-halo-radius={haloR}
                  data-topo-hub-halo-hovered={isHaloHovered ? 'true' : 'false'}
                  data-topo-hub-halo-trough={isLight ? troughLight : troughDark}
                  data-topo-hub-halo-peak={isLight ? peakLight : peakDark}
                  /* Round 253 / Loop: hub grounding halo fill transition
                     for theme toggle. Pre-R253 the base fill (cyber
                     #10b981 ↔ light #d1fae5) snapped while R244's SMIL
                     animate on opacity continued running. CSS fill
                     transition is independent of the SMIL animate
                     (different attributes), so they compose without
                     conflict.
                     R451: r as CSS property (R197/R198 idiom) so the
                     hover-radius tween eases smoothly under the same
                     200ms cadence as fill. */
                  style={{
                    r: `${haloR}px`,
                    transition: 'fill 200ms ease-out, r 200ms ease-out',
                  } as React.CSSProperties}
                >
                  {/* Round 244 / Loop: hub grounding halo breath gets
                      ease-in-out keySplines, matching the active-node
                      pulse (R243) treatment. Pre-R244 default linear
                      calcMode marched opacity at constant velocity
                      through the 3-value trough→peak→trough bounce —
                      mechanical pacing for a 'heartbeat at rest'
                      visual. R244 adds calcMode='spline' + keyTimes
                      '0;0.5;1' + keySplines '0.42 0 0.58 1' ×2 (CSS
                      ease-in-out on both halves), so the breath
                      decelerates near the troughs AND the peak —
                      lingers briefly at each extreme like a real
                      heart-rest cycle. Same SMIL-easing family as
                      R227 (click ripple) / R228 (edge ping+pulse) /
                      R243 (active-node pulse). The breath family
                      is now 2 surfaces deep at this single hub
                      element — R84 amplitude/tempo bucket + R244
                      curve shape. */}
                  {!reducedMotion && (
                    <animate
                      attributeName="opacity"
                      values={isLight ? valuesLight : valuesDark}
                      dur={`${dur}s`}
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.5;1"
                      keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
                    />
                  )}
                </circle>
              );
            })()}
            {/* core — 20px diameter, larger inner highlight reads as a "lit lamp"
                Round 248 / Loop: hub center core gets a fill transition.
                Pre-R248 the core circle (the visual anchor at the centre
                of the canvas, fill=isLight ? '#059669' emerald-600 :
                '#10b981' emerald-500) hard-flipped on theme toggle —
                the most visually prominent element on the canvas
                snapping while everything else (R244 halo / R241 hub
                spokes / R246 label cards / R247 side panels) eased.
                Inline transition closes the gap. data-topo-hub-core
                attr added for test introspection (the parent <g> at
                line 3587 has data-topo-hub but the core specifically
                is the canvas anchor). */}
            {(() => {
              /* Round 441 / Loop: hub center core fill brighten on
                 hoveredHub. Pre-R441 the core was static (cyber
                 emerald-500 #10b981 / light emerald-600 #059669) and
                 the hub-hover gesture lifted ring radius (R177) +
                 digit scale (R209) + digit fw (R425) + halo opacity
                 (R370) + highlight opacity (R386) but the focal core
                 ITSELF stayed planted at rest tone. R441 shifts the
                 fill one emerald tier brighter on hover so the canvas
                 anchor itself responds:
                   cyber  emerald-500 → emerald-400  (#10b981 → #34d399)
                   light  emerald-600 → emerald-500  (#059669 → #10b981)
                 Same +100 step on the emerald scale across both themes.
                 Pure paint axis; no geometry change. R248 fill 200ms
                 transition already in the style list eases the shift.
                 Closes the chroma axis on the hub-hover gesture stack:
                   R177 ring radius lift          geometry
                   R209 digit scale 1.08          geometry
                   R425 digit fw 700 → 800        typography
                   R370 halo opacity 0.7 → 0.8    paint
                   R386 highlight opacity         paint
                   R441 core fill brighten        chroma             ← this round
                 data-topo-hub-core-hovered + -fill attrs exposed
                 for tests. */
              const isCoreHovered = !reducedMotion && hoveredHub;
              const coreFill = isLight
                ? (isCoreHovered ? '#10b981' : '#059669')
                : (isCoreHovered ? '#34d399' : '#10b981');
              return (
                <circle
                  cx={cx} cy={cy} r="10"
                  fill={coreFill}
                  data-topo-hub-core
                  data-topo-hub-core-hovered={isCoreHovered ? 'true' : 'false'}
                  data-topo-hub-core-fill={coreFill}
                  style={{ transition: 'fill 200ms ease-out' }}
                />
              );
            })()}
            {/* R130 / Loop: when workingCount > 0, the decorative inner
                highlight gets replaced with the workingCount digit. The
                R84 busyness breath already encodes the same metric
                through motion — adding the digit gives it a second
                visual channel right at the canvas's focal point. A
                user glancing at the hub now sees both "the network is
                pulsing" (motion) AND "3 agents are working" (digit)
                without having to scan the chip row or panels.

                Geometry: text at (cx, cy) with fontSize 11 monospace
                + fontWeight 700 sits inside the r=10 core (a 2-digit
                12 reads ~12 px wide × 11 px tall, well inside the
                20-px diameter core). Centered vertically via dy=
                "0.36em" — the standard SVG trick for text-vertical-
                center without measuring fontMetrics.

                pointerEvents:none so the digit can't intercept the
                hub click (R52 fit-to-view still fires).

                workingCount=0 falls through to the existing
                decorative highlight so the hub never looks empty. */}
            {/* Round 213 / Loop: hub centre crossfades the workingCount
                digit and the R130 decorative highlight when count
                crosses zero, instead of mount/unmount snap. Pre-R213 a
                fleet going from idle (workingCount=0, highlight circle)
                to first-working-node (workingCount=1, digit "1") swapped
                the elements in a single frame — visible flash at the
                hub's focal point. R213 uses the always-mount + opacity-
                gate pattern (R181/R182/R183 family) so both render
                concurrently and crossfade via opacity transitions.
                Geometry already overlaps (both centred on cx,cy with
                r=5 / digit-bbox ~7×11), so the dual-render adds zero
                layout cost. Reduced-motion users see a 0ms duration
                via the R29 globals.css blanket override. */}
            {/* digit (visible when workingCount > 0) */}
            <text
                x={cx} y={cy}
                textAnchor="middle"
                dy="0.36em"
                fill={isLight ? '#d1fae5' : '#ecfdf5'}
                /* Round 360 / Loop: hub working-count digit fontSize 11
                   → 12. The hub is the canvas's focal point — its digit
                   is the most-read scalar on the whole topology. R130
                   sized it at 11 (well inside the r=10 / 20-px core);
                   R360 nudges it to 12 (~13 px wide × 12 px tall, still
                   well inside the 20-px diameter) for ~9 % more presence.
                   Sibling visual-weight bump family:
                     R287 minimap viewport stroke 1 → 1.5
                     R295 legend swatch base radius 5.5 → 6
                     R359 recent-row pip radius 1.6 → 1.8
                     R360 hub digit fontSize 11 → 12  (this round)
                   The R209 scale-1.08-on-hub-hover, R225 tabular-nums,
                   R253 fill transition, R213 always-mount opacity gate
                   all preserved. data-topo-hub-working-count-font-size
                   attr exposes the value for tests. */
                fontSize="12"
                fontFamily="monospace"
                /* R425 — hub digit fontWeight 700 → 800 on hoveredHub.
                   Closes the "data tightens under attention" pattern
                   across three focal scopes: chip-digit (R416, chip
                   scope) → panel-digit (R424, panel-header scope) →
                   hub-digit (R425, hub focal scope). The hub digit is
                   the most-read scalar on the topology; adding a weight
                   axis on hover stacks with the R209 scale-1.08 + R177
                   ring grow + R370 halo opacity + R386 highlight
                   opacity hub-hover gestures, giving the focal point
                   a typographic axis alongside its scale/structure cues.
                   R360 fontSize=12 + R225 tabular-nums + R209 scale +
                   R253 fill transition all preserved. Transition list
                   extends to include font-weight 200ms ease-out. */
                fontWeight={hoveredHub ? '800' : '700'}
                opacity={workingCount > 0 ? 1 : 0}
                data-topo-hub-working-count={workingCount}
                data-topo-hub-working-count-font-size="12"
                data-topo-hub-working-count-hovered={hoveredHub ? 'true' : 'false'}
                data-topo-hub-working-count-visible={workingCount > 0 ? 'true' : 'false'}
                // Round 209 / Loop: hub workingCount digit scales 1.0 →
                // 1.08 on hub-hover, matching R177's r 14→17 ring grow.
                // Pre-R209 hovering the hub grew the ring while the
                // focal-point digit at the centre stayed planted — the
                // gesture lifted only half the structure. R209 ties the
                // digit's scale into the same hoveredHub state R177
                // already drives, so ring + digit rise as one unit.
                // transform-box: fill-box + transform-origin: center
                // anchors the scale to the digit's own bbox (same
                // idiom R184 reset-spin + R186 chrome-pop use for
                // SVG icon transforms). 200ms matches R167 node-ring
                // stroke-width interpolation pace. Reduced-motion users
                // skip the scale via the !reducedMotion gate (R29 a11y).
                // Round 225 / Loop: tabular-nums on hub digit — info-
                // density sibling to R224's edge badge tabular-nums.
                // Same physics: when workingCount crosses the 9 → 10
                // boundary the textAnchor='middle' centering jitters
                // ~3-4px because monospace fonts still have width
                // variance at the digit-vs-control boundary. Tabular
                // locks digit width so the focal point stays planted
                // through every count change. Pure visual tightening;
                // no test trap (computed font-variant-numeric resolves
                // to the keyword 'tabular-nums' verbatim).
                /* Round 253 / Loop: append fill 200ms to the hub
                   digit transition list — theme toggle (cyber #ecfdf5
                   ↔ light #d1fae5) was the last hub-area snap. */
                /* Round 476 / Loop — hub working-count digit gains a
                   filter: drop-shadow glow on hub-hover. Stacks with
                   the existing 4-axis hub-hover gesture stack on this
                   element:
                     R209  transform: scale(1.08)    geometry
                     R425  fontWeight 700 → 800      typography
                     R253  fill ease-out             chroma (theme)
                     R213  opacity gate              fade (count cross)
                     R476  filter drop-shadow glow   paint (this round)
                   The glow uses the cyber emerald-400 (#34d399) /
                   light emerald-500 (#10b981) hue family so the
                   chroma stays inside the hub-area palette. Subtle
                   2-3 px blur radius at 0.6 opacity — visible but
                   not loud, reads as "the focal digit lit up under
                   attention".
                   Reduced-motion users skip the filter via the
                   !reducedMotion gate (R29 a11y blanket).
                   Filter is a paint-only attribute — bbox stays
                   the same, R51 overlap-test invariants hold.
                   transition list extends to 'filter 200ms ease-out'
                   so the glow eases under the same cadence as the
                   scale + fw + fill axes. */
                data-topo-hub-working-count-glow={!reducedMotion && hoveredHub ? 'true' : 'false'}
                style={{
                  pointerEvents: 'none',
                  transform: !reducedMotion && hoveredHub ? 'scale(1.08)' : 'scale(1)',
                  transformBox: 'fill-box',
                  transformOrigin: 'center',
                  filter: !reducedMotion && hoveredHub
                    ? (isLight
                        ? 'drop-shadow(0 0 2px rgba(16, 185, 129, 0.6))'
                        : 'drop-shadow(0 0 3px rgba(52, 211, 153, 0.6))')
                    : undefined,
                  /* R425: font-weight 200ms appended so the hover fw
                     bump 700 → 800 eases under the same cadence as
                     R209 scale + R253 fill + R213 opacity.
                     R476: filter 200ms appended so the new drop-
                     shadow glow eases at the same cadence. */
                  transition: 'transform 200ms ease-out, opacity 300ms ease-out, fill 200ms ease-out, font-weight 200ms ease-out, filter 200ms ease-out',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {workingCount}
              </text>
            {/* decorative highlight (visible when workingCount === 0) */}
            {/* Round 365 / Loop: hub-center 'lit-lamp' decorative highlight
                circle r 5 → 5.5. Sibling visual-weight bump family —
                each round lifts one canvas anchor's geometric presence
                without disturbing its bbox envelope:
                  R287 minimap viewport stroke 1 → 1.5
                  R295 legend swatch base radius 5.5 → 6
                  R359 recent-row pip base radius 1.6 → 1.8
                  R360 hub digit fontSize 11 → 12
                  R361 edge-badge digit fontSize 10 → 11
                  R365 hub-highlight base radius 5 → 5.5  (this round)
                The highlight only renders when workingCount === 0
                (decorative 'lamp lit but idle' state per R130 + R213
                always-mount opacity-gate). At idle, the 0.5-px radius
                bump (21 % area, π*5.5² / π*5² = 1.21) lifts the lamp's
                presence — still well inside the r=10 hub-core (R130).
                opacity=0 when working preserved so the hub-digit's R130
                takeover stays seamless. R213 always-mount opacity-gate
                + 300ms opacity transition + pointerEvents:none all
                preserved. data-topo-hub-highlight-radius attr exposes
                the value for tests. */}
            {/* Round 386 / Loop: hub-highlight idle opacity 0.9 → 0.95.
                When workingCount===0 the highlight paints as the visible
                idle "lamp lit but no work" core (R130 takeover gate).
                Pre-R386 idle opacity was 0.9 — a ~6 % fade against full
                paint that read as slightly-dimmed-ghost on the focal
                point. R386 lifts to 0.95 (idle alpha gap halved 0.10
                → 0.05) so the canvas anchor reads more confidently
                as a present-but-idle state rather than a faded ghost.
                Theme-consistency / canvas-presence polish family (4th
                anchor):
                  R370 hub hover-ring opacity 0.7 → 0.8 cyber
                  R371 edge-badge rest opacity 0.82 → 0.85 cyber
                  R372 minimap offline-dot opacity 0.5 → 0.6
                  R386 hub-highlight idle opacity 0.9 → 0.95 (this round)
                opacity=0 when working preserved so the hub-digit's
                R130 takeover stays seamless. 300ms opacity transition
                + R213 always-mount opacity-gate + pointerEvents:none
                + R365 r=5.5 all preserved. data-topo-hub-highlight-
                opacity attr exposes the resolved value for tests. */}
            <circle
              cx={cx} cy={cy} r="5.5"
              fill="#d1fae5"
              opacity={workingCount > 0 ? 0 : 0.95}
              data-topo-hub-highlight
              data-topo-hub-highlight-visible={workingCount > 0 ? 'false' : 'true'}
              data-topo-hub-highlight-radius="5.5"
              data-topo-hub-highlight-opacity={workingCount > 0 ? 0 : 0.95}
              data-topo-hub-highlight-breath={!reducedMotion && workingCount === 0 ? 'true' : 'false'}
              style={{
                pointerEvents: 'none',
                transition: 'opacity 300ms ease-out',
              }}
            >
              {/* Round 497 / Loop — idle-state breath (呼吸感 theme pivot
                  from the R492-R496 press-family arc). Pre-R497 the hub
                  idle highlight read as a static dim disc — present but
                  motionless, visually mute. R497 adds a 4s opacity breath
                  (0.85 ↔ 1.0 ↔ 0.85) so the hub reads "alive but quiet"
                  instead of "frozen", giving the empty-fleet state a
                  subtle living signature.
                  Gates:
                    - !reducedMotion (R29 a11y blanket) — reducedMotion
                      users see static 0.95 disc, no animate
                    - workingCount === 0 — when fleet is busy, the
                      highlight is invisible (opacity=0) so the animate
                      would waste paint cycles. Gating saves work.
                  SMIL <animate> overrides the static opacity={0.95}
                  during its run; falls back to 0.95 when reducedMotion
                  flips on (the animate node simply doesn't render).
                  4s cycle is long enough to feel like ambient breath
                  rather than a pulse, matching the "quiet" semantic.
                  data-topo-hub-highlight-breath attr exposes the
                  resolved gate state for tests. */}
              {!reducedMotion && workingCount === 0 && (
                <animate attributeName="opacity" values="0.85;1;0.85" dur="4s" repeatCount="indefinite" />
              )}
            </circle>
            {/* R115 / Loop: hover hint ring. Stroke-only circle at r=14
                that fades in when the hub is hovered — the same idea
                R44 used for node avatars (group-hover stroke). r=14
                sits comfortably outside the r=10 core and INSIDE the
                r=18 grounding halo, so the hover indicator is fully
                contained within the existing hub footprint (no bbox
                growth, overlap test unchanged). pointerEvents:none so
                the hint can't intercept the click that produced it. */}
            {/* Round 177 / Loop: hub hover ring picks up the same
                "lift on hover" gesture R164 added to the edge midpoint
                badge (r=9→10.5). Pre-R177 the ring faded opacity 0→0.7
                on hover but stayed static at r=14. Adding r=14→17 on
                hover gives the gesture extra weight — the hub responds
                more confidently. Stays within the r=18 halo bbox (no
                geometry growth), so the R51 overlap-test guard rails
                still hold. strokeWidth=1.5 is the offline-node
                sentinel but the overlap-test selector is gated to
                `g[data-node]` ancestors — this hub-internal circle
                is invisible to that probe. transition list grows `r`
                alongside opacity so both ease in concert; the lift
                feels like one continuous gesture. Seventh surface in
                the hover-elevation family (R51 nodes, R135 panels,
                R142 group boxes, R143/R144 rows, R164 edge badges,
                R177 hub ring). prefers-reduced-motion respected via
                R29 globals.css blanket. */}
            {/* Round 385 / Loop: hub hover-ring strokeWidth 1.5 → 1.75.
                Sibling visual-weight bump (11th anchor) to R367 edge-
                badge rest stroke 1 → 1.25. The ring is only visible
                during hub hover (opacity=0 rest, R177 + R370 control
                the hover-state alpha) so the change manifests purely
                as a thicker hover-state ring on the canvas focal
                point. R177 r 14 → 17 grow + R370 opacity 0 → 0.8
                already lift the hover cue; R385 adds stroke weight
                as the third lift axis. Stays clear of R51 overlap-
                test sentinel value 3 (1.75 is non-sentinel); the
                R51 selector is gated to g[data-node] ancestors so
                this hub-internal circle is invisible to the probe
                regardless. R253 stroke transition + pointerEvents:
                none preserved. data-topo-hub-hover-ring-stroke-width
                attr exposes the value for tests. */}
            <circle
              cx={cx} cy={cy}
              r={hoveredHub ? 17 : 14}
              fill="none"
              stroke={isLight ? '#059669' : '#10b981'}
              strokeWidth="1.75"
              /* Round 370 / Loop: hub hover-ring cyber opacity 0.7 →
                 0.8. R177 designed the hub hover-ring at opacity-0 →
                 0.85 (light) / 0 → 0.7 (cyber). The 15 % gap between
                 the two themes meant cyber-theme operators got a
                 noticeably softer hover cue than light-theme users
                 against backgrounds that should equalise (dark bg
                 needs more luminance to read as 'on'). R370 bumps
                 cyber 0.7 → 0.8, narrowing the theme gap to 5 % —
                 sibling theme-consistency polish to R251 edge badge
                 fill/opacity (cyber 0.82 / light 0.95) and R246/R247
                 panel transition families. Light theme 0.85 stays
                 as is (already in the legibility band). data-topo-
                 hub-hover-ring-opacity attr exposes the value for
                 tests. */
              opacity={hoveredHub ? (isLight ? 0.85 : 0.8) : 0}
              data-topo-hub-hover-ring
              data-topo-hub-hover-ring-radius={hoveredHub ? 17 : 14}
              data-topo-hub-hover-ring-stroke-width="1.75"
              data-topo-hub-hover-ring-opacity={hoveredHub ? (isLight ? 0.85 : 0.8) : 0}
              /* Round 253 / Loop: hub hover ring also gets stroke
                 transition for theme toggle (cyber #10b981 ↔ light
                 #059669). The opacity + r transitions stay for hover
                 lift; stroke closes the theme-snap. */
              style={{
                pointerEvents: 'none',
                transition: 'opacity 180ms ease-out, r 180ms ease-out, stroke 200ms ease-out',
              }}
            />
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
            const inFocus = !activeGroup || (groupKeys[session.alias] ?? session.alias) === activeGroup;
            // R72: in ring layout, classify the node into a tier by its
            // distance from hub centre so the first-paint stagger can
            // emanate inner → outer instead of running clockwise. Grid
            // layout doesn't have a radial structure; it keeps R9's pure
            // nodeIdx stagger. Thresholds bracket the actual tier radii
            // (single 220, dual 175/260, triple 145/215/285, offline 325+).
            let tierIdx = 0;
            if (layout === 'ring') {
              const p = nodePositions[session.alias];
              if (p) {
                const d = Math.hypot(p.x - cx, p.y - cy);
                tierIdx = d < 195 ? 0 : d < 270 ? 1 : d < 310 ? 2 : 3;
              }
            }

            return (
              <g
                key={session.alias}
                data-node={session.alias}
                data-tier-idx={layout === 'ring' ? tierIdx : -1}
                // R151 / Loop: node a11y compliance — match the pattern
                // R116 / R139 / R140 / R148 / R149 applied to other
                // interactive surfaces. Node <g> has been clickable for
                // chat since R45 but tab-unreachable + screen-reader-
                // unannounced. role="button" + tabIndex=0 + aria-label
                // expose it; aria-pressed reflects chat-target state so
                // SR users know which node currently has the popover
                // open. onKeyDown for Enter / Space fires the same
                // setChatAlias path as onClick. preventDefault on
                // Space stops the SVG canvas from scrolling.
                role="button"
                tabIndex={0}
                aria-pressed={chatAlias === session.alias}
                aria-label={`Chat with ${session.alias} (${session.status})`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setChatAlias(session.alias);
                    setClickRipple({
                      ts: Date.now(),
                      x: pos.x, y: pos.y, r0: radius,
                      color: status.primary,
                    });
                    setTimeout(() => setClickRipple(prev =>
                      prev && Date.now() - prev.ts >= 590 ? null : prev), 600);
                  }
                }}
                // Round 3 / Loop: `anet-fade-in` runs once when the <g>
                // mounts — a new session entering the fleet (or the topology
                // first rendering) eases in instead of popping. Re-renders of
                // an existing node don't re-trigger (React preserves the <g>
                // via the alias key), so status changes don't flicker. The
                // global prefers-reduced-motion sweep already neutralises it.
                className="group transition-opacity anet-fade-in anet-topo-svg-focus"
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
                  // activeStatus matches: working = status==='working',
                  // idle = online but not working, offline = !isOnline.
                  // Round 60 / Loop: activeStatus = hoveredStatus ?? pinnedStatus
                  // so the pressure-bar segment pins (R60) and the legend
                  // row hover (R55) feed the same branch.
                  // Round 80 / Loop: vendor-letter hover composes ABOVE the
                  // activeStatus branch so hovering the vendor chip's `C`
                  // dims everything except C-vendor nodes. Same dim value
                  // (0.28) as edge-endpoint and status filters — visually
                  // consistent. Vendor lookup uses the same vendorForModel
                  // helper the avatar render uses, keyed by initial so the
                  // chip and the avatar always agree on grouping.
                  opacity: hoveredEdgeEndpoints && !hoveredEdgeEndpoints.has(session.alias) && chatAlias !== session.alias
                    ? 0.28
                    : activeVendor && chatAlias !== session.alias && (() => {
                        const v = vendorForModel(session.model);
                        const initial = v.id === 'unknown' ? '?' : v.initial;
                        return initial !== activeVendor;
                      })()
                      ? 0.28
                      : activeStatus && chatAlias !== session.alias && !(
                          activeStatus === 'working' ? session.status === 'working'
                          : activeStatus === 'idle'  ? (isOnline && session.status !== 'working')
                          : /* offline */              !isOnline
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
                  // Round 72 / Loop: in ring layout, stagger by tier radius
                  // so the topology emanates from the hub outward — inner
                  // tier at 0ms, middle at ~180ms, outer at ~360ms, offline
                  // at ~540ms. A small within-tier offset (nodeIdx % 6 * 25)
                  // adds variety so each ring rotates in instead of all-at-
                  // once popping. Grid keeps R9's pure nodeIdx stagger.
                  animationDelay: layout === 'ring'
                    ? `${tierIdx * 180 + (nodeIdx % 6) * 25}ms`
                    : `${Math.min(nodeIdx, 24) * 25}ms`,
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
                  // Round 98 / Loop: enrich the node tooltip with status,
                  // group membership, and inbound/outbound flow counts —
                  // same info-density spirit as R97 active-filter pill
                  // tooltips. Hovering any node now answers "what is this
                  // and how does it sit in the topology" without forcing
                  // a click into the chat popover. Group line only shows
                  // when the alias is part of a multi-member band (R106
                  // prefix grouping); singletons skip it. Flow line only
                  // when at least one direction has count > 0.
                  const groupKey = groupKeys[session.alias];
                  const groupMembers = groupKey
                    ? Object.values(groupKeys).filter(k => k === groupKey).length
                    : 1;
                  const groupLine = groupMembers > 1 ? `group: ${groupKey} · ${groupMembers}` : null;
                  // R147 / Loop: node tooltip extends R98's flow summary
                  // with the actual sender / receiver aliases. R98 told you
                  // "12 in / 5 out" but not WHO. The R97 idiom — anywhere
                  // the UI shows "N" should hover-explain WHICH N — applied
                  // to filter pills, group labels, vendor letters, pressure
                  // segments, recent-row text, active-links chip; the node
                  // title was the last surface still showing only the
                  // aggregate. Direction-tagged: senders are who's
                  // messaging THIS node (inbound), receivers are who this
                  // node is messaging (outbound). 6-truncate + "+N more"
                  // matches the pattern other tooltips use so a 30-flow
                  // node doesn't paint a 30-line tooltip.
                  let flowIn = 0, flowOut = 0;
                  const sendersMap = new Map<string, number>();   // alias → count, inbound
                  const receiversMap = new Map<string, number>(); // alias → count, outbound
                  for (const fl of flowLinks) {
                    if (fl.from === session.alias) {
                      flowOut += fl.count;
                      receiversMap.set(fl.to, (receiversMap.get(fl.to) ?? 0) + fl.count);
                    }
                    if (fl.to === session.alias) {
                      flowIn += fl.count;
                      sendersMap.set(fl.from, (sendersMap.get(fl.from) ?? 0) + fl.count);
                    }
                  }
                  const fmtPeers = (m: Map<string, number>) => {
                    const pairs = [...m.entries()].sort((a, b) => b[1] - a[1]);
                    const preview = pairs.slice(0, 6).map(([a, n]) => `${a} (${n})`).join(', ');
                    const suffix = pairs.length > 6 ? ` + ${pairs.length - 6} more` : '';
                    return preview + suffix;
                  };
                  const flowLine = (flowIn + flowOut) > 0 ? `flows: ${flowIn} in / ${flowOut} out` : null;
                  const sendersLine   = sendersMap.size   > 0 ? `← from: ${fmtPeers(sendersMap)}`    : null;
                  const receiversLine = receiversMap.size > 0 ? `→ to:   ${fmtPeers(receiversMap)}`  : null;
                  return (
                    <title>{[
                      `${session.alias} · ${session.status}`,
                      identityLine(session.model, session.runtime),
                      groupLine,
                      session.project_dir ? `cwd: ${session.project_dir}` : null,
                      lastSeen ? `last seen: ${lastSeen}` : null,
                      flowLine,
                      sendersLine,
                      receiversLine,
                    ].filter(Boolean).join('\n')}</title>
                  );
                })()}
                {/* Round 2 / Loop: hover ring — a thin outer stroke that fades
                    in when the cursor enters the node, signalling clickability
                    (real-user feedback for the chat-popover open). Pure CSS via
                    Tailwind group-hover, so it costs nothing per frame and
                    respects prefers-reduced-motion via the global media query.
                    Round 489 / Loop — duration harmonized from 150ms → 200ms
                    to join the Hero D #147 motion-coherence stack (R459-R475
                    cluster surfaces + cadence-sync family). R2 originally
                    picked 150ms for a "snappier feel" before the 200ms ease-
                    out vocabulary was banked as the canvas-wide motion
                    default. Bringing this ring into the family means hover-
                    in / hover-out / cluster cadence / pip-strip transitions
                    all settle on the same timing — the canvas now reads as
                    one motion vocabulary instead of two competing tempos.
                    11th surface in the motion-coherence stack. */}
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
                  className="opacity-0 group-hover:opacity-70 transition-opacity duration-200"
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
                {/* R51 chat-target ring. R120 / Loop: gentle SMIL
                   breath on the ring's opacity (±0.1 over 3s) when
                   chat is open + !reducedMotion. Says "active session
                   here" continuously without animation noise — the
                   ring only appears for one node at a time (the
                   chatAlias), so it never competes with R84 hub
                   busyness or R112 working halo for attention.

                   Round 183 / Loop: 7th surface in the smooth-pin-
                   mirror family. Pre-R183 the ring was conditionally
                   mounted on `chatAlias === session.alias`; the
                   className `transition-opacity duration-200` never
                   fired because the element didn't exist before
                   mount. Always-mounted now with opacity gated by
                   isChat — the CSS transition fires cleanly on
                   chat-close (smooth fade-out). The `<animate>`
                   SMIL stays gated by `!reducedMotion && isChat`
                   so it only runs for the active chat target; when
                   chat is closed, SMIL unmounts and opacity reverts
                   to attribute (0) → CSS transitions down smoothly.
                   On chat-OPEN the SMIL takes over per spec, so the
                   fade-in is snappier than the fade-out — acceptable
                   because the user explicitly clicked the node.

                   strokeWidth=2.5 is not a R51 sentinel value
                   (sentinels are 1.5/3 inside g[data-node]), so the
                   ring is invisible to the overlap-test selector
                   even when always-mounted. */}
                {/* Round 242 / Loop: extend the chat-target ring's
                    transition list to include stroke + filter.
                    Pre-R242 only `opacity` eased (R183 200ms): a
                    chat-target node going working → idle hard-
                    flipped the ring's stroke colour (status.primary
                    green → teal) in one frame even though the rest
                    of the ring was a smooth presence. Filter (glow
                    on cyber, none on light) also snapped on chat
                    toggle AND on theme switch.

                    Add `stroke 200ms ease-out` + `filter 200ms
                    ease-out` so the colour and glow both ease at
                    the same cadence as the opacity gate. Same
                    idiom R167 (node status-ring) uses for
                    coordinated colour-easing on status flip;
                    R242 brings the chat-target ring up to that
                    bar. */}
                {(() => {
                  const isChat = chatAlias === session.alias;
                  return (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={radius + 14}
                      fill="none"
                      stroke={status.primary}
                      strokeWidth="2.5"
                      opacity={isChat ? (isLight ? 0.85 : 0.95) : 0}
                      filter={!isLight && isChat ? 'url(#topo-glow)' : undefined}
                      style={{ pointerEvents: 'none', transition: 'opacity 200ms ease-out, stroke 200ms ease-out, filter 200ms ease-out' }}
                      data-chat-target-ring
                      data-chat-target-active={isChat ? 'true' : 'false'}
                      data-chat-target-breath={!reducedMotion && isChat ? 'on' : 'off'}
                    >
                      {!reducedMotion && isChat && (
                        <animate
                          attributeName="opacity"
                          values={isLight ? '0.72;0.95;0.72' : '0.82;1;0.82'}
                          dur="3s"
                          repeatCount="indefinite"
                        />
                      )}
                    </circle>
                  );
                })()}
                {/* Round 243 / Loop: active-node pulse (the breathing
                    aura ring at r=radius+14 fill=status.primary, shown
                    on nodes participating in a recent flow) gains TWO
                    polishes:

                    1) Always-mount + opacity-gate wrapper <g>. Pre-
                       R243 the circle conditionally mounted on
                       isActive — when a node joined a flow, the pulse
                       snap-appeared at radius+8 (first SMIL phase
                       value), and when the flow stopped, snap-
                       disappeared. R243 keeps the SMIL animation
                       running continuously inside an opacity-gated
                       <g>; isActive flips the WRAPPER opacity
                       1↔0 with a 300ms ease-out transition so the
                       pulse fades in/out at its current phase
                       instead of restarting from +8. The reduced-
                       motion gate stays at the conditional render
                       level — reduced-motion users see no pulse at
                       all (no point without the animation).

                       12th surface in the always-mount-opacity-gate
                       family (R181/R182/R183/R213×2/R214/R215/R221/
                       R222/R223/R237/R243).

                    2) SMIL ease-in-out keySplines on both r and
                       opacity animates. Pre-R243 default linear
                       calcMode produced a constant-velocity breath
                       (radius marched +8 → +22 at fixed dr/dt;
                       opacity dimmed 0.12 → 0.02 at fixed dα/dt) —
                       mechanical, not organic. calcMode='spline'
                       + keyTimes='0;0.5;1' + per-segment keySplines
                       '0.42 0 0.58 1' (canonical CSS ease-in-out)
                       both ways gives a settled breath: slow at
                       both endpoints (small and large radius / lit
                       and dim opacity), fast through the middle.
                       Same SMIL-easing family R227 / R228 already
                       inhabits at the click ripple + edge ping +
                       pulse. */}
                {!reducedMotion && (
                  <g
                    opacity={isActive ? 1 : 0}
                    data-node-pulse={session.alias}
                    data-node-pulse-active={isActive ? 'true' : 'false'}
                    style={{ transition: 'opacity 300ms ease-out' }}
                  >
                    <circle cx={pos.x} cy={pos.y} r={radius + 14} fill={status.primary} opacity={isLight ? 0.08 : 0.12}>
                      <animate
                        attributeName="r"
                        values={`${radius + 8};${radius + 22};${radius + 8}`}
                        dur="2.4s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keyTimes="0;0.5;1"
                        keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
                      />
                      {/* Round 409 / Loop: active-node pulse peak
                          opacity lift — cyber 0.18 → 0.20 / light
                          0.12 → 0.14. Theme-consistency / canvas-
                          presence family 9th anchor. R243 family
                          rhythm preserved.
                          Round 413 / Loop: trough lift mirrors R409
                          peak — cyber 0.04 → 0.05 / light 0.02 →
                          0.03. Stale-state legibility lift family
                          8th anchor — pairs with R404 (hub-halo
                          cyber trough 0.08 → 0.10) and R405 (light
                          trough 0.32 → 0.34). The per-node breath's
                          low-point now reads slightly above the
                          "nearly gone" zone while preserving the
                          breath amplitude (cyber Δ 0.16 vs Δ pre-
                          R409+R413 of 0.14; light Δ 0.11 vs 0.10).
                          Both peak (R409) AND trough (R413) lift
                          together so the active-pulse signal stays
                          confidently present at both ends of its
                          2.4s cycle.
                          Stale-state legibility lift family (8):
                            R317 subordinate-text gray-500→400
                            R358 freshness floor 0.25→0.30
                            R372 minimap offline-dot 0.5→0.6
                            R404 hub-halo cyber trough 0.08→0.10
                            R405 hub-halo light trough 0.32→0.34
                            R406 edge freshness floor 0.35→0.40
                            R407 node halo offline opacity (cyber+light)
                            R413 active-node pulse trough (this round)
                              cyber 0.04 → 0.05
                              light 0.02 → 0.03
                          R243 always-mount opacity-gate + R243
                          ease-in-out keySplines + r animation
                          (radius+8 ↔ radius+22) preserved.
                          data-node-pulse-peak + new -pulse-trough
                          attrs expose resolved per-theme values. */}
                      <animate
                        attributeName="opacity"
                        values={isLight ? '0.14;0.03;0.14' : '0.20;0.05;0.20'}
                        dur="2.4s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keyTimes="0;0.5;1"
                        keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
                        data-node-pulse-peak={isLight ? '0.14' : '0.20'}
                        data-node-pulse-trough={isLight ? '0.03' : '0.05'}
                      />
                    </circle>
                  </g>
                )}
                {/* Round 4 / Loop: transition-[fill,stroke,opacity] smooths
                    status colour changes so idle↔working↔offline doesn't snap
                    — task replies / node-rename / SSE updates ease in.
                    Round 112 / Loop: working nodes get a subtle halo breath
                    (±0.12 opacity at 3s cycle) so the eye can find "what's
                    busy" at a glance without scanning chips. Idle + offline
                    halos stay flat — they don't need to demand attention.
                    R84 hub-center breath stays the loudest "fleet busyness"
                    signal; this one is quieter, per-node. SMIL `<animate>`
                    inside the circle, gated by reducedMotion. */}
                {/* Round 226 / Loop: working-halo breath gets per-node
                    phase stagger. Pre-R226 every working node's halo
                    pulsed in lockstep — all 0.73→0.92→0.73 starting at
                    the same instant — which on a fleet of 4+ working
                    agents reads as one mechanical metronome rather
                    than an organic group of breathing entities.

                    SMIL `<animate>` accepts negative `begin` to offset
                    the cycle backwards in time (the animation starts
                    mid-cycle on first paint). Using
                    `(nodeIdx * 0.37) % 3` gives a deterministic,
                    well-distributed offset across the 3s period —
                    the same golden-ratio-ish 0.37 fraction R103 uses
                    for particle phase stagger on edges. 0.37 doesn't
                    line up for any small N (4 nodes → offsets 0,
                    0.37, 0.74, 1.11 — evenly spread, never
                    coincident).

                    Side benefit: when a new agent joins a busy fleet
                    its halo phase is determined by its position in
                    the order array, not "when it joined" — so a
                    re-render doesn't reshuffle breath phases. Order
                    is stable (R-onlineNodes sort), so the canvas
                    feels calm rather than jittery on each refresh.

                    Reduced-motion users skip the animate entirely
                    (gate unchanged). Halo opacity transition on the
                    parent stays for status flips. data-node-halo-
                    breath-offset surfaces the chosen offset for
                    test introspection. */}
                {/* Round 407 / Loop: offline node halo opacity lift —
                    cyber 0.25 → 0.30 and light 0.4 → 0.45. Pre-R407
                    offline node halos faded to α=0.25 cyber (75 %
                    dim) / α=0.4 light. On the dark canvas the 0.25
                    halo read as "nearly gone" — exactly the
                    legibility floor R404/R405 just lifted on the
                    hub-halo and R372 lifted on minimap offline dots.
                    R407 closes the same family at the per-node halo
                    surface: +0.05 lift on both themes so offline
                    anchors stay legibly present without crossing into
                    "could be online" territory (online cyber 0.65 /
                    light 0.85 unchanged — the 0.30/0.65 cyber ratio
                    still gives 2.17× contrast for online/offline).
                    Stale-state legibility lift family (7 anchors now):
                      R317 subordinate-text gray-500 → gray-400
                      R358 freshness floor 0.25 → 0.30
                      R372 minimap offline-dot 0.5 → 0.6
                      R404 hub-halo cyber trough 0.08 → 0.10
                      R405 hub-halo light trough 0.32 → 0.34
                      R406 edge freshness floor 0.35 → 0.40
                      R407 node halo offline opacity (this round)
                        cyber 0.25 → 0.30
                        light 0.4  → 0.45
                    R278 retired-breath gate + R12 status.halo color
                    + R226 phase stagger code-path preserved (the
                    breath stays disabled per Vincent's R278 ask;
                    only the BASE opacity floor shifts here). transi-
                    tion list ('fill,opacity' 300ms ease-out) unchanged.
                    data-node-halo-offline-opacity attr exposes the
                    resolved value for tests. */}
                {(() => {
                  /* Round 440 / Loop: node halo opacity hover lift —
                     lifts toward full on the matched node. Pure paint
                     axis: rest values unchanged for un-hovered halos,
                     hover state lifts the matched halo's alpha by
                     +0.15 on each tier:
                       online cyber  0.65 → 0.80
                       online light  0.85 → 1.00 (capped)
                       offline cyber 0.30 → 0.45
                       offline light 0.45 → 0.60
                     Same paint-only mental model as R430 hub-spoke
                     opacity lift + R429 label-card body opacity lift,
                     now at the per-node halo scope. No geometry
                     change so R51 sentinels stay safe and the overlap-
                     test invariant is unchanged (test runs at rest).
                     Closes a chroma/presence axis on the per-node
                     hover signature alongside the 12-layer cue stack
                     (R26/R217/R142/R427/R428/R429 card + R430/R435/
                     R436/R437/R94 link + R438 ring). R407 offline
                     halo opacity floor (cyber 0.30 / light 0.45) is
                     the rest branch unchanged. Existing transition-
                     [fill,opacity] duration-300 className handles
                     the easing. data-node-halo-hovered exposes the
                     gate; data-node-halo-resolved-opacity exposes
                     the four-state resolved value for tests. */
                  const isHaloHovered = !reducedMotion && hoveredAlias === session.alias;
                  /* Round 456 / Loop: light-theme offline node halo
                     rest opacity 0.45 → 0.50. Stale-state legibility
                     lift family extension (10th anchor) at the per-
                     node halo light-theme scope:
                       R317 subordinate-text gray-500 → gray-400
                       R358 freshness floor 0.25 → 0.30
                       R372 minimap offline-dot 0.5 → 0.6
                       R404 hub-halo cyber trough 0.08 → 0.10
                       R405 hub-halo light trough 0.32 → 0.34
                       R406 edge freshness floor 0.35 → 0.40
                       R407 node halo offline opacity
                            cyber 0.25 → 0.30
                            light 0.4  → 0.45
                       R419 hub-spoke idle 0.45 → 0.50
                       R452 dense alias rest 0.9 → 0.95
                       R456 node halo offline LIGHT 0.45 → 0.50  ← this round
                     Pre-R456 light-theme offline halo at 0.45 sat at
                     the upper end of "near-floor" but read as soft-
                     focus on the lighter canvas; +0.05 (~11 % opacity
                     gain) lifts it to 0.50 — the midpoint between
                     R407 rest 0.45 and R440 hover 0.60 — closing the
                     gap so offline halos read more confidently as
                     present-but-stale anchors. Cyber theme stays at
                     R407's 0.30 (cyber backdrop is dark; the cyber
                     offline halo against #080814 contains a stronger
                     contrast envelope than light, so doesn't need
                     the same lift). R440 hover 0.45→0.60 light + R12
                     status.halo color + R407 transition list all
                     preserved. */
                  const haloOpacity = (() => {
                    if (isOnline) {
                      return isLight ? (isHaloHovered ? 1   : 0.85) : (isHaloHovered ? 0.80 : 0.65);
                    }
                    return isLight ? (isHaloHovered ? 0.60 : 0.50) : (isHaloHovered ? 0.45 : 0.30);
                  })();
                  return (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius + 8}
                  fill={status.halo}
                  opacity={haloOpacity}
                  data-node-halo-offline-opacity={isOnline ? undefined : (isLight ? 0.45 : 0.30)}
                  data-node-halo-hovered={isHaloHovered ? 'true' : 'false'}
                  data-node-halo-resolved-opacity={haloOpacity}
                  className="transition-[fill,opacity] duration-300 ease-out"
                  data-node-halo-breath={!reducedMotion && session.status === 'working' ? 'on' : 'off'}
                  data-node-halo-breath-offset={
                    !reducedMotion && session.status === 'working'
                      ? ((nodeIdx * 0.37) % 3).toFixed(3)
                      : undefined
                  }
                >
                  {/* Round 278 / Loop: per-node working halo breath
                      (R112+R226+R244 family) RETIRED per Vincent
                      5214/5215-5217 simplification ask (减法 cut #4
                      after R275 chip-row, R276 orbit, R277 legend).

                      The breath was: each working agent's halo pulses
                      0.73→0.92→0.73 (cyber 0.53→0.78→0.53) at 3 s
                      cycle, R226-staggered per-node, R244-eased. For
                      a 4-working fleet that's 4 simultaneous SMIL
                      breaths competing with the hub-halo breath
                      (R244 hub) for the "fleet busyness" visual
                      signal.

                      The signal is info-redundant: the hub-halo
                      breath ALREADY conveys "the network is alive
                      and busy"; per-node halo breath duplicates it
                      at 4× volume. Plus working nodes are ALREADY
                      distinguished by their halo color (status.halo
                      green/teal/slate via R12 trio) — the static
                      halo carries identity, the moving breath was
                      decorative motion on top.

                      R278 gates the SMIL animate with `false &&` so
                      the code remains for rollback. Halo opacity
                      stays at the BASE (non-breathing) values via
                      the parent circle's `opacity` attr (0.85/0.65/
                      0.4/0.25 from R12 + isOnline gate). Working
                      nodes still show green halos; they just don't
                      pulse.

                      Net: -4 SMIL animations on canvas for typical
                      4-working fleet. Combined with R276 orbit
                      retirement (-4) and the hub halo breath kept
                      as the SOLE "fleet busyness" motion signal,
                      the canvas reads quieter. R226 + R244 per-node
                      stagger / ease constants are dead code post-
                      R278 (acceptable — family retires together). */}
                  {false && !reducedMotion && session.status === 'working' && (
                    <animate
                      attributeName="opacity"
                      values={isLight ? '0.73;0.92;0.73' : '0.53;0.78;0.53'}
                      dur="3s"
                      begin={`-${((nodeIdx * 0.37) % 3).toFixed(3)}s`}
                      repeatCount="indefinite"
                      calcMode="spline"
                      keyTimes="0;0.5;1"
                      keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
                    />
                  )}
                </circle>
                  );
                })()}
                {/* Round 111 / Loop: edge-endpoint emphasis ring. R49
                    already keeps endpoint nodes at opacity 1 while
                    others dim when an edge is hovered, but the
                    endpoints had no POSITIVE indicator — they just
                    "stayed bright". An accent stroke at r=radius+7
                    (just inside the halo's r=radius+8 bbox so we
                    don't grow the overlap footprint) clearly says
                    "these are the two participants in this flow".
                    pointerEvents:none so the node hitbox stays alive.

                    Round 182 / Loop: the ring used to mount/unmount
                    on every edge hover, snapping despite the
                    opacity transition on the style. Always-mount
                    with opacity gated by hoveredEdgeEndpoints — same
                    pattern R181 used for the legend pin ring. The
                    transition now actually fires on hover entry
                    and exit. 6th surface in the smooth-pin-mirror
                    family (R165/R180/R181 + this round).

                    strokeWidth=1.6 (was 1.5) deliberately escapes
                    the R51 overlap-test sentinel `circle[stroke-
                    width="1.5"]`: an always-mounted r=radius+7 ring
                    inside g[data-node] would otherwise be picked
                    before the actual status ring (r=radius) by
                    querySelector document order, breaking the
                    test's node-bbox read. 1.5 → 1.6 is visually
                    imperceptible (6.7% thicker) but the exact-
                    string CSS attribute selector no longer
                    matches. */}
                {(() => {
                  const isEndpoint = hoveredEdgeEndpoints && hoveredEdgeEndpoints.has(session.alias);
                  /* Round 233 / Loop: endpoint ring picks up a stroke-
                     width thicken on edge-hover, completing the hover-
                     elevation gesture across the whole edge surface.
                     Pre-R233 hovering an edge eased the visible path
                     stroke (R166) and lifted the badge r (R164) — but
                     the two endpoint rings only faded IN (R182
                     opacity gate). Now they ALSO thicken 1.6 → 2.4 on
                     hover, in 180ms ease-out matching R164 badge lift.
                     The endpoint nodes feel like they "rise to meet"
                     the edge as the cursor approaches it, instead of
                     just appearing.

                     1.6 and 2.4 both escape the R51 overlap-test
                     sentinels (1.5 / 3 are reserved) — 2.4 sits
                     comfortably between, visually 50% thicker than
                     baseline so the gesture reads but the radius is
                     unchanged (still r=radius+7) so geometry stays
                     calm and the topo-overlap-test stays green. 9th
                     surface in the hover-elevation family (R51
                     nodes / R135 panels / R142 group boxes / R143-
                     R144 rows / R164 edge badges / R177 hub ring /
                     R229 group-label count brighten / R233 endpoint
                     ring stroke-width). data-edge-endpoint-ring-
                     stroke-width attr surfaces the chosen value for
                     test introspection. */
                  /* Round 442 / Loop: endpoint emphasis ring radius
                     hover lift — r=radius+7 → radius+8 on isEndpoint,
                     closing a 3-axis hover-elevation parity at endpoint
                     ring scope (r + sw + opacity):
                       opacity  R182  0    → 0.85/0.9
                       sw       R233  1.6  → 2.4
                       r        R442  +7   → +8        ← this round
                     Mirrors the 3-axis trios already established at
                     hub hover-ring (R177/R370/R385) and edge badge
                     (R164/R394/R395). Pre-R442 the endpoint ring
                     faded in + thickened on edge-hover but its radius
                     stayed locked at radius+7 — only the paint/weight
                     axes lifted while the GEOMETRY stayed unchanged.
                     +1px (~radius+7 to radius+8) gives a subtle outward
                     pulse on hover without crowding the status ring
                     (which sits at radius from R438 sw3.5 hover) or
                     the halo (radius+8 from R440 opacity hover — the
                     endpoint ring sits at the SAME radius as the halo
                     but with stroke=cyan vs fill=status.halo so they
                     don't visually collide). The transition list
                     extends to include 'r 180ms ease-out' so the new
                     axis eases under the same R233 cadence. SVG `r`
                     on a <circle> uses CSS-property syntax for inter-
                     polation (same idiom R197/R198 used on the
                     legend swatch). data-edge-endpoint-ring-radius
                     attr exposes the resolved value for tests. */
                  const endpointR = isEndpoint ? radius + 8 : radius + 7;
                  return (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      fill="none"
                      stroke={pal.flowEdge}
                      strokeWidth={isEndpoint ? 2.4 : 1.6}
                      opacity={isEndpoint ? (isLight ? 0.9 : 0.85) : 0}
                      data-edge-endpoint-ring
                      data-edge-endpoint-active={isEndpoint ? 'true' : 'false'}
                      data-edge-endpoint-ring-stroke-width={isEndpoint ? 2.4 : 1.6}
                      data-edge-endpoint-ring-radius={endpointR}
                      style={{
                        pointerEvents: 'none',
                        r: `${endpointR}px`,
                        transition: 'opacity 180ms ease-out, stroke-width 180ms ease-out, r 180ms ease-out',
                      } as React.CSSProperties}
                    />
                  );
                })()}
                {/* Round 167 / Loop: extend the node status-ring
                    transition to include stroke-width — symmetric
                    with R165 (pressure-bar width) and R166 (edge
                    stroke-width). Pre-R167 only fill+stroke colors
                    transitioned smoothly; stroke-width snapped from
                    3 (online) to 1.5 (offline) when a session
                    transitioned. With stroke-width in the transition
                    list the ring smoothly contracts as a node goes
                    offline (or expands when it comes back).
                    strokeDasharray stays binary (none ↔ '5 5')
                    because dash values don't interpolate cleanly
                    between continuous and discrete forms.
                    Inline style replaces the Tailwind transition-
                    [fill,stroke] className for stable arbitrary
                    property compilation. Respects prefers-reduced-
                    motion via R29 globals.css blanket override.
                    data-node-status-ring exposes this circle for
                    test probing — the overlap-test guard on
                    stroke-width="3"/"1.5" still works against the
                    DOM attribute value (React-rendered, not
                    interpolated). */}
                {(() => {
                  /* Round 438 / Loop: status ring strokeWidth hover lift —
                     when hoveredAlias matches, the node's status ring
                     thickens by +0.5: online 3 → 3.5, offline 1.5 → 2.
                     Same absolute delta as R435 hub-spoke (idle 1→1.25
                     used Δ +0.25 because rest base was thinner; status
                     ring's heavier rest values 1.5/3 need a bigger
                     +0.5 to register as visible thickening).
                     Status-ring axis joins the node-hover cue stack
                     (now 9 layers including link surfaces):
                       R26  group translateY -2px           per-node geometry
                       R217 stroke tint legendAccent        per-node card
                       R142 drop-shadow boost               per-node card
                       R427 alias letter-spacing            per-node text
                       R428 sub-text letter-spacing         per-node text
                       R429 body opacity 0.94 → 1.0         per-node card
                       R430 hub-spoke α+                    link to hub (paint)
                       R435 hub-spoke sw+                   link to hub (geo)
                       R94  edge α 1.7×                     inter-node link (paint)
                       R436 edge sw 1.15×                   inter-node link (geo)
                       R437 flow-rail sw 1 → 1.5            edge paint-layer
                       R438 status-ring sw +0.5             ring geometry  ← this round
                     R51 sentinel safety: rest values 3 / 1.5 unchanged
                     so the overlap-test selector `circle[stroke-width=
                     "3"]` / `circle[stroke-width="1.5"]` inside
                     g[data-node] still matches at rest. Hover values
                     3.5 / 2 are not in the reserved {1.5, 3} set so
                     the selector wouldn't match them anyway; but the
                     test runs WITHOUT hover so this never matters
                     in practice. R167 stroke-width 300ms transition
                     already in the style list eases the lift for
                     free. data-node-status-ring-hovered exposes the
                     gate for tests. */
                  const isRingHovered = !reducedMotion && hoveredAlias === session.alias;
                  const ringStrokeWidth = isOnline
                    ? (isRingHovered ? 3.5 : 3)
                    : (isRingHovered ? 2 : 1.5);
                  return (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={radius}
                      fill={isOnline ? pal.nodeFill.online : pal.nodeFill.offline}
                      stroke={status.primary}
                      strokeWidth={ringStrokeWidth}
                      strokeDasharray={isOnline ? 'none' : '5 5'}
                      filter={isOnline && !isLight ? 'url(#topo-glow)' : undefined}
                      data-node-status-ring={status.label}
                      data-node-status-ring-hovered={isRingHovered ? 'true' : 'false'}
                      data-node-status-ring-stroke-width={ringStrokeWidth}
                      style={{
                        transition: 'fill 300ms ease-out, stroke 300ms ease-out, stroke-width 300ms ease-out',
                      }}
                    />
                  );
                })()}
                {/* v0.10.0 Hero 1+2 / §3.F server-health node-ring tint.
                    When the host server this agent runs on is in the
                    `red` tier (CPU/Mem/Disk worst-of ≥ 85% per
                    classifyServer threshold), draw a faint amber outer
                    halo at radius+8. strokeWidth=2.5 stays clear of the
                    R51 overlap-test sentinels (1.5 = offline status ring,
                    3 = online status ring). pointerEvents:none so the
                    halo can't intercept node clicks. Falls back silent
                    when host telemetry hasn't shipped yet (hostHealthMap
                    is empty until commhub returns telemetry). Composes
                    with R209 hover-ring (which sits BETWEEN the avatar
                    and this halo on hover — different radii). */
                }
                {(() => {
                  const tier = hostHealthMap.get(session.server);
                  if (tier !== 'red') return null;
                  return (
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={radius + 8}
                      fill="none"
                      stroke={isLight ? '#d97706' : '#fbbf24'}
                      strokeWidth="2.5"
                      opacity="0.6"
                      data-node-server-health="red"
                      data-node-server-host={session.server}
                      style={{
                        pointerEvents: 'none',
                        transition: 'stroke 200ms ease-out, opacity 200ms ease-out',
                      }}
                    />
                  );
                })()}
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
                    /* Round 501 / Loop — vendor avatar inside node circles
                       gains a hover-gated brightness lift. Pre-R501 the
                       avatar <image> was the only per-node surface with
                       NO hover treatment: R26 lifted the card, R242 tinted
                       the card stroke, R427 spread the alias letter-
                       spacing, R500 added the alias drop-shadow, R208
                       lifted the runtime badge ring, R443 thickened
                       the badge icon stroke, R177 brightened the
                       halo — but the most visually-prominent element
                       (the vendor logo / 书生 coin centred in each node)
                       stayed paint-static. R501 closes the per-node
                       hover-affordance arc by adding a 15% brightness
                       lift on hover.
                       Implementation: CSS filter: brightness(1.15)
                       when hoveredAlias === session.alias. Pure paint
                       axis on the <image> element — no geometry change,
                       no bbox shift. Modern-browser supported (Chrome 64+
                       / FF 56+ / Safari 9.1+).
                       Hits 节点视觉 theme. data-node-avatar-hovered
                       attr surfaces the gate for tests.
                       Gated on !reducedMotion as a courtesy (brightness
                       transition < ~50ms still feels instant; the gate
                       avoids the transition cycle for a11y users). */
                    const isAvatarHovered = !reducedMotion && hoveredAlias === session.alias;
                    return (
                      <image
                        href={vendor.logo ?? '/intern_avatar.png'}
                        x={pos.x - size / 2}
                        y={pos.y - size / 2}
                        width={size}
                        height={size}
                        preserveAspectRatio="xMidYMid meet"
                        data-node-avatar={session.alias}
                        data-node-avatar-hovered={isAvatarHovered ? 'true' : 'false'}
                        style={{
                          filter: isAvatarHovered ? 'brightness(1.15)' : undefined,
                          transition: 'filter 200ms ease-out',
                        }}
                      />
                    );
                  }
                  if (vendor.id !== 'unknown') {
                    // Known model house, logo asset not in public/vendors/
                    // yet — vendor-tinted monogram stands in.
                    /* Round 283 / Loop: monogram circle strokeWidth bumps
                       1 → 1.5 per Vincent 5216 "书生头像风格延续 — 其他
                       vendor 头像 plain text/abbreviation 比书生差, polish
                       升级". Without real vendor logo PNG/SVG assets in
                       public/vendors/, the monogram is the visual stand-
                       in; bumping its ring weight from 1 to 1.5 narrows
                       the visual-quality gap with the 书生 image avatar
                       (which is a designed PNG, naturally more
                       substantial). The 1px → 1.5px stroke is the same
                       weight increment R268 used on the chrome-strip
                       border unification — small but perceptible. The
                       prefix-group fallback (line ~5172) stays at
                       strokeWidth=1 since that's for UNKNOWN vendors
                       where less visual weight signals "we don't know
                       what this is" appropriately. */
                    return (
                      <>
                        <circle cx={pos.x} cy={pos.y} r={ar} fill={vendor.mono.bg} stroke={vendor.mono.ring} strokeWidth="1.5" />
                        {/* Round 284 / Loop: known-vendor monogram letter
                            swaps fontFamily monospace → system sans-serif.
                            Continuation of R283 Vincent 5216 "vendor 头像
                            polish 升级". A single centered letter does not
                            benefit from monospace's digit-alignment
                            property — its only effect at this scale is to
                            land a slightly thinner, more code-text-like
                            glyph. The system stack ('-apple-system',
                            'BlinkMacSystemFont', 'Segoe UI', 'Inter',
                            'sans-serif') picks the OS-preferred designed
                            sans-serif, which renders a fuller, more
                            "badge-mark" letterform — narrowing the
                            visual-quality gap with the 书生 PNG (which is
                            a hand-designed image). data-monogram-letter
                            exposes the element for test probing.

                            The prefix-group fallback at line ~5197
                            INTENTIONALLY stays on monospace — same
                            contrast pattern R283 established for ring
                            stroke: "designed glyph" = known vendor,
                            "code text" = unknown vendor bucket. */}
                        <text
                          x={pos.x} y={pos.y} dy="0.34em" textAnchor="middle"
                          fill={vendor.mono.text} fontSize={ar}
                          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
                          fontWeight="700"
                          data-monogram-letter={vendor.initial}
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
                  // Round 208 / Loop: runtime badge joins the micro-lift
                  // radius-axis family. R177 grew the hub ring on hover
                  // (r 14→17); R197 grew the legend swatch (r 5.5→7);
                  // R208 closes the trio at per-node grain — the runtime
                  // badge (CLI/SDK/HTTP indicator at avatar bottom-right)
                  // pops r 7→8 (online) / 5.5→6.5 (offline) when the
                  // parent node is hovered, with stroke 1.5→2 for
                  // matching emphasis. R26 already lifts the label 1.5px
                  // and R194 elevates its drop-shadow; R208 gives the
                  // runtime indicator its own hover acknowledgement so
                  // every per-node surface participates in the gesture.
                  // CSS r-as-property + stroke-width are transitionable
                  // (same support matrix R197/R198/R199 leveraged:
                  // Chrome ≥95 / Safari ≥16 / FF ≥70). data-runtime-
                  // badge-active exposes the gate for tests.
                  const isNodeActive = !reducedMotion && hoveredAlias === session.alias;
                  return (
                    <g style={{ pointerEvents: 'none' }}>
                      <circle
                        cx={bx} cy={by} r={br}
                        fill={pal.containerBg}
                        stroke={rt.color}
                        strokeWidth="1.5"
                        data-runtime-badge={session.alias}
                        data-runtime-badge-active={isNodeActive ? 'true' : 'false'}
                        style={{
                          r: isNodeActive ? `${br + 1}px` : `${br}px`,
                          strokeWidth: isNodeActive ? '2px' : '1.5px',
                          transition: 'r 150ms ease-out, stroke-width 150ms ease-out',
                        } as React.CSSProperties}
                      />
                      {/* Round 443 / Loop: runtime badge inner-icon
                         strokeWidth lift on node hover — 2.4 → 2.8 on
                         isNodeActive. Pre-R443 the outer badge ring
                         lifted (R208 r + sw both grow on hover) but
                         the inner icon path stayed locked at sw=2.4.
                         The two layers of the runtime badge were
                         out of phase: ring thickened, icon stayed
                         thin. R443 closes the 2-axis hover signature
                         on the badge so both ring and icon lift
                         together. +0.4 absolute delta matches the
                         R208 ring's +0.5 sw delta (badge ring 1.5 →
                         2.0 absolute), proportional to the icon's
                         heavier base of 2.4. Pure paint axis;
                         strokeLinecap='round' + strokeLinejoin='round'
                         preserved. transition list extends to include
                         'stroke-width 150ms ease-out' matching R208
                         outer-ring cadence. data-runtime-badge-icon
                         + -active attrs exposed for tests. */}
                      <g transform={`translate(${bx - icon / 2} ${by - icon / 2}) scale(${icon / 24})`}>
                        <path
                          d={rt.iconPath}
                          fill="none"
                          stroke={rt.color}
                          strokeWidth={isNodeActive ? '2.8' : '2.4'}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          data-runtime-badge-icon={session.alias}
                          data-runtime-badge-icon-active={isNodeActive ? 'true' : 'false'}
                          data-runtime-badge-icon-stroke-width={isNodeActive ? '2.8' : '2.4'}
                          style={{ transition: 'stroke-width 150ms ease-out' }}
                        />
                      </g>
                    </g>
                  );
                })()}
                {/* Round 294 / Loop: per-node "working" pulse dot retired.
                    The pulse was R24's per-node working indicator — a
                    small green circle at the top of each working node,
                    SMIL-animated opacity 1→0.25→1. After R278 retired the
                    working halo, R279 retired arrival ping + dispatch
                    pulse, R280 retired backdrop spokes, the pulse dot
                    was the last surviving per-node SMIL animation in
                    the original "working = breathing" visual family.
                    Status info is preserved through 4 redundant signals:
                    status ring green color (R167), label sub-text
                    'working' (R211), chip-row 'X working' count (top
                    of canvas), hub centre digit (R130). With 30+
                    working nodes on a real fleet, 30 simultaneous SMIL
                    pulses add cognitive load with zero new information.
                    Same R275-R281/R290/R291 减法 family idiom — the
                    last 'wiggling per-node decoration' retires. Gated
                    via `{false && ...}` per the R276/R278/R279/R280
                    rollback-friendly pattern; the block stays in the
                    file documented + dead-coded so future readers see
                    the retired pulse-dot rationale + can A/B-restore
                    it by flipping the gate. */}
                {false && (() => {
                  const sse = sseCountFor ?? 0;
                  const dur = sse >= 4 ? '0.7s' : sse >= 2 ? '0.9s' : '1.2s';
                  const visible = session.status === 'working';
                  return (
                    <g
                      data-pulse-wrapper={session.alias}
                      data-pulse-visible={visible ? 'true' : 'false'}
                      style={{
                        opacity: visible ? 1 : 0,
                        transition: 'opacity 300ms ease-out',
                        pointerEvents: 'none',
                      }}
                    >
                      <circle cx={pos.x} cy={pos.y - (radius - 6)} r="2.5" fill={pal.flowParticle} data-pulse-dur={dur} opacity={reducedMotion ? 0.6 : undefined}>
                        {!reducedMotion && (
                          <animate attributeName="opacity" values="1;0.25;1" dur={dur} repeatCount="indefinite" />
                        )}
                      </circle>
                    </g>
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
                      {/* Round 194 / Loop: label card picks up a subtle
                          drop-shadow that intensifies when the node is
                          hovered — pairs the existing R26 1.5px lift
                          with physical weight. Pre-R194 the card lifted
                          1.5 px on hover but had no shadow follow, so
                          the gesture read as "card translated" rather
                          than "card rose off the canvas". Adding a
                          baseline shadow at rest (1px/2px blur) plus a
                          deeper hover state (3-4px/8-12px blur) makes
                          the elevation feel earned.
                          Same R57/R135 hover-elevation idiom that
                          panels already use, now extended to per-node
                          label cards. data-node-label-card-elevation
                          ('idle'/'hover') exposes the state for tests.
                          Filter is theme-aware (light: slate alpha;
                          dark: black alpha) so the shadow stays visible
                          against both surfaces. transition: filter
                          220ms ease-out matches R135's panel-elevation
                          duration so a hovered node + a hovered panel
                          fade at the same rhythm. Reduced-motion users
                          collapse to the rest-state shadow only — no
                          hover differentiation. Per-node filter is
                          gated to showFullLabel which itself is gated
                          to non-dense fleets (≤16 nodes) or hovered/
                          zoomed-in branches, so the cost stays bounded
                          (~20-30 cards max). */}
                      {/* Round 217 / Loop: label card stroke tints to
                          legendAccent (cyan) on parent-node hover,
                          adding a 3rd hover-feedback channel alongside
                          R26 1.5px lift + R194 drop-shadow elevation.
                          The card now responds at three layers when its
                          parent node is hovered: lift (motion) → shadow
                          (depth) → stroke (color tint). All three are
                          gated by the same hoveredAlias === session
                          .alias state so they ease in unison. transition
                          list extends `stroke 220ms ease-out` alongside
                          R194's existing filter 220ms — single pair of
                          eyes on the card reads "this is the focused
                          element" via three independent channels. Pin
                          + chat states don't compete: pinning a node
                          opens chat (R136) but doesn't drive hovered
                          Alias, so this stroke tint is exclusively a
                          pointer-on-target signal. */}
                      {/* Round 246 / Loop: label card chrome picks up
                          fill + opacity in its transition list. R142
                          already eased filter (drop-shadow) + stroke
                          (R217 cyan tint on hover); the rect's fill
                          (pal.labelBox.fill: cyber #020617 ↔ light
                          #ffffff) and theme-derived opacity (0.94
                          cyber / 1 light) still snapped on theme
                          toggle. R211 already closed the alias/sub
                          text-fill snap on the same card; R246
                          closes the chrome-fill snap on the rect
                          BEHIND that text, so the whole card
                          (background + text) transitions as one
                          unit through every theme switch. Same
                          220ms cadence the existing filter/stroke
                          pair uses — coordinated 4-property easing
                          across the card. */}
                      {/* Round 411 / Loop: node label card rx 6 → 8.
                          Pre-R411 the per-node label card painted at
                          rx=6, sitting one tier BELOW the R332/R375/
                          R376 compact-chrome tier (rx=8). Inside the
                          corner-radius cascade family the cards used
                          to be the only "smaller" tier — but the
                          label card is a content-bearing surface
                          (alias + sub text + ring), not a sub-
                          element decoration. R411 lifts rx=6 → 8
                          to align with the compact-chrome / segmented-
                          control tier so all "compact card" surfaces
                          read with the same corner radius.
                          Corner-radius cascade (8 anchors now):
                            R330 canvas             rx 12  (root)
                            R331 panels             rx 10  (recent-signal, legend)
                            R332 minimap container  rx 8   (compact chrome)
                            R375 Layout-toggle      rx 8   (segmented control)
                            R376 nodeSize/zoom      rx 8   (segmented control)
                            R390 hover-detail       rx 10  (panel)
                            R393 minimap viewport   rx 2   (sub-element)
                            R411 node label card    rx 6 → 8  (compact card, this round)
                          Pure paint — rx grows the corner curve
                          inward without changing the card's outer
                          cardW × cardH bbox (cardW=92/cardH=22 for
                          standard nodes per R23 / R187 sizing). R217
                          hover-stroke cyan tint + R142 drop-shadow
                          + R246 fill+opacity 220ms transition list
                          + R211 alias/sub text-fill ease all
                          preserved. data-node-label-card-rx attr
                          exposes the value for tests. */}
                      {/* Round 429 / Loop: node label-card body opacity
                          0.94 → 1.0 on hover (cyber theme). Sibling
                          treatment to R348 panel rect opacity lift —
                          0.92 → 0.97 cyber / 0.97 → 1.0 light at the
                          panel scope. Pre-R429 the cyber theme card
                          sat at 0.94 always; on hover R217 tinted the
                          stroke + R142 grew the drop-shadow + R26
                          lifted the group + R427/R428 spaced the text
                          but the rect itself never solidified —
                          the card glowed brighter through the
                          shadow but the body alpha gap (6 pct) stayed
                          fixed. R429 lifts the body to full alpha on
                          hover so the card reads as a confidently
                          present surface under the cursor (matching
                          the panel-pair pattern). Light theme stays
                          at 1.0 in both states (already maxed). R246
                          transition list already covers opacity 220ms
                          so the lift eases for free. R217 stroke tint
                          + R142 drop-shadow + R211 fill ease all
                          preserved (additive opacity branch only). */}
                      <rect
                        x={-cardW / 2} y={cardTopY} width={cardW} height={cardH} rx="8"
                        fill={pal.labelBox.fill}
                        stroke={!reducedMotion && hoveredAlias === session.alias
                          ? pal.legendAccent
                          : pal.labelBox.stroke}
                        opacity={
                          !reducedMotion && hoveredAlias === session.alias
                            ? 1
                            : (isLight ? 1 : 0.94)
                        }
                        data-node-label-card={session.alias}
                        data-node-label-card-rx="8"
                        data-node-label-card-elevation={
                          !reducedMotion && hoveredAlias === session.alias ? 'hover' : 'idle'
                        }
                        style={{
                          filter: !reducedMotion && hoveredAlias === session.alias
                            ? (isLight
                                ? 'drop-shadow(0 3px 8px rgba(15,23,42,0.20))'
                                : 'drop-shadow(0 4px 12px rgba(0,0,0,0.60))')
                            : (isLight
                                ? 'drop-shadow(0 1px 2px rgba(15,23,42,0.08))'
                                : 'drop-shadow(0 1px 2px rgba(0,0,0,0.30))'),
                          transition: 'filter 220ms ease-out, stroke 220ms ease-out, fill 220ms ease-out, opacity 220ms ease-out',
                        }}
                      />
                      {/* Round 211 / Loop: alias + sub text fill eases on
                          status flip, matching R167 status-ring fill 300ms.
                          Pre-R211 a node going working → idle → offline made
                          the ring smoothly recolor (R167) while the label
                          card's text snap-cut to the new tier hue in a
                          single frame — the node "transitioned its ring,
                          flipped its text". 300ms inline transition syncs
                          all four label-card fills (alias, sub, ring fill,
                          ring stroke) to the same beat so the node reads
                          as one coordinated status change.
                          data-node-alias-text exposes the gate for tests. */}
                      {/* Round 305 / Loop: node alias label text picks
                          up the pin-signature letter-spacing family
                          (R219 / R220) when the node is the chat
                          target. The alias is the per-node identity
                          label inside the label card; when chat is
                          open targeting this node, R242 already adds
                          a cyan-tint stroke to the card. R305 brings
                          the alias text into the same pin-signature
                          family — letter-spacing 0px → 0.5px when
                          chatAlias === session.alias. Same vocabulary
                          R219 established for recent-row text (line
                          ~6354), legend-row text (~6881), and the
                          R220 edge-badge text (~4327, with 0.4 for
                          hot/pin). Now the per-node alias has its
                          own pin signature when chat is open on it.
                          transition list extends 'letter-spacing
                          200ms ease-out' so it eases alongside the
                          existing 300ms fill transition. */}
                      {/* Round 427 / Loop: extend the node alias label
                          letter-spacing family to a 3-tier scale —
                          rest 0px → hover 0.3px → chat-target 0.5px.
                          Pre-R427 the alias text shifted only when
                          chat was actively pinned (R305); pure node-
                          hover left the text dead-typographic while
                          the surrounding card lifted (R26 translateY
                          + R242 stroke + filter cues). R427 adds the
                          missing typographic axis to the hover gesture
                          so the alias text rises with the card.
                          The chat-target tier still wins (0.5 > 0.3)
                          so the pin signature stays at the top of the
                          scale — hover is the mid tier between rest
                          and chat-target.
                          Hover-letter-spacing family extension:
                            R344 chip count digit
                            R345 panel title (R423 sibling)
                            R347 active-links chip
                            R351 vendor chip
                            R420 zoom-level chip
                            R427 node alias text (this round)
                          R211 fill 300ms + R305 letter-spacing 200ms
                          transition list preserved; only the
                          conditional gets a middle case. */}
                      {/* Round 500 / Loop — milestone round, opens
                          per-node alias drop-shadow polish. Extends the
                          R476-R481 drop-shadow visual-polish family to a
                          7th anchor: hovered alias text gains a soft
                          status-coloured text-glow. Pre-R500 hover on
                          a node triggered card-lift (R26 translateY) +
                          card-stroke (R242 tint) + alias letter-spacing
                          (R427 0.3px tier) but the alias TEXT itself had
                          no paint-axis cue beyond fill (R211). R500 adds
                          a drop-shadow on the text glyph itself, so the
                          identity glyph itself lights up under attention
                          — matching the R476 idiom (hub-digit emerald
                          glow on hover) at the per-node identity scope.
                          2px blur radius at 50% alpha — subtler than the
                          R476 hub-digit (3px at 60%) because the alias
                          text is smaller and more numerous (1 per node)
                          so an aggressive glow would multiply into
                          visual noise. Status-coloured (status.text) so
                          the glow inherits the node's working/idle/
                          offline palette — green/cyan/gray respectively.
                          Drop-shadow visual-polish family — 7 anchors:
                            R476 hub digit          hover-gated emerald
                            R477 legend pin-ring    pin-gated   row.fill
                            R478 recent-row pip     fresh-gated cyan
                            R479 group-label text   pin-gated   cyan
                            R480 hot-lane edge      hot-gated   amber
                            R481 zoom-state minimap zoom-gated  cyan
                            R500 node alias text    hover-gated status.text ← this round
                          Filter is paint-only; bbox unchanged; overlap-
                          test invariants hold (R51 selector gated to
                          g[data-node] descendants with strokeWidth
                          sentinels; text element doesn't carry stroke).
                          transition list extends to include 'filter
                          200ms ease-out' alongside the existing fill
                          300ms + letter-spacing 200ms tweens.
                          data-node-alias-glow attr surfaces the hover
                          gate for tests. */}
                      <text
                        x="0" y="1" textAnchor="middle"
                        fill={status.text}
                        fontSize={aliasFs} fontFamily="monospace" fontWeight="700"
                        data-node-alias-text={session.alias}
                        data-node-alias-chat-target={chatAlias === session.alias ? 'true' : 'false'}
                        data-node-alias-hovered={hoveredAlias === session.alias ? 'true' : 'false'}
                        data-node-alias-glow={!reducedMotion && hoveredAlias === session.alias ? 'true' : 'false'}
                        style={{
                          transition: 'fill 300ms ease-out, letter-spacing 200ms ease-out, filter 200ms ease-out',
                          letterSpacing:
                            chatAlias    === session.alias ? '0.5px' :
                            hoveredAlias === session.alias ? '0.3px' : '0px',
                          filter: !reducedMotion && hoveredAlias === session.alias
                            ? `drop-shadow(0 0 2px ${status.text}80)`
                            : undefined,
                        }}
                      >
                        {truncate(session.alias, fullMax)}
                      </text>
                      {/* Round 428 / Loop: node sub-text (status label
                          line beneath the alias) adopts hover letter-
                          spacing tween 0 → 0.2px on hoveredAlias.
                          Sibling treatment to R427 alias-text hover
                          tween (0 → 0.3) — the alias is the primary
                          identity (top-tier kerning 0.3), the sub-text
                          is the secondary status line (one tier lower
                          at 0.2). Now both lines of the label card
                          telegraph hover typographically as one unit,
                          matching the R26 card lift + R242 stroke
                          tint + R975 filter cues. Subtler delta on
                          the sub-text (0.2 vs alias 0.3) preserves
                          the alias > status visual hierarchy at the
                          hover scope. R211 fill 300ms transition
                          preserved (additive letter-spacing branch
                          + appended 'letter-spacing 200ms ease-out'). */}
                      {/* Round 448 / Loop: node sub-text fontWeight
                          400 → 500 (font-medium). Sibling to R363
                          (recent-row text fw 400→500) + R364 (legend-
                          row label fw 400→500) — same "small mono
                          text at fontSize=9-11 needs 500-tier weight
                          for legibility" pattern, now applied to the
                          per-node sub-text line. At fontSize=8-9
                          monospace against the label-card chrome
                          (pal.labelBox.fill cyber #020617 / light
                          #ffffff), the default fw=400 sits at the
                          legibility floor; fw=500 (font-medium) lifts
                          it into a clearly readable band without
                          changing geometry. R211 fill 300ms +
                          R428 letter-spacing 0→0.2 hover + R427
                          alias-text + R429 body opacity all preserved.
                          Pure typography lift; no layout shift; the
                          alias-text fw=700 (R427) still wins so the
                          alias > status hierarchy holds at the type
                          level. data-node-sub-text-font-weight attr
                          exposes the value for tests. */}
                      <text
                        x="0" y={subY} textAnchor="middle"
                        fill={status.primary}
                        fontSize={subFs} fontFamily="monospace"
                        fontWeight="500"
                        data-node-sub-text={session.alias}
                        data-node-sub-text-hovered={hoveredAlias === session.alias ? 'true' : 'false'}
                        data-node-sub-text-font-weight="500"
                        style={{
                          transition: 'fill 300ms ease-out, letter-spacing 200ms ease-out',
                          letterSpacing: hoveredAlias === session.alias ? '0.2px' : '0px',
                        }}
                      >
                        {status.label}{isOnline && sseCountFor != null ? ` sse:${sseCountFor}` : ''}
                      </text>
                    </g>
                  ) : (
                    // Round 212 / Loop: dense plain-text alias gets fill
                    // transition on status flip — extension of R211. Pre-
                    // R212 the dense fallback (denseLayout > 16 nodes,
                    // where label cards collapse to plain text + R110
                    // stroke halo) snap-cut its fill on tier change while
                    // the status ring smoothly transitioned (R167) — the
                    // card-mode equivalent that R211 just fixed at the
                    // ≤16-node grain. Inline transition list combines
                    // R26 transform 200ms (group-hover lift) + R212 fill
                    // 300ms (status flip ease) — Tailwind transition-
                    // transform on className would be displaced by inline
                    // transition, so the transform property is explicit
                    // in the inline list too. The group-hover:-translate-
                    // y-[1.5px] className still fires the transform via
                    // CSS pseudo-class; only the transition-property
                    // moves to inline. Big fleets benefit most — this is
                    // the path users see when their dashboard is busiest.
                    /* Round 452 / Loop: dense plain-text alias rest
                       opacity 0.9 → 0.95. Closes the alpha gap on the
                       dense fleet's per-node label, sibling to R449
                       legend-count-active 0.95→1.0 and R450 minimap
                       viewport rest 0.9→0.95 — same "close the
                       active-presence alpha gap" idiom applied here
                       to the dense-mode alias text at fontSize=9-10
                       monospace. Pre-R452 dense aliases at α=0.9 sat
                       just below full alpha; for un-hovered nodes in
                       a busy >16-node fleet this is the only label
                       readable, so the 10% alpha gap added a subtle
                       "soft-focused chrome" feel where the labels
                       should read as definitive. +0.05 lift makes
                       them confidently present without erasing the
                       status.text + R110 stroke halo + paintOrder
                       layering. R26 group-hover translate + R212
                       fill 300ms transition + R110 stroke=container-
                       Bg halo all preserved. data-node-dense-alias-
                       text-opacity attr exposes the resolved value
                       for tests. */
                    <text
                      x={pos.x}
                      y={pos.y + radius + denseDrop}
                      textAnchor="middle"
                      fill={status.text}
                      fontSize={denseFs}
                      fontFamily="monospace"
                      fontWeight="700"
                      opacity={0.95}
                      className="group-hover:-translate-y-[1.5px]"
                      data-node-dense-alias-text={session.alias}
                      data-node-dense-alias-text-opacity="0.95"
                      style={{
                        pointerEvents: 'none',
                        paintOrder: 'stroke',
                        transition: 'transform 200ms ease-out, fill 300ms ease-out',
                      }}
                      stroke={pal.containerBg}
                      strokeWidth="3"
                    >
                      {truncate(session.alias, isSmall ? 9 : 10)}
                    </text>
                  );
                })()}
                {/* v0.10.0 Hero 3 Wave 1 §3.E — hover detail card.
                    Renders an extended-info SVG card next to the
                    hovered node showing vendor / model / runtime /
                    server fields that don't fit in the compact label
                    card. Position flips to the left when the node is
                    in the right half of the canvas so the card
                    doesn't extend past the viewBox right edge. Only
                    one card is visible at any time (gated on
                    hoveredAlias === session.alias), so layout cost
                    stays bounded.
                    Reuses pal.labelBox.fill / pal.legendAccent for
                    chrome consistency with the existing label card +
                    legend panel. data-topo-hover-detail attribute
                    exposes the element for test probes.
                    Not rendered in dense layout (>16 nodes) — same
                    gate as showFullLabel; dense fleets already have
                    too much per-node chrome competing. */}
                {!reducedMotion && hoveredAlias === session.alias && !denseLayout && (() => {
                  const v = vendorForModel(session.model);
                  const rt = runtimeIdentity(session.runtime);
                  const flipLeft = pos.x > VIEWBOX_W * 0.65;
                  const detailW = 192;
                  const detailH = 88;
                  const detailX = flipLeft ? pos.x - radius - 18 - detailW : pos.x + radius + 18;
                  const detailY = pos.y - detailH / 2;
                  return (
                    <g transform={`translate(${detailX}, ${detailY})`} data-topo-hover-detail={session.alias} style={{ pointerEvents: 'none' }}>
                      {/* Round 387 / Loop: hover-detail panel cyber backdrop
                          opacity 0.94 → 0.97. The hover-detail card is
                          ALWAYS rendered in active-hover context (it IS
                          the hover product), so it should carry the
                          same backdrop weight as the R348 recent-signal /
                          legend panel HOVER state (which lifts 0.92 →
                          0.97 cyber). Pre-R387 the card sat at 0.94
                          cyber, leaving a 0.03 alpha gap against the
                          R348 panel-hover state — small but visible
                          when the hover-detail floats next to a hovered
                          recent-signal panel. R387 unifies them at 0.97
                          so all active-hover panels paint with the same
                          confident backdrop opacity in cyber. Light
                          stays at 0.98 (already at the strong end —
                          R348 light also stays at 0.97/0.98 max).
                          Theme-consistency / canvas-presence polish
                          family (5th anchor):
                            R370 hub hover-ring opacity      0.7  → 0.8   cyber
                            R371 edge-badge rest opacity     0.82 → 0.85  cyber
                            R372 minimap offline-dot opacity 0.5  → 0.6
                            R386 hub-highlight idle opacity  0.9  → 0.95
                            R387 hover-detail panel opacity  0.94 → 0.97  cyber  (this round)
                          data-topo-hover-detail-opacity attr exposes
                          the resolved value for tests. R348 drop-shadow
                          + rx=8 + stroke=pal.legendAccent + fill=pal.
                          labelBox.fill all preserved. */}
                      {/* Round 390 / Loop: hover-detail card rx 8 → 10.
                          Corner-radius cascade family — the hover-detail
                          card is a panel-tier surface (192×88 floating
                          info card with drop-shadow + stroke), so its
                          corner radius should match the R331 panel tier
                          (rx=10) used by the recent-signal and legend
                          panels. Pre-R390 it shared rx=8 with the R332
                          minimap and R375/R376 segmented-control tier
                          (Layout-toggle, nodeSize, zoom wrappers),
                          which is the "compact chrome control" tier —
                          a tier mismatch for a content-bearing panel.
                          Corner-radius cascade (6 anchors now):
                            R330 canvas             rx 12  (root)
                            R331 panels             rx 10  (recent-signal, legend)
                            R332 minimap           rx 8   (compact chrome)
                            R375 Layout-toggle     rx 8   (segmented control)
                            R376 nodeSize/zoom     rx 8   (segmented control)
                            R390 hover-detail      rx 10  (panel — this round)
                          Pure paint change; no layout shift (rx grows
                          the corner curve INWARD without changing the
                          card's outer bbox). data-topo-hover-detail-
                          rx attr exposes the resolved value for tests.
                          R348 drop-shadow + stroke + R387 opacity all
                          preserved. */}
                      <rect
                        x="0" y="0" width={detailW} height={detailH} rx="10"
                        fill={pal.labelBox.fill}
                        stroke={pal.legendAccent}
                        opacity={isLight ? 0.98 : 0.97}
                        data-topo-hover-detail-opacity={isLight ? 0.98 : 0.97}
                        data-topo-hover-detail-rx="10"
                        style={{ filter: isLight ? 'drop-shadow(0 4px 12px rgba(15,23,42,0.16))' : 'drop-shadow(0 4px 12px rgba(0,0,0,0.6))' }}
                      />
                      <text x="10" y="16" fontSize="9" fontFamily="monospace" fill={pal.legendAccent} fontWeight="700">
                        {v.id !== 'unknown' ? v.label : '—'}
                      </text>
                      {/* Round 389 / Loop: hover-detail model line (y=32)
                          fontWeight 400 → 600. R388 lifted body lines
                          (runtime/host/task at fontSize=9) to fw=500;
                          R389 closes the typography hierarchy by giving
                          the model name (the dominant subhead text in
                          the card) its own weight tier. Three-tier
                          ladder now reads cleanly:
                            vendor   fontSize=9  fw=700  (label badge)
                            model    fontSize=10 fw=600  (subhead — this round)
                            body 3×  fontSize=9  fw=500  (R388)
                          One tier step per dimension (size + weight)
                          between adjacent levels — classic editorial
                          hierarchy idiom adapted to a 192×88 SVG card.
                          Sibling to the chip-internal-hierarchy arc
                          (R333-R341/R362/R369) which uses fw=600/500
                          for digit/unit pairs; R389 applies the same
                          fw=600 to a content-bearing identity line.
                          data-topo-hover-detail-model-fw attr exposes
                          the resolved value for tests. pal.legendHeadline
                          fill preserved (R389 doesn't touch color). */}
                      <text x="10" y="32" fontSize="10" fontFamily="monospace" fontWeight="600" fill={pal.legendHeadline} data-topo-hover-detail-model-fw="600">
                        {session.model || 'model · pending'}
                      </text>
                      {/* Round 388 / Loop: hover-detail body lines (the
                          three fontSize=9 lines: runtime, host, task)
                          gain fontWeight=500. Small-text fw lift family
                          (6th anchor) — fontSize 9-10 px text reads
                          consistently bolder at fw=500 than at the
                          default 400 weight at small sizes, especially
                          on the cyber-theme backdrop where stroke-
                          rendering is the limiting factor.
                          Sibling lifts in this family:
                            R363 recent-row alias text         400 → 500
                            R364 legend-row label              400 → 500
                            R366 group-label count tspan       400 → 500
                            R368 +N more flows footer          400 → 500
                            R373 pressure-bar kicker (font-medium)
                            R388 hover-detail body lines       400 → 500 (this round)
                          Tier structure preserved:
                            y=16 vendor (fw=700, headline)
                            y=32 model  (fontSize=10, subhead by size)
                            y=48 runtime / y=64 host / y=80 task (body, now fw=500)
                          The y=80 task line keeps opacity=0.7 so its
                          caption-tier identity stays distinct from the
                          y=48 / y=64 body lines despite shared fw.
                          data-topo-hover-detail-body-fw attr exposes
                          the resolved value for tests. */}
                      <text x="10" y="48" fontSize="9" fontFamily="monospace" fontWeight="500" fill={pal.legendText} data-topo-hover-detail-body-fw="500">
                        {rt ? rt.label : 'runtime · pending'}
                      </text>
                      <text x="10" y="64" fontSize="9" fontFamily="monospace" fontWeight="500" fill={pal.legendText} data-topo-hover-detail-body-fw="500">
                        host · {session.server || 'unknown'}
                      </text>
                      <text x="10" y="80" fontSize="9" fontFamily="monospace" fontWeight="500" fill={pal.legendText} opacity="0.7" data-topo-hover-detail-body-fw="500">
                        {session.task ? truncate(session.task, 28) : 'no recent task'}
                      </text>
                    </g>
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
          {/* Round 227 / Loop: click-ripple SMIL gets ease-out curve.
              Pre-R227 both <animate>s ran with default calcMode=linear,
              which made the ripple grow at constant velocity from
              r0+4 → r0+30 over 500ms — a mechanical "expansion at
              uniform rate" feel that didn't match the rest of the
              topology's interaction vocabulary (every CSS transition
              on hover-lift, status-flip, pin-signature uses
              `ease-out`). On click, the ripple is the user's primary
              "I did that" confirmation feedback — it should feel
              fast-then-settle like a real pressure wave, not metric.

              calcMode="spline" + keyTimes="0;1" + keySplines="0.25 0.1
              0.25 1" maps directly onto CSS cubic-bezier(0.25, 0.1,
              0.25, 1), the canonical ease-out curve. SMIL's keySplines
              uses the same 4 control-point convention as CSS but
              space-separated. Applied to BOTH the r and opacity
              <animate> elements so they ease in lockstep — the ring
              decelerates as it expands and fades, the two motions
              together feeling like one organic pulse.

              One change reaches three click surfaces — hub center
              (R52), node body (R14), edge midpoint badge (R185) — all
              reuse this single ripple element via the shared
              setClickRipple state. data-click-ripple attr surfaces
              the element for test introspection; calcMode attribute
              on the <animate> reflects the ease-out adoption. */}
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
              data-click-ripple
              style={{ pointerEvents: 'none' }}
            >
              <animate
                attributeName="r"
                values={`${clickRipple.r0 + 4};${clickRipple.r0 + 30}`}
                dur="0.5s"
                calcMode="spline"
                keyTimes="0;1"
                keySplines="0.25 0.1 0.25 1"
                fill="freeze"
              />
              {/* Round 403 / Loop: click-ripple SMIL initial opacity
                  0.7 → 0.8. Pre-R403 the ripple's opacity animation
                  faded from 0.7 to 0 over 500ms, providing a clean
                  click-feedback pulse. Theme-consistency / canvas-
                  presence polish family (R370 hub hover-ring +
                  R391 hub-spoke active) already lifted paired
                  hover-state alphas from 0.7 → 0.8. R403 brings
                  click-feedback into that same alpha — three canvas
                  state-feedback indicators (hover-ring, active spoke,
                  click ripple) now share a uniform 0.8 start alpha
                  so the visual "I responded" signal carries the
                  same weight regardless of which state fired it.
                  Pre-R403 invariants preserved: 500ms duration,
                  R227 calcMode='spline' + ease-out keySplines
                  (0.25 0.1 0.25 1), fill='freeze', concurrent r
                  animation. Theme-consistency family (8 anchors):
                    R370 hub hover-ring        0.7  → 0.8
                    R371 edge-badge rest       0.82 → 0.85 cyber
                    R372 minimap offline-dot   0.5  → 0.6
                    R386 hub-highlight idle    0.9  → 0.95
                    R387 hover-detail panel    0.94 → 0.97 cyber
                    R391 hub-spoke active      0.7  → 0.8
                    R392 minimap online-dot    0.9  → 0.95
                    R403 click-ripple start    0.7  → 0.8  (this round)
                  data-click-ripple-start-opacity attr exposes the
                  resolved value for tests. */}
              <animate
                attributeName="opacity"
                values="0.8;0"
                dur="0.5s"
                calcMode="spline"
                keyTimes="0;1"
                keySplines="0.25 0.1 0.25 1"
                fill="freeze"
                data-click-ripple-start-opacity="0.8"
              />
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
              — only the panel chrome lifts.

              v0.10.0 Hero 3 Wave 1 / RFC §3.C (Vincent 5222 holdover):
              hide recent-signal panel when there's no flow to show.
              Pre-v0.10.0 the panel always-mounted with a "no flow yet
              · send a message between agents" placeholder. On a fresh
              fleet that's a full corner of chrome doing nothing —
              exactly the always-mount-stack 5222 calls out. Render the
              panel only when flowLinks actually has rows. R175 fade-in
              still applies — first flow that arrives still eases in.
              Composes with §3.I canvas-corner watermark (only shows
              when this panel is absent). */}
          {flowLinks.length > 0 && (
          <g
            transform="translate(16, 16)"
            data-topo-panel="recent"
            data-topo-panel-hovered={hoveredPanel === 'recent' ? 'true' : 'false'}
            // Round 175 / Loop: corner panels fade-in after the
            // R9/R72/R172/R173/R174 canvas content reveal. Pre-R175
            // recent-signal + legend panels appeared instantly in
            // the corners while nodes/edges/group boxes staggered
            // in around them — felt like 'panels are already
            // there, content shows up'. Delaying the panels to
            // ~700ms (after the first node wave finishes ~540ms
            // and edges begin filling in ~280ms) makes them drop
            // into place AFTER the canvas has revealed.
            // recent-signal panel at 700ms; legend at 800ms below
            // for a soft left-then-right cascade. .anet-fade-in
            // is the same R3 mount-once animation the other 4
            // wave layers use — fifth surface in the family.
            className="anet-fade-in"
            data-topo-panel-fade-delay={700}
            style={{ animationDelay: '700ms' }}
            onMouseEnter={() => setHoveredPanel('recent')}
            onMouseLeave={() => setHoveredPanel(prev => prev === 'recent' ? null : prev)}
          >
            {/* Round 331 / Loop: recent-signal panel rect rx 8 → 10
                for proportional corner-radius rhythm after R330
                bumped the outer canvas wrapper to rounded-xl (12 px).
                Pre-R331 the panel sat at rx=8 (matching the legacy
                rounded-lg wrapper envelope); now it follows the
                wrapper one tier down:
                  outer wrapper      rounded-xl   12 px  (R330)
                  inner SVG panels   rx=10        10 px  (R331)
                  inner detail card  rx=8          8 px  (codex 8f981a9)
                  node label card    rx=6          6 px  (legacy R63)
                Geometry-safe: rx changes paint only, not bbox; the
                topo-overlap-test reads bbox geometry. Sibling change
                at the legend panel rect below (~line 6914) keeps
                the two corner panels symmetric. */}
            <rect
              x="0" y="0" width="230" height="88" rx="10"
              fill={pal.legendBox.fill}
              // Round 423 / Loop: panel rect stroke tints to legendAccent
              // (cyan) on hover — sibling to R217 label-card stroke
              // hover-tint at the panel scope. Pre-R423 the panel rect
              // stroke painted pal.legendBox.stroke (neutral) regardless
              // of hover state, while every other panel hover cue stacked:
              //   R135 drop-shadow boost
              //   R348 rect opacity 0.92 → 0.97 cyber
              //   R345 title letter-spacing 0.3 → 0.4
              //   R423 rect stroke → legendAccent  (this round)
              // Four hover layers now telegraph "you're entering this
              // panel" through structural, paint, and typographic axes
              // simultaneously. R247 transition list already covers
              // stroke 200ms ease-out so the tint eases naturally.
              // Sibling change at the legend panel rect below.
              stroke={hoveredPanel === 'recent' ? pal.legendAccent : pal.legendBox.stroke}
              opacity={hoveredPanel === 'recent' ? (isLight ? 1 : 0.97) : (isLight ? 0.97 : 0.92)}
              style={{
                /* R135: drop-shadow intensifies on panel hover. Base
                   shadow (2px / 6px blur) signals card elevation
                   (R57); hovered (4px / 12px blur) tells the user
                   the whole chrome is interactive territory — rows
                   pin (R116), footer navigates (R133), legend rows
                   pin status (R61). Reuses R18's KPI-card hover-
                   elevation idiom for visual consistency. Theme-
                   aware shadow colour stays the same; just the
                   spread + blur grow.

                   Round 247 / Loop: extend the transition list to
                   include fill + stroke + opacity at 200ms. R135
                   already eased filter (hover drop-shadow); the
                   three theme-driven properties (pal.legendBox.fill
                   cyber #020617 ↔ light #ffffff, pal.legendBox.
                   stroke cyber #1f2937 ↔ light #e2e8f0, opacity
                   0.92 ↔ 0.97) still snapped on theme toggle. Same
                   per-element 4-property easing R246 added to the
                   per-node label card chrome — now applied at the
                   panel scope so the whole panel (background + chrome
                   + shadow) eases as one unit through theme switches. */
                filter: hoveredPanel === 'recent'
                  ? (isLight ? 'drop-shadow(0 4px 12px rgba(15,23,42,0.14))'
                             : 'drop-shadow(0 4px 12px rgba(0,0,0,0.65))')
                  : (isLight ? 'drop-shadow(0 2px 6px rgba(15,23,42,0.08))'
                             : 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))'),
                transition: 'filter 200ms ease-out, fill 200ms ease-out, stroke 200ms ease-out, opacity 200ms ease-out',
              }}
              data-topo-panel-elevation="recent"
            />
            {/* Round 266 / Loop: panel title fill picks up theme-toggle
                transition. Pre-R266 the title "recent signal" had
                fill={pal.legendHeadline} (cyber #e5e7eb ↔ light
                #0f172a) without any inline transition — so the BIGGEST
                text in the recent-signal panel (fontSize 12 fontWeight
                700) hard-flipped color on theme toggle while the panel
                rect (R247) and every row inside (various) eased.
                Sibling treatment to the legend panel title at line
                ~6195 — the panel-pair's titles now ease together. */}
            {/* Round 301 / Loop: panel titles get letterSpacing="0.3"
                for editorial parity with R289 watermark letterSpacing
                + R285 kicker tracking-widest. At fontSize 12 monospace
                fontWeight 700, default 0px letter-spacing reads as a
                code-style label; 0.3px gives it a touch of designed-
                header register without changing the lowercase
                terminal-style aesthetic. Sibling treatment applied
                to recent-signal panel title (here) and legend panel
                title (line ~6556) — both panels share the same
                editorial-text-spacing convention. data-recent-panel-
                title handle unchanged so R266 test still resolves. */}
            {/* Round 345 / Loop: recent-signal panel title gains
                letter-spacing tween 0.3 → 0.4 on panel hover.
                hoveredPanel === 'recent' is set by the panel <g>
                wrapper's onMouseEnter (line ~6263 area). Sibling to
                R344 hover-letter-spacing applied to the +N more
                flows footer — same gesture vocabulary at a panel-
                title scope: hovering the panel chrome spreads the
                title 0.1 px, signalling "this is a coherent unit
                you're entering". transition list extends letter-
                spacing 200ms ease-out alongside existing fill 200ms.
                Round 482 / Loop — add 2nd typographic axis to the
                title: fontWeight 700 → 800 on activeEdgeKey (any
                row hover OR pin propagates from hoveredEdgeKey ??
                pinnedEdgeKey). Pre-R482 the title only responded
                to panel-chrome hover via R345 ls; when a specific
                row was hovered/pinned inside the panel, the title
                stayed flat. R482 closes the gap: when ANY row is
                active inside the panel, the title tightens
                typographically alongside the row's own R143 lift +
                R472 tint + R474 text spread. data tightens under
                attention pattern extension (panel-scope variant
                following R416/R424/R425/R426/R444/R445/R446/R457
                at the chip / panel / hub / edge / count / parent-
                label tiers).
                transition list extends to include 'font-weight
                200ms ease-out' alongside R345's ls + R55's fill
                200ms. data-recent-panel-title-fw exposes the
                resolved weight for tests. */}
            <text x="13" y="21" fill={pal.legendHeadline} fontSize="12" fontFamily="monospace" fontWeight={activeEdgeKey ? '800' : '700'} letterSpacing={hoveredPanel === 'recent' ? '0.4' : '0.3'} style={{ transition: 'fill 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out' }} data-recent-panel-title data-recent-panel-title-fw={activeEdgeKey ? '800' : '700'} data-recent-panel-title-active={activeEdgeKey ? 'true' : 'false'}>recent signal</text>
            {/* R96: header count now matches what the rows show. Pre-R96
                this read "X msgs" off the raw messages array, but the
                rows below render DEDUPED flowLinks — so a fleet with 10
                messages aggregating to 3 pairs read "10 msgs" above
                only 3 rows. Misreads as "where are the other 7?".
                "X flows" mirrors flowLinks.length one-for-one. When
                flows < msgs the chip-row's "N active links · last 2s"
                already tells the operator about traffic volume — no
                duplicate metric needed here.
                R129 / Loop: header gains an amber " · N hot" tail
                when ≥ 1 flowLink has count ≥ 10. The third surface
                of the hot-lane convention (R126 canvas badge / R127
                row count) lives at the panel header so a user
                scanning vertically — header → rows — gets a top-
                level summary before reading each row's amber digit.
                Restructured into a single <text> with <tspan>
                fragments so the amber portion can carry its own
                fill + weight without a sibling <text>. Switched
                anchor x=150 left-justified → x=217 right-justified
                so the count column unifies visually with the legend
                panel's right-justified header (line 3511 — also
                fontSize 10 monospace, also x≈215 textAnchor end).
                data-recent-panel-count stays on the flow tspan so
                the R96 / R128 tests still resolve. data-recent-
                panel-hot-count exposes the hot bucket count. */}
            {(() => {
              const hotFlowCount = flowLinks.filter(l => l.count >= 10).length;
              const hotStroke = isLight ? '#d97706' : '#fbbf24';
              // R162 / Loop: freshness tint on the panel-header
              // count tspan. R161 just colored the chip-row's "N
              // active links · last 5s" bullet by recency; the
              // recent-signal panel header is the panel-side
              // mirror of the same metric (flowLinks.length). Both
              // scopes now speak the same freshness vocabulary,
              // so a glance at either tells the operator whether
              // the network is firing right now. Four nested
              // scopes share one ladder:
              //   canvas edge fade  (R10)
              //   row pip           (R160)
              //   chip bullet       (R161)
              //   panel header      (R162, this round)
              // Same alpha ramp:
              //   ageSec ≤ 30   → 1.0 (fully fresh)
              //   30-300s       → smooth decay 1.0 → 0.25
              //   > 300s        → 0.25 stale floor
              // Hot tail (amber " · N hot" R129) is independent
              // of recency and keeps its own color — recency
              // tints the head; volume colors the tail.
              const recentMs = flowLinks.reduce<number | null>((acc, l) => {
                if (!l.last_at) return acc;
                const t = Date.parse(l.last_at);
                if (Number.isNaN(t)) return acc;
                return acc === null || t > acc ? t : acc;
              }, null);
              const ageSec = recentMs !== null
                ? Math.max(0, (Date.now() - recentMs) / 1000)
                : 999;
              const alpha = ageSec <= 30
                ? 1
                : ageSec <= 300
                  ? 1 - ((ageSec - 30) / 270) * 0.70 /* R358: floor 0.25 → 0.30 lift across 3 freshness scopes */
                  : 0.30; /* R358: stale floor lifted 0.25 → 0.30 — 20% legibility bump while preserving fresh/stale ratio */
              // Dark cyan-400 / light teal-600 with alpha — same
              // palette as R161's chip bullet so the two scopes
              // visually align even side-by-side.
              const freshFill = isLight
                ? `rgba(13, 148, 136, ${alpha.toFixed(2)})`
                : `rgba(34, 211, 238, ${alpha.toFixed(2)})`;
              return (
                <text
                  x="217" y="21"
                  textAnchor="end"
                  fontSize="10"
                  fontFamily="monospace"
                  // Round 349 / Loop: editorial letter-spacing 0.2 on the
                  // recent-signal panel header count. Sits one tier below
                  // the R301 panel title letterSpacing="0.3" so the panel
                  // header reads as a 2-step hierarchy (title 0.3 / count
                  // 0.2). Sibling change on the legend panel count below
                  // closes the panel-pair editorial symmetry. Joins the
                  // R285 / R289 / R301 / R302 / R304 / R325 editorial-
                  // letterspacing tier at the panel-summary scope. The
                  // R162 freshness fill, R225 tabular-nums, R311 fw=600,
                  // R336 unit-tspan opacity-0.7 split all preserved —
                  // the tier propagates to all descendant tspans via
                  // SVG inheritance. data-recent-panel-count-letter-
                  // spacing exposes the value for tests.
                  letterSpacing="0.2"
                  data-recent-panel-count-letter-spacing="0.2"
                >
                  {/* Round 225 / Loop: tabular-nums on the panel-header
                      flow-count tspan. The "{N} flows" string lives in
                      a right-justified text anchor (x=217 textAnchor=
                      'end') so the BASELINE of the numeral is the same
                      regardless of digit-count — but the SPACING between
                      the digit and ' flows' label is monospace-jittery
                      in the 1-digit → 2-digit boundary, and the ' · N
                      hot' R190 tail that hangs off the end shifts by
                      whatever the digit width delta is. Tabular-nums
                      locks both, so the header reads stable through
                      9 flows → 10 flows growth. Sibling treatment to
                      R224 edge badge / R225 hub digit. */}
                  {/* Round 311 / Loop: recent-signal panel count tspan
                      picks up fontWeight=600 for sibling parity with
                      R310 legend panel count. Closes the panel-pair
                      count typography symmetry — both top-corner
                      panels now have:
                        title fontWeight=700 (panel chrome anchor)
                        count fontWeight=600 + tabular-nums (data)
                      Same digit-semibold rule R309 established for
                      per-row counts now applied to BOTH panel-summary
                      counts. The R162 freshness fill (1.0→0.25 alpha
                      ramp) and R225 tabular-nums all preserved; only
                      the weight bumps. */}
                  {/* Round 336 / Loop: split the digit from the unit
                      word " flows" with a nested tspan at opacity=0.7.
                      Same chip-internal-hierarchy pattern R333 (vendor
                      count suffix) + R335 (filter pin prefix) applied
                      to one chip — recurring "small label spans demote,
                      value stays prominent" idiom at the panel-header
                      count scope. The digit stays fw=600 + tabular-nums
                      (R311 + R225 inheritance via the outer tspan);
                      the unit tspan inherits fw=600 but adds opacity
                      0.7. Reads as "5 (prominent) / flows (recessive
                      unit)". data-recent-panel-count attribute stays
                      on the OUTER tspan so existing R311 fontWeight
                      tests + count value reads still resolve via
                      .textContent. data-recent-panel-count-unit on
                      the inner unit tspan for R336 introspection. */}
                  {/* R424 — recent-signal panel count digit fontWeight
                      600 → 700 on panel hover. Closes the 5-layer panel
                      hover cue stack with a typographic-weight axis at
                      the panel-header data scope: depth (R135 drop-
                      shadow) + solidity (R348 fill opacity) + spacing
                      (R345 title letter-spacing) + edge color (R423
                      stroke tint) + weight (THIS, digit fw). Sibling
                      pattern to R416 chip-digit-hover-bold at chip
                      scope — same "data tightens under attention"
                      idiom now at the panel-header data scope. R311
                      base fw=600 + R225 tabular-nums + R162 fill
                      transition + R336 unit-tspan opacity-0.7 all
                      preserved; only the weight axis tweens via R247's
                      transition shape (added font-weight to the list). */}
                  <tspan
                    fill={freshFill}
                    fontWeight={hoveredPanel === 'recent' ? '700' : '600'}
                    data-recent-panel-count
                    data-recent-panel-count-freshness-alpha={alpha.toFixed(2)}
                    style={{
                      transition: 'fill 200ms ease-out, font-weight 200ms ease-out',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >{flowLinks.length}<tspan opacity="0.7" data-recent-panel-count-unit> flows</tspan></tspan>
                  {/* Round 190 / Loop: R129 hot-tail gets anet-fade-in
                      for entrance. Pre-R190 the tspan snapped into
                      the header the moment hotFlowCount crossed 0,
                      and snapped out the moment it dropped back to 0.
                      Same trade-off R67 accepts for filter pills:
                      fade-IN smooth, accept exit snap. The CSS
                      animation plays once when the tspan mounts
                      (count goes 0 → 1+); subsequent re-renders
                      (count growing from 1 → 2 → 3 hot flows)
                      preserve the element via React reconciliation
                      so the fade-in doesn't replay. Layout-shift
                      cost is paid once on entrance — the parent
                      <text textAnchor="end"> recomputes its
                      anchor as the tspan appears, then stays
                      stable as the digit grows. Exit-snap is rare
                      in steady operation: a hot flow cooling back
                      below 10 messages doesn't happen often. */}
                  {/* Round 223 / Loop: hot-tail tspan always-mounts;
                      visibility crossfades via inline opacity gate
                      instead of conditional mount/unmount on hot
                      FlowCount > 0. Pre-R223 R190's anet-fade-in gave
                      a smooth entrance but exit was snap (the family's
                      original "fade-IN smooth, accept exit snap" trade-
                      off). R223 closes the asymmetry — both directions
                      now ease 300ms. anet-fade-in className kept for
                      R190 test compat (plays once on initial render
                      if the page loads with hotFlowCount > 0); subsequent
                      threshold crossings use the opacity transition
                      bi-directionally. Text content gates to empty
                      string when hidden so the parent <text textAnchor=
                      "end"> doesn't compute anchor against stale "·"
                      separator. data-recent-panel-hot-visible exposes
                      the gate for tests. Always-mount-opacity-gate
                      family now hits 10 surfaces (R181/R182/R183/R213×2/
                      R214/R215/R221/R222/R223). */}
                  {/* Round 322 / Loop: hot count tspan picks up
                      fontVariantNumeric tabular-nums for parity with
                      its left-sibling tspan (R311 `{flowLinks.length}
                      flows`, already tabular). Pre-R322 a hotFlowCount
                      crossing 1→10 widened the leading digit and (since
                      the parent <text> is textAnchor="end") shifted the
                      WHOLE header left a few pixels — visible micro-
                      jitter against the panel rect's left edge. Tabular-
                      nums locks the digit so the right-anchored block
                      stays stable as hotFlowCount grows. 8th surface
                      in the info-density tabular-nums sweep:
                        R224 edge badge / R225 hub digit / R225 panel
                        flows-count + recent-row count / R229 group-
                        label count / R230 group-label status pips /
                        R320 recent-row count fw=600 (left neighbour) /
                        R321 recent-row timestamp / R322 panel hot
                        count (this round). */}
                  <tspan
                    fill={hotStroke}
                    fontWeight="700"
                    data-recent-panel-hot-count={hotFlowCount}
                    data-recent-panel-hot-visible={hotFlowCount > 0 ? 'true' : 'false'}
                    className="anet-fade-in"
                    opacity={hotFlowCount > 0 ? 1 : 0}
                    style={{
                      transition: 'opacity 300ms ease-out',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {/* Round 336 / Loop: split hot count from " hot"
                        unit word with nested opacity-0.7 tspan. Same
                        chip-internal-hierarchy idiom this round
                        applies to the "{N} flows" tspan above (R311
                        sibling) — digit prominent at fw=700 + amber
                        fill, unit recessive at 0.7 opacity. data-
                        recent-panel-hot-count-unit exposes the unit
                        tspan for R336 probes. */}
                    {hotFlowCount > 0 ? (
                      <>
                        {` · ${hotFlowCount}`}
                        <tspan opacity="0.7" data-recent-panel-hot-count-unit> hot</tspan>
                      </>
                    ) : ''}
                  </tspan>
                </text>
              );
            })()}
            {/* Round 45 / Loop: empty state. The panel used to render
                "recent signal" + "0 msgs" with three blank slots below
                when no flow yet — read as "broken" rather than "quiet".
                A muted centred placeholder makes the empty state
                deliberate. Messages count CAN diverge from flowLinks
                count (raw count vs. deduped pairs), so the placeholder
                fires on flowLinks.length=0 specifically. */}
            {/* Round 222 / Loop: empty state always-mounts; visibility
                crossfades via wrapper <g> opacity instead of conditional
                mount/unmount on flowLinks.length === 0. Pre-R222 the
                first flow arriving snap-removed the empty state in one
                frame while R203 rows simultaneously faded IN — half-
                smooth, half-snap on this "first data" first-impression
                moment. R222 closes the snap so empty fades OUT while
                rows fade IN — a proper crossfade for the user's most
                emotionally-loaded moment (the empty-to-populated flip).

                R200 SMIL breath on each text continues running
                regardless of parent opacity (SVG opacity is
                multiplicative — same R214 pulse-dot composition idiom).
                When parent opacity is 0, SMIL still animates child
                opacity but the result composes to invisible. CSS and
                SMIL don't fight, they layer.

                300ms transition matches R203 row fade-in pace so the
                empty-fade-out + rows-fade-in pair share rhythm during
                the crossfade. */}
            <g
              data-recent-signal-empty-wrapper
              data-recent-signal-empty-visible={flowLinks.length === 0 ? 'true' : 'false'}
              style={{
                opacity: flowLinks.length === 0 ? 1 : 0,
                transition: 'opacity 300ms ease-out',
                pointerEvents: 'none',
              }}
            >
              {/* Round 258 / Loop: re-center the empty state within the
                  post-R256 88-tall panel. R45 placed "no flow yet" at
                  y=54 + the hint at y=68 inside an 84-tall panel — those
                  baselines sat 12px / 26px below the panel mid-line at
                  y=42, optically balanced for the original height. R256
                  grew the panel 84 → 88 to give the "+N more flows"
                  footer underline breathing room, shifting the panel
                  mid-line to y=44 — but the empty state stayed put,
                  drifting 2px high. R258 pushes both empty-state lines
                  +2 (main y=54 → y=56, hint y=68 → y=70) so the pair
                  sits 12px / 26px below the new mid-line, restoring
                  the R45 optical balance. The R222 always-mount opacity
                  gate is unaffected (geometry-only shift), and the
                  R200 SMIL breath continues unchanged. Hint baseline
                  y=70 still sits 12px above the footer baseline (y=82),
                  same vertical rhythm as the row 3 → footer gap. */}
              {/* Round 302 / Loop: empty-state hint 'no flow yet' picks
                  up letterSpacing='0.2' for editorial parity with R301
                  panel titles (0.3) + R285 kicker tracking-widest +
                  R289 watermark letterSpacing. The hint is the
                  panel's quietest authored text (italic monospace
                  fontSize 10 opacity 0.65); adding a small positive
                  letter-spacing keeps it in the same designed-label
                  family without lifting its visual weight. 0.2px is
                  slightly less than the panel titles' 0.3 — appropriate
                  for the smaller fontSize + lower opacity (empty-state
                  is intentionally quieter than the header above it). */}
              <text
                x="115" y="56" textAnchor="middle"
                fill={pal.legendText}
                fontSize="10" fontFamily="monospace" fontStyle="italic"
                letterSpacing="0.2"
                opacity={0.65}
                data-recent-signal-empty
                data-recent-signal-empty-breathes={reducedMotion ? 'false' : 'true'}
              >
                no flow yet
                {!reducedMotion && (
                  <animate
                    attributeName="opacity"
                    values="0.55;0.78;0.55"
                    dur="4.4s"
                    repeatCount="indefinite"
                  />
                )}
              </text>
              {/* Round 259 / Loop: instructional hint bumps fontSize 8 → 9
                  for readability. Pre-R259 the empty-state hint was at
                  the smallest readable size on the canvas (8pt), with
                  italic + opacity 0.45 layering legibility cost on top
                  — instructional text users need to READ to act on,
                  yet eye-straining at default 1× zoom. 9pt italic stays
                  visually subordinate to the 10pt main "no flow yet"
                  AND to the 9pt regular row text (italic alone
                  discriminates from row content) while easing the
                  legibility floor. Sibling change at the +N-more
                  footer link (line ~6047) applies the same bump to
                  the panel's other italic secondary text. Per-row
                  timestamp at y=38+i*16 (fontSize 8 right-edge
                  recency tag) STAYS at 8 — it's an at-a-glance
                  recency tag tightly co-located with row text, not
                  read-to-act instruction. */}
              {/* Round 304 / Loop: secondary instructional hint
                  'send a message between agents' gets letterSpacing
                  '0.15'. Extends the R301/R302 editorial-spacing
                  family one layer down. The hint is the quietest
                  authored text in the recent-signal panel (fontSize
                  9 italic-less opacity 0.45, sits below the R302
                  main empty-state hint at fontSize 10 italic
                  opacity 0.65). 0.15px is below R302's 0.2px to
                  match the visual hierarchy: smaller + quieter
                  text gets less letter-spacing.
                  5-axis editorial-letterspacing hierarchy now:
                    R285 kicker:        1.2px (eyebrow loud)
                    R289 watermark:     0.5px (wordmark brand)
                    R301 panel titles:  0.3px (section headers)
                    R302 empty main:    0.2px (empty-state hint)
                    R304 empty hint:    0.15px (instructional sub)
                  Each step ~0.1-0.5x scale-down matches the
                  font-size + opacity descent. */}
              {/* Round 339 / Loop: empty-state sub-hint picks up
                  fontStyle="italic" for parity with the main hint
                  above (line ~6526). Pre-R339 the main hint "no
                  flow yet" was italic while the sub-hint "send a
                  message between agents" was upright — two empty-
                  state texts sharing the same quiet informational
                  role but rendered in different styles. R339 closes
                  the inconsistency: both texts now read as deliberate
                  italic empty-state messaging. The R304 letter-
                  spacing 0.15 + R259 fontSize 9 + opacity 0.45 +
                  SMIL opacity breath all preserved. */}
              <text
                x="115" y="70" textAnchor="middle"
                fill={pal.legendText}
                fontSize="9" fontFamily="monospace" fontStyle="italic"
                letterSpacing="0.15"
                opacity={0.45}
                data-recent-signal-empty-hint
                data-recent-signal-empty-hint-breathes={reducedMotion ? 'false' : 'true'}
              >
                send a message between agents
                {!reducedMotion && (
                  <animate
                    attributeName="opacity"
                    values="0.36;0.58;0.36"
                    dur="4.4s"
                    begin="-1.5s"
                    repeatCount="indefinite"
                  />
                )}
              </text>
            </g>
            {flowLinks.length === 0 ? null : (
              // Round 56 / Loop: each row is a navigator into the canvas.
              // Hover a row → set hoveredEdgeKey, which the existing R50
              // edge-focus + R49 endpoint-highlight ladders consume. The
              // matching flow edge brightens to 2× + thickens, its two
              // endpoint nodes stay full opacity, and every other edge +
              // non-endpoint node dims. Released → all restore. Wrapping
              // <g> + a transparent 218×14 hitbox so the cursor doesn't
              // have to land precisely on the truncated text.
              flowLinks.slice(0, 3).map((link, index) => {
                // Round 94 / Loop: per-row relative timestamp. The chip
                // row shows "last 2s" for the most recent flow overall,
                // but a user scanning the recent-signal panel had no way
                // to tell whether row 2 was 5s old or 5m old without
                // hovering nodes. Compact `2s` / `1m` glyph at the
                // right edge — same relativeAgo helper R42 uses for
                // the chip — pulls double duty as a recency anchor and
                // a sortedness hint (top row is freshest by construction).
                // Strip the " ago" suffix — at fontSize=8 in a 32-px
                // right-edge slot, every char counts. "30s ago" → "30s".
                const rawAt = link.last_at ? relativeAgo(link.last_at) : null;
                const lastAt = rawAt ? rawAt.replace(/\s+ago$/, '') : null;
                const isRowHovered = hoveredEdgeKey === link.key;
                const isRowPinned  = pinnedEdgeKey === link.key;
                const isRowActive  = isRowHovered || isRowPinned;
                // Round 191 / Loop: timestamp text on row's right edge
                // picks up the R160 row-pip freshness ramp at a
                // different alpha range — gives the timestamp the same
                // visual recency encoding the pip has on the LEFT
                // edge, so both ends of the row mirror each other.
                //   ≤30s   → opacity 0.85 (fresh, high contrast)
                //   30-300s → 0.85 → 0.30 (smooth decay)
                //   >300s  → 0.30 (stale floor)
                // Pre-R191 the timestamp was static 0.55 — the same
                // visual weight whether the message just fired or
                // happened 5 minutes ago. Fill stays legendText gray
                // (not cyan) because the left pip already carries the
                // cyan; the right timestamp encodes recency through
                // contrast against the dark canvas, not hue.
                const tsAlpha = !link.last_at ? 0.55 : (() => {
                  const ageSec = Math.max(0, (Date.now() - Date.parse(link.last_at)) / 1000);
                  return ageSec <= 30   ? 0.85
                       : ageSec <= 300  ? 0.85 - ((ageSec - 30) / 270) * 0.55
                                        : 0.30;
                })();
                // R127: panel-side mirror of R126's canvas hot-badge.
                // The recent-signal row text packs `alias→alias / N /
                // preview` into one line, with N rendered identically
                // regardless of magnitude. Now that the canvas badge
                // tells the user "≥ 10 msgs = hot lane" via amber
                // stroke, the panel row needs the same affordance so
                // the user reading the list at a glance can spot hot
                // lanes without crossing to the canvas. Renders the
                // count digit in amber + 700-weight when isHot; the
                // surrounding alias text + separators stay in the
                // existing legendText/legendHeadline palette. Reuses
                // R126's hotStroke colour for visual consistency.
                const isHot = link.count >= 10;
                const hotStroke = isLight ? '#d97706' : '#fbbf24';
                return (
                  <g
                    key={link.key}
                    data-recent-row={link.key}
                    data-recent-row-hovered={isRowHovered ? 'true' : 'false'}
                    data-recent-row-pinned={isRowPinned ? 'true' : 'false'}
                    data-recent-row-hot={isHot ? 'true' : 'false'}
                    data-recent-row-lifted={(isRowHovered || isRowPinned) ? 'true' : 'false'}
                    // Round 203 / Loop: per-row mount fade-in. R175 already
                    // eased the whole panel in once, but new flows rising
                    // INTO the top-3 list (or replacing an older row) snap-
                    // popped in. React reconciliation via key={link.key}
                    // preserves stable rows across re-renders, so anet-
                    // fade-in only plays on mount — never replays when
                    // counts update or rows reorder by recency. Stacks on
                    // the panel's own R175 anet-fade-in: SVG opacity
                    // composes multiplicatively, so during the first paint
                    // the panel's 700ms delay holds rows hidden until the
                    // panel reveals, then row opacity transitions inside
                    // the visible panel. For mid-session arrivals (panel
                    // already at opacity 1) the row's 150ms fade-in plays
                    // standalone. Three layers of mount-once eases now
                    // share rhythm: panel (R175) → rows (R203) → row
                    // contents (existing R160 pip / R191 ts opacity
                    // ramps animate independently after mount).
                    className="anet-topo-svg-focus anet-fade-in"
                    role="button"
                    tabIndex={0}
                    aria-pressed={isRowPinned}
                    // R143 / Loop: extend the R135/R142 "interactive surface
                    // elevates" idiom down one layer to the recent-signal
                    // panel rows. R104 already tints the row background on
                    // hover; R143 adds a 1-px translate so the row text
                    // visually lifts off the panel — same vocabulary R51
                    // uses for nodes, R135 uses for panels, R142 uses for
                    // group boxes. Pinned rows lift too (sticky state
                    // should look like locked-in selection). Reduced-motion
                    // safe via prefers-reduced-motion blanket override
                    // applied to transition-duration in globals.css.
                    style={{
                      cursor: 'pointer',
                      transform: (isRowHovered || isRowPinned) ? 'translateY(-1px)' : undefined,
                      transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onMouseEnter={() => setHoveredEdgeKey(link.key)}
                    onMouseLeave={() => setHoveredEdgeKey(prev => prev === link.key ? null : prev)}
                    // R116: click toggles pin. activeEdgeKey =
                    // hoveredEdgeKey ?? pinnedEdgeKey so the matching
                    // edge stays "hot" after mouseleave; click again
                    // (or Esc) releases.
                    onClick={() => setPinnedEdgeKey(prev => prev === link.key ? null : link.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setPinnedEdgeKey(prev => prev === link.key ? null : link.key);
                      }
                    }}
                  >
                    {/* R148 / Loop: row tooltip with full message context.
                        The row text truncates aliases to 6 chars (R127)
                        and content to 8 chars — useful for scan-density
                        but obscures the underlying message. A native SVG
                        <title> reveals the full alias / content /
                        timestamp on hover. Pinned vs unpinned switches
                        the click hint so the user knows the next
                        gesture's effect. R98 enriched the node tooltip
                        the same way for the source/destination scope;
                        R148 brings the per-row equivalent to the panel
                        side. */}
                    <title>{[
                      `${link.from} → ${link.to} · ${link.count} msg${link.count === 1 ? '' : 's'}${isHot ? ' (hot lane · ≥ 10)' : ''}`,
                      link.last_at ? `last: ${new Date(link.last_at).toLocaleString()}` : null,
                      link.content ? `"${link.content}"` : null,
                      isRowPinned ? 'click to release pin (Esc to clear)' : 'click to pin · hover to preview',
                    ].filter(Boolean).join('\n')}</title>
                    {/* R104: subtle row-background tint on hover. R56
                        already brightens the matching edge on the canvas,
                        but the panel row itself stayed flat — felt more
                        like text-with-handlers than a navigable list.
                        Filling the rect at hover with `pal.legendAccent`
                        at low alpha gives the row visual feedback at the
                        source surface, mirroring the list-item idiom from
                        the chip-row pills. R116: pinned rows tint
                        stronger than hovered ones so locked vs preview
                        is discriminable. */}
                    {/* Round 472 / Loop — cadence-sync follow-on to the
                       R459/R460/R461/R464/R465/R470 200ms uniform
                       motion stack established at the cluster scope.
                       This R104 recent-signal row tint rect was still
                       at the legacy 150ms cadence — when a user
                       hovers/pins a recent-signal row, the tint
                       snapped in 50ms ahead of the rest of the row's
                       state-change cascade (R143 translateY,
                       R220+R434 letter-spacing, R434 fill tween).
                       R472 lifts to 200ms ease-out to match. Same
                       sibling idiom R459 closed at the group-label
                       hitbox tier; now applied at the recent-signal
                       row tier. data-recent-row-tint-transition attr
                       exposes the cadence for tests.
                       Geometry/paint logic unchanged — purely the
                       transition timing. */}
                    <rect
                      x="6" y={38 + index * 16 - 10}
                      width="218" height="14" rx="3"
                      fill={isRowActive ? pal.legendAccent : 'transparent'}
                      opacity={isRowPinned ? (isLight ? 0.18 : 0.22)
                              : isRowHovered ? (isLight ? 0.10 : 0.14)
                              : 1}
                      data-recent-row-tint={link.key}
                      data-recent-row-tint-transition="200ms"
                      style={{ transition: 'fill 200ms ease-out, opacity 200ms ease-out' }}
                    />
                    {/* Round 160 / Loop: recency pip. Canvas flow edges
                        fade by freshness (R10: full intensity ≤30s →
                        ~35% over 5min). The recent-signal panel rows
                        duplicate that data (alias→alias · N · 5s)
                        but encode freshness purely in text — no
                        at-a-glance visual cue for "which row is
                        actively firing right now". A 1.6-px cyan dot
                        at x=10 (in the 7-px margin between rect-
                        start x=6 and text-start x=13) brightens
                        fresh rows and dims stale ones — same
                        vocabulary the canvas uses, brought to the
                        panel side.

                        Three encodings now coexist on each row,
                        none competing:
                          rect fill   = hover/pin state (R104/R116)
                          count tspan = magnitude (R127 amber when ≥10)
                          pip         = recency (this round)

                        Geometry: cy = row_y - 3 (mid-row vertical
                        centre, where text baseline at y=row_y sits
                        slightly below). r=1.6 fits cleanly in the
                        7-px left margin. pointerEvents:none so the
                        row's button-role hit area is unchanged.
                        No overlap-test impact (entirely within the
                        existing rect bbox). */}
                    {(() => {
                      if (!link.last_at) return null;
                      const ageSec = Math.max(0, (Date.now() - Date.parse(link.last_at)) / 1000);
                      // 0-30s: fully fresh (1.0). 30-300s: smooth
                      // decay 1→0.25. >300s: stale floor (0.25).
                      const alpha = ageSec <= 30
                        ? 1
                        : ageSec <= 300
                          ? 1 - ((ageSec - 30) / 270) * 0.70 /* R358: floor 0.25 → 0.30 lift across 3 freshness scopes */
                          : 0.30; /* R358: stale floor lifted 0.25 → 0.30 — 20% legibility bump while preserving fresh/stale ratio */
                      return (
                        <circle
                          cx={10}
                          cy={38 + index * 16 - 3}
                          /* Round 359 / Loop: recency pip base radius
                             1.6 → 1.8. Sibling lift to R358's freshness-
                             floor bump (alpha 0.25 → 0.30) — pre-R358/
                             R359 the stale pip painted at r=1.6 + α=0.25
                             which read as near-invisible chrome. R358
                             gave it more alpha; R359 gives it more area
                             (1.8² / 1.6² ≈ 1.27, so ~27 % more glyph)
                             so the pip stays distinguishable across the
                             freshness ramp. Geometry: 1.8-radius dot
                             centred at (10, row_y - 3) is bbox 3.6×3.6,
                             still well inside the 7-px left margin
                             (x=6 rect-start → x=13 text-start) the R160
                             pip was placed in. Overlap-test reads the
                             parent row rect's bbox, not this pip's, so
                             grid+ring invariants hold. Matches the same
                             1.6 → 1.8 visual-weight bump R295 applied
                             to the legend swatch (5.5 → 6 base radius)
                             and R287 to the minimap viewport stroke
                             (1 → 1.5). data-recent-row-freshness-radius
                             attr exposes the value for tests. */
                          /* Round 383 / Loop: recency pip base radius
                             1.8 → 2.0. Continues the R359 lift
                             trajectory — pip area grows ~23 % (π·2²/
                             π·1.8² ≈ 1.23) for a clearer at-a-glance
                             freshness anchor in each row. Bbox 4.0×4.0
                             still inside the 7-px R160 left margin
                             (3-px remaining clearance vs 3.4 at r=1.8
                             — geometry-safe margin holds). Sibling
                             visual-weight bump family (9th anchor now):
                               R287 minimap viewport stroke 1 → 1.5
                               R295 legend swatch base radius 5.5 → 6
                               R359 recent-row pip base radius 1.6 → 1.8
                               R360 hub digit fontSize 11 → 12
                               R361 edge-badge digit fontSize 10 → 11
                               R365 hub-highlight base radius 5 → 5.5
                               R367 edge-badge rest stroke 1 → 1.25
                               R374 pressure-bar height 1.5 → 2
                               R383 recent-row pip radius 1.8 → 2.0  (this round)
                             data-recent-row-freshness-radius attr
                             bumps to '2.0' for tests. */
                          /* Round 447 / Loop: recent-row freshness pip
                             radius lift on (isRowHovered || isRowPinned)
                             — r 2.0 → 2.5 (+0.5px, sibling to R442
                             endpoint-ring r lift). Adds a geometric
                             axis to the recent-row hover/pin gesture
                             alongside R143 translateY + R104 row bg-
                             tint + R434 letter-spacing + R445 count
                             fw. Pre-R447 the pip stayed at r=2.0 always
                             — the freshness alpha (R162) tracked
                             recency but didn't telegraph "this row is
                             in focus" geometrically. R447 lifts the
                             pip outward by 25% area (π·2.5² / π·2.0²
                             = 1.56) on attention, closing a 5-axis
                             row-attention signature (geometry + paint
                             + typography + spacing + position).
                             SVG `r` as CSS property for interpolation
                             (R197/R198 idiom). transition list extends
                             to include 'r 200ms ease-out' matching the
                             opacity cadence. data-recent-row-freshness-
                             lifted attr exposes the gate for tests. */
                          /* Round 478 / Loop — extend the R476/R477
                             drop-shadow vocabulary to a third anchor:
                             the recent-row freshness pip on `alpha
                             > 0.7` (just-fired flow within ~30s per
                             R10 freshness ramp). Gate is FRESHNESS-
                             driven not pin/hover-driven, so the glow
                             reads as "this signal is live" rather
                             than "user is inspecting". As the alpha
                             decays past 0.7 (≈45s after last fire),
                             the glow eases off — natural breathing
                             feel that tracks actual data freshness.
                             Hue: pal.legendAccent at 0.5 alpha so
                             the glow inherits the row's accent color
                             family. 2.5-3px blur reads as soft
                             radiance, not loud bloom.
                             Drop-shadow visual-polish family now 3
                             anchors:
                               R476  hub digit         hover-gated
                               R477  legend pin-ring   pin-gated
                               R478  recent freshness  freshness-gated
                             Each anchor uses a different state gate
                             but the same `filter: drop-shadow` paint
                             vocabulary. Filter affects paint only —
                             bbox unchanged, overlap-test invariants
                             hold. Transition list extends to include
                             'filter 200ms ease-out' alongside
                             R10/R447 opacity + r tweens. */
                          fill={pal.legendAccent}
                          opacity={alpha}
                          data-recent-row-freshness={link.key}
                          data-recent-row-freshness-alpha={alpha.toFixed(2)}
                          data-recent-row-freshness-radius={(isRowHovered || isRowPinned) ? 2.5 : 2.0}
                          data-recent-row-freshness-lifted={(isRowHovered || isRowPinned) ? 'true' : 'false'}
                          data-recent-row-freshness-glow={alpha > 0.7 ? 'true' : 'false'}
                          style={{
                            pointerEvents: 'none',
                            r: `${(isRowHovered || isRowPinned) ? 2.5 : 2.0}px`,
                            filter: alpha > 0.7
                              ? `drop-shadow(0 0 3px ${pal.legendAccent}80)`
                              : undefined,
                            transition: 'opacity 200ms ease-out, r 200ms ease-out, filter 200ms ease-out',
                          } as React.CSSProperties}
                        />
                      );
                    })()}
                    {/* Round 220 / Loop · milestone: recent-signal row
                        text completes the pin-signature typography
                        triple (R218 group labels / R219 legend rows /
                        R220 recent-signal rows). All three label-based
                        interactive surfaces now read "locked in" at
                        the type level when pinned — letter-spacing
                        spreads 0px → 0.5px on isRowPinned (NOT on
                        hover — hover keeps default tracking so the
                        eye can discriminate transient preview from
                        sticky pin without checking chrome). Pin
                        signature vocabulary now consistent across
                        the entire interactive-label landscape of
                        TopoGraph: every pin-able text element has
                        a typography-level tell.
                        transition extends 'letter-spacing 150ms'
                        alongside R55 fill 150ms — same beat as
                        R219 legend-row treatment. Hover still keeps
                        its own R55 fill brighten exclusively;
                        letter-spacing is pin-exclusive (note the
                        isRowPinned not isRowActive gate). */}
                    <text
                      x="13" y={38 + index * 16}
                      fill={isRowActive ? pal.legendHeadline : pal.legendText}
                      fontSize="9"
                      fontFamily="monospace"
                      /* Round 363 / Loop: recent-row text fontWeight 400
                         → 500 (font-medium tier). At fontSize=9 the
                         default-weight 400 glyphs read thin against the
                         panel chrome (pal.legendBox.fill with 0.92/0.97
                         opacity); the 100-weight bump lifts the alias→
                         alias text into the legibility band without
                         changing geometry. The R320 count tspan fw=600
                         (cold) / fw=700 (hot) override still wins
                         locally via inline fontWeight on the inner
                         tspan, so the count-vs-alias hierarchy stays
                         intact:
                           alias  fw 500  (R363, this round)
                           count  fw 600/700  (R320)
                         Sibling typography lift to R362 chip-row digit
                         500 → 600 — both nudge a within-element data
                         tier without disturbing the surrounding family
                         baseline. data-recent-row-text-font-weight attr
                         exposes the value for tests. */
                      fontWeight="500"
                      data-recent-row-text={link.key}
                      data-recent-row-text-pinned={isRowPinned ? 'true' : 'false'}
                      data-recent-row-text-hovered={!isRowPinned && isRowHovered ? 'true' : 'false'}
                      data-recent-row-text-font-weight="500"
                      /* Round 434 / Loop: recent-signal row text extends
                         from R220's pin-only letter-spacing (0 → 0.5 on
                         isRowPinned) to a 3-tier scale matching R433
                         legend-row at the sibling panel-row scope:
                           rest               → 0px
                           isRowHovered       → 0.25px   ← this round
                           isRowPinned        → 0.5px   (R220 preserved)
                         Pre-R434 R220 noted: "Hover stays at default
                         tracking — the spread is pin-exclusive so
                         users can read pinned vs hovered at the text
                         alone." R427-R433 established a 3-tier pattern
                         across 4 surfaces (node-alias, edge-badge,
                         group-label, legend-row) where hover gets a
                         subtler intermediate kerning step distinct
                         from the pin tier's stronger spread — the
                         locked vs preview discrimination R220 wanted
                         is preserved (0.5 > 0.25) AND hover gets a
                         typographic axis of its own. R434 completes
                         the 5-surface arc.
                         5-surface 3-tier letter-spacing pattern now
                         spans every interactive label on TopoGraph
                         that distinguishes hover from pin:
                           node-alias  (R427)   0 / 0.3  / 0.5
                           edge-badge  (R431)   0 / 0.2  / 0.4
                           group-label (R432)   0 / 0.25 / 0.5
                           legend-row  (R433)   0 / 0.25 / 0.5
                           recent-row  (R434)   0 / 0.25 / 0.5  ← this round
                         Hover-letter-spacing family extension
                         (10 anchors now): R344/R345/R347/R351/R420/
                         R427/R431/R432/R433/R434. R55 fill 150ms +
                         R220 letter-spacing 150ms transition kept
                         (additive conditional case, no new property). */
                      /* Round 474 / Loop — cadence-sync follow-on to
                         R472. R472 lifted the recent-row TINT RECT
                         to 200ms but the row TEXT alongside still
                         ran 150ms — same panel-row scope, two
                         different rates. When a user hovered/pinned
                         a row the rect background brightened in
                         200ms while the text fill + letter-spacing
                         finished in 150ms. R474 closes that internal
                         desync by lifting the text transitions to
                         match. Whole recent-row state-flip now
                         eases at 200ms ease-out across rect AND
                         text. data-recent-row-text-transition='200ms'
                         attr exposed for tests. R434 3-tier letter-
                         spacing values unchanged; R363 fw + R55 fill
                         brighten unchanged — only the timing axis
                         shifts. */
                      data-recent-row-text-transition="200ms"
                      style={{
                        transition: 'fill 200ms ease-out, letter-spacing 200ms ease-out',
                        letterSpacing: isRowPinned ? '0.5px' :
                                       isRowHovered ? '0.25px' : '0px',
                      }}
                    >
                      {/* R138 / Loop: typography unification with the rest
                         of the topology UI. Filter pills (R119) render
                         "{from}→{to}", node tooltips (R98) use →, the
                         active-links chip tooltip (R114) and edge-badge
                         titles all use unicode →. The recent-signal row
                         was the lone holdout still rendering "from -> to"
                         in ASCII. The data delimiter likewise: filter
                         pills use " · " ("status · 3"); the row was using
                         " / ". Both swaps make the row read like every
                         other surface — one less micro-style to remember. */}
                      {truncate(link.from, 6)} {'→'} {truncate(link.to, 6)} {' · '}
                      {/* Round 189 / Loop: count tspan unified — pre-R189
                          two different tspans (data-recent-row-count vs
                          data-recent-row-count-hot) mounted/unmounted
                          on the R127 hot threshold (count >= 10),
                          making fill (legendText ↔ amber) + fontWeight
                          (regular ↔ 700) snap one-frame. Now one tspan
                          always-mounted; isHot drives fill/fontWeight
                          conditionally. style.transition='fill 300ms
                          ease-out' makes the hot crossing ease through
                          the colour shift — same vocabulary R188 just
                          added to the edge midpoint badge stroke (the
                          panel-side mirror of that surface). fontWeight
                          stays binary (no clean weight interpolation
                          across browsers). data-recent-row-count
                          continues to expose the tspan to existing
                          tests; data-recent-row-count-hot becomes
                          an attribute on the same element when active
                          so legacy probes still resolve. */}
                      {/* Round 225 / Loop: tabular-nums on the per-row
                          count digit. The row text reads "alpha → beta ·
                          {count} · content"; when {count} grows from a
                          single digit to two (9 → 10) the subsequent
                          " · {content}" preview slides ~3-4px right in
                          monospace because '1' and '0' have different
                          natural widths against the surrounding control
                          glyphs even in mono fonts. Tabular-nums locks
                          the count column so the content preview
                          column stays planted as activity scales up.
                          Sibling treatment to R224 edge badge / R225
                          hub digit / R225 panel-header flow-count. */}
                      {/* Round 320 / Loop: cold-state per-row count gains
                          explicit fontWeight="600" instead of inheriting
                          the parent <text>'s default (400). Brings the
                          recent-signal row count into the 5-tier SVG
                          data-weight family established by R309 (legend
                          per-row count) / R310 (legend panel-header
                          count) / R311 (recent-signal panel-header flow
                          count). Pre-R320 the per-row count `· 12` for
                          a cold row painted at fw=400, identical weight
                          to the surrounding aliases — the count digit
                          should read as data and stand out from the
                          alias text. Hot crossing stays at fw=700 (R127),
                          so cold→hot delta becomes 600→700 (still
                          distinct, plus the fill flip from legendText
                          → amber carries the dramatic part of the cue).
                          Sibling treatment in the data-weight tier. */}
                      {/* Round 445 / Loop: extend the R320 cold/hot fw
                          binary (600/700) to ALSO fire on isRowPinned —
                          pinned-cold now lifts to 700 alongside the
                          existing hot-triggered lift. Sibling to R444
                          group-label-count-pin (500→600) at the
                          recent-row scope. Both panel-row counts now
                          respond to pin with a typographic weight lift,
                          part of the "data tightens under attention"
                          family (R416/R424/R425/R426/R444/R445).
                          Effective tiers:
                            cold + un-pinned     → fw 600
                            cold + pinned        → fw 700  ← this round
                            hot  (any pin state) → fw 700  (R320 preserved)
                            hot is still amber-filled (R127); cold pin
                            stays at the parent fill, so the two routes
                            to fw=700 are visually distinct (color vs
                            no color). transition list adds 'font-
                            weight 200ms ease-out' so the lift eases
                            under the same R320 fill cadence. data-
                            recent-row-count-pinned attr exposes the
                            pin gate for tests. */}
                      {/* Round 498 / Loop — hot-count subtle pulse. Pre-
                          R498 the hot row count signaled via color (R127
                          amber fill) + weight (R320 fw-700) + (R445 pin
                          lift) but stayed visually motionless. R498 adds
                          a 3s opacity breath (0.85↔1.0) on the digit when
                          isHot && !reducedMotion — gentle "alive" signal
                          on the lane carrying ≥ 10 messages, drawing
                          glance without becoming noisy. Sibling of R497
                          hub-idle-breath in the 呼吸感 theme arc; same
                          0.85↔1.0 amplitude. Class adds an animation-
                          only paint axis; no layout / bbox change. R29
                          blanket also catches `animation-duration` for
                          reducedMotion users, but the component-side
                          gate makes the intent explicit and avoids
                          a node tree thrash for those users (className
                          stays absent rather than present-but-paused). */}
                      <tspan
                        fill={isHot ? hotStroke : undefined}
                        fontWeight={(isHot || isRowPinned) ? '700' : '600'}
                        className={isHot && !reducedMotion ? 'anet-recent-hot-pulse' : undefined}
                        data-recent-row-count
                        data-recent-row-count-pinned={isRowPinned ? 'true' : 'false'}
                        data-recent-row-count-font-weight={(isHot || isRowPinned) ? '700' : '600'}
                        data-recent-row-count-hot-pulse={isHot && !reducedMotion ? 'true' : 'false'}
                        {...(isHot ? { 'data-recent-row-count-hot': 'true' } : {})}
                        style={{
                          transition: 'fill 300ms ease-out, font-weight 200ms ease-out',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {link.count}
                      </tspan>
                      {/* Round 418 / Loop: recent-row content preview
                          gains opacity=0.7 wrapper — subordinate-text
                          tier at the SVG-text scope. Pre-R418 the
                          truncated content preview (e.g. " · hi there")
                          inherited the row's full opacity, reading at
                          the same emphasis as the alias text and
                          count digit. R418 wraps it in a <tspan> at
                          opacity=0.7 so the preview reads as
                          subordinate metadata — sibling to R333-R341/
                          R362/R369/R389/R410/R412 chip-internal-
                          hierarchy "label tier" (opacity-70) at the
                          HTML scope, and R317 subordinate-text-lift
                          gray-500 → gray-400 family. The leading
                          " · " separator stays at full opacity so
                          the row punctuation rhythm holds. data-
                          recent-row-content-tspan attr surfaces the
                          subordinate wrapper for tests. */}
                      {' · '}
                      <tspan opacity="0.7" data-recent-row-content-tspan>{truncate(link.content, 8)}</tspan>
                    </text>
                    {/* Round 484 / Loop — recent-row timestamp opacity
                       lifts to 1.0 when isRowHovered || isRowPinned,
                       regardless of freshness alpha. R191 origin
                       decays tsAlpha along with the row's freshness;
                       pre-R484 hovering/pinning the row left the
                       timestamp dim — user inspecting stale data
                       fought the freshness encoding. R484 lifts to
                       1.0 on attention. Sibling to R472/R474 in the
                       recent-row state-flip family. data-recent-row-
                       ts-lifted attr exposes the gate; original
                       data-recent-row-ts-alpha preserved as R191
                       freshness reading. */}
                    {lastAt ? (
                      /* Round 321 / Loop: lastAt freshness timestamp picks
                         up fontVariantNumeric tabular-nums. The string
                         marches through 1s..59s (1 digit / 2 digits) /
                         1m..59m / 1h..24h every second the panel ticks,
                         and the textAnchor="end" right-aligns against
                         x=217. Pre-R321 a 9s→10s crossing slid the chip
                         left ~3px in monospace (digit '1' narrower than
                         '0' even in mono) — same one-frame visible jitter
                         R225 / R230 fixed elsewhere. Tabular-nums locks
                         the digit slot so the timestamp stays planted as
                         seconds tick. 7th surface in the info-density
                         tabular-nums sweep after R224 edge badge / R225
                         hub digit + panel header + recent row count /
                         R229 group-label count / R230 group-label
                         status pips / R320 recent-row count fw=600
                         (count and timestamp now both lock). */
                      <text
                        x="217" y={38 + index * 16}
                        textAnchor="end"
                        fill={pal.legendText}
                        fontSize="8"
                        fontFamily="monospace"
                        opacity={(isRowHovered || isRowPinned) ? 1 : tsAlpha}
                        data-recent-row-ts={link.key}
                        data-recent-row-ts-alpha={tsAlpha.toFixed(2)}
                        data-recent-row-ts-lifted={(isRowHovered || isRowPinned) ? 'true' : 'false'}
                        style={{
                          pointerEvents: 'none',
                          transition: 'opacity 200ms ease-out',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {lastAt}
                      </text>
                    ) : null}
                  </g>
                );
              })
            )}
            {/* Round 128 / Loop: overflow hint. The recent-signal panel
                renders the top 3 flowLinks via .slice(0, 3) — but a
                fleet with 5 or 10 active flows silently truncates the
                rest. The R96 "X flows" header tells the total but
                doesn't say "you're seeing top-3". This hint fires
                only when flowLinks.length > 3 so quiet fleets stay
                clean. Footer y=82 sits between row 3 (baseline 70)
                and the panel bottom; the R256 height bump 84→88
                adds 6 px of clear below the footer baseline so the
                on-hover textDecoration:underline (which renders
                ~3-4 px below baseline → y≈85-86) tucks INSIDE the
                panel border instead of clipping past it at the
                old 84-px floor. Overlap-test geometry unchanged
                (panel selector at translate(16,16); corner-to-
                center distance 342.6 → 340 still > 325 ring-clear
                threshold). fontStyle=italic + opacity 0.55 reads
                as muted metadata, not an actionable row — matches
                the R110 empty-state hint idiom. */}
            {(() => {
              // Round 221 / Loop: footer always-mounts; visibility
              // crossfades via wrapper <g> opacity instead of React
              // conditional mount/unmount on flowLinks.length > 3.
              // Pre-R221 a fleet's 4th flow appearing snap-popped the
              // footer in; tapering back to 3 flows snap-removed it.
              // Same threshold-crossing snap R215 closed for edge
              // midpoint badges, now applied to the recent-panel
              // footer surface. moreCount clamps at 0 so when invisible
              // (length ≤ 3) the data attribute and text don't show
              // garbage negative numbers. a11y trio (role / tabIndex /
              // aria-hidden) and pointerEvents follow visibility so
              // the hidden footer doesn't appear in tab order or
              // intercept clicks at its midpoint coordinates.
              const visible = flowLinks.length > 3;
              const moreCount = Math.max(0, flowLinks.length - 3);
              const label = `+ ${moreCount} more flow${moreCount === 1 ? '' : 's'}`;
              // R133: the truncation hint becomes a clickable nav to
              // /messages. R128 introduced the footer as pure metadata
              // ("you're seeing top-3"); R133 closes the gap by giving
              // users a way to ACT on that info — see the full list.
              // Wrap in <g> with onClick so SVG hit-testing fires the
              // route push. cursor:pointer + the underline-on-hover
              // visual cue tells users this is interactive. The hover
              // state is React-controlled (no CSS :hover on SVG <g>
              // descendant text would feel reliable across Chrome's
              // SVG quirks). pointerEvents follows visibility (R215
              // pattern) so the hidden footer can't intercept clicks
              // at its midpoint when it's invisible (sub-threshold
              // fleets).
              return (
                <g
                  data-recent-panel-more-nav
                  data-recent-panel-more-visible={visible ? 'true' : 'false'}
                  role={visible ? 'link' : undefined}
                  tabIndex={visible ? 0 : -1}
                  aria-hidden={visible ? undefined : true}
                  className="anet-topo-svg-focus"
                  style={{
                    cursor: visible ? 'pointer' : undefined,
                    pointerEvents: visible ? 'all' : 'none',
                    opacity: visible ? 1 : 0,
                    transition: 'opacity 300ms ease-out',
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => { if (visible) setHoveredRecentMore(true); }}
                  onMouseLeave={() => setHoveredRecentMore(false)}
                  onClick={() => { if (visible) router.push('/messages'); }}
                  onKeyDown={(e) => {
                    if (!visible) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      router.push('/messages');
                    }
                  }}
                >
                  <title>{`${label} — open /messages for the full list`}</title>
                  {/* Round 195 / Loop: footer hint adopts the cyan
                      vocabulary on hover, joining the interactive-on-
                      hover-is-cyan family (R178 fullscreen / R163
                      layout / R179 nodeSize / R193 active-links chip).
                      Pre-R195 the footer brightened on hover via
                      opacity + underline but kept its gray fill —
                      'becomes brighter gray' rather than 'becomes the
                      go-act color'. legendAccent is the same cyan-400
                      (dark) / teal-600 (light) every other interactive
                      hover speaks. transition list extends `fill 200ms
                      ease-out` so the colour swap eases instead of
                      snapping. data-recent-panel-more-hovered exposes
                      the gate for tests. */}
                  {/* Round 259 / Loop: footer link bumps fontSize 8 → 9
                      for clickable-text readability. Pre-R259 the
                      "+N more flows" footer (the panel's primary
                      navigation affordance into /messages) sat at the
                      same 8pt as the empty-state hint — small enough
                      to make the click target feel cheap. 9pt + italic
                      + opacity 0.55 keeps it visually secondary to row
                      content (9pt regular) while giving the link
                      enough type-weight to read as a real affordance.
                      Underline geometry verified: with fontSize 9 the
                      underline still renders ~3-4px below baseline at
                      y=82 → underline ~y=85-86, panel bottom y=88 →
                      2-3px clear (R256 footer-breath invariant
                      preserved). */}
                  {/* Round 325 / Loop: footer link joins the editorial
                      letter-spacing family at 0.2px — same axis as
                      R302 empty-state main hint (fontSize 10 opacity
                      0.65). The footer is italic monospace fontSize 9
                      opacity 0.55 acting as the panel's primary
                      navigation affordance into /messages; pre-R325
                      it sat orphaned from the R285/R289/R301/R302/R304
                      editorial-spacing axis even though it carried
                      the same designed-label semantics (action label,
                      not row data). 0.2px is the same value as R302
                      because at fontSize 9 vs 10 the visual density
                      of "+ N more flows" is close to "no flow yet"
                      and they're both italic — sibling-equal in the
                      hierarchy. The R195 cyan-hover + R259 fontSize
                      bump stay; this round only adds the spacing.
                      6-axis editorial-letterspacing hierarchy now:
                        R285 kicker:        1.2px (eyebrow loud)
                        R289 watermark:     0.5px (wordmark brand)
                        R301 panel titles:  0.3px (section headers)
                        R302 empty main:    0.2px (empty-state hint)
                        R325 footer link:   0.2px (panel nav action) ← NEW
                        R304 empty sub:     0.15px (instructional sub) */}
                  {/* Round 340 / Loop: +N more flows footer link extends
                      the R333/R335/R336/R337/R338 chip-internal-hierarchy
                      arc to a 6th surface. The digit `{moreCount}` reads
                      as the primary data ("how many more flows"); the
                      unit text ` more flow(s)` recedes via a nested
                      tspan with opacity-0.7 (multiplicative against the
                      parent <text>'s hover/rest opacity, so unit always
                      sits below the digit). The `label` variable is
                      preserved for the <title> tooltip — only the SVG
                      render splits. data-recent-panel-more-unit exposes
                      the unit tspan for tests. */}
                  {/* Round 344 / Loop: footer hover gains letter-spacing
                      tween 0.2 → 0.3. R325 set rest letter-spacing
                      0.2 to join the editorial-spacing family; R344
                      adds a 0.1px hover spread that layers on top of
                      R195 cyan fill + R325 spacing + R133 underline
                      so the footer reads "lit up and spaced" on
                      hover — sibling to R218/R219/R220 pin-signature
                      letter-spacing family applied to a hover-only
                      surface. transition list extends letter-spacing
                      200ms ease-out alongside the existing opacity/
                      fill easings. */}
                  {/* Round 368 / Loop: `+N more flows` footer text gains
                      fontWeight=500 (font-medium tier). Sibling small-
                      text fw lift family with R363 recent-row alias
                      + R364 legend-row label + R366 group-label count
                      — all four lifts share the same theory: at small
                      fontSize (9-11 px) against panel chrome, SVG-
                      default fw 400 sits at the legibility floor;
                      fw 500 brings the glyph into the deliberate-data
                      band. fontStyle=italic + opacity 0.55 rest + R325
                      letterSpacing 0.2 baseline + R344 hover-spread
                      0.2 → 0.3 + R195 cyan fill on hover all preserved
                      — the fw bump just thickens the italic stroke.
                      Hover-state punch (R195 fill + R325 opacity 0.55
                      → 0.85 + R344 letter-spacing + R133 underline)
                      stays as is, so the rest-vs-hover delta still
                      reads clearly. data-recent-panel-more-font-weight
                      attr exposes the value for tests. */}
                  <text
                    x="115" y="82"
                    textAnchor="middle"
                    fill={hoveredRecentMore ? pal.legendAccent : pal.legendText}
                    fontSize="9"
                    fontFamily="monospace"
                    fontStyle="italic"
                    fontWeight="500"
                    letterSpacing={hoveredRecentMore ? '0.3' : '0.2'}
                    opacity={hoveredRecentMore ? 0.85 : 0.55}
                    textDecoration={hoveredRecentMore ? 'underline' : 'none'}
                    data-recent-panel-more={moreCount}
                    data-recent-panel-more-hovered={hoveredRecentMore ? 'true' : 'false'}
                    data-recent-panel-more-font-weight="500"
                    style={{ transition: 'opacity 150ms ease-out, fill 200ms ease-out, letter-spacing 200ms ease-out' }}
                  >
                    {`+ ${moreCount}`}
                    <tspan opacity="0.7" data-recent-panel-more-unit>{` more flow${moreCount === 1 ? '' : 's'}`}</tspan>
                  </text>
                </g>
              );
            })()}
          </g>
          )}

          {/* legend — Round 55 / Loop: each status row is now a hover
              target. Pointer enter sets `hoveredStatus`; pointer leave
              clears it. Node opacity formula composes the match below.
              The row text brightens to legendHeadline while hovered as
              a small affordance hint. Geometry unchanged — the new
              <g> wrappers only carry pointer handlers. */}
          <g
            transform="translate(760, 16)"
            data-topo-panel="legend"
            data-topo-panel-hovered={hoveredPanel === 'legend' ? 'true' : 'false'}
            // R175 / Loop: legend panel offset 100ms behind the
            // recent-signal panel so the two corner panels cascade
            // left-then-right rather than appearing in lockstep.
            // Same .anet-fade-in mechanism the four wave layers use.
            className="anet-fade-in"
            data-topo-panel-fade-delay={800}
            style={{ animationDelay: '800ms' }}
            onMouseEnter={() => setHoveredPanel('legend')}
            onMouseLeave={() => setHoveredPanel(prev => prev === 'legend' ? null : prev)}
          >
            {/* R57: matching drop-shadow elevation to the legend panel.
                R106: panel height grew 96 → 104 to seat the new header
                line + 4 px row-shift below it (so the new header text
                doesn't overlap the row-1 hitbox region).
                R135: hover-elevation mirrors the recent-signal panel
                rect at line ~3299. Both panels grow their shadow on
                hover to telegraph "the chrome is interactive" since
                their rows pin / nav. */}
            {/* Round 247 / Loop: sibling treatment to the recent-signal
                panel — fill + stroke + opacity transitions added so
                the legend panel also eases through theme toggles
                (no snap on cyber↔light switch). Same 200ms cadence
                across the panel pair. */}
            {/* Round 331 / Loop: legend panel rect rx 8 → 10 — sibling
                treatment to the recent-signal panel above. Same
                proportional-rhythm step under R330's rounded-xl
                canvas wrapper envelope. */}
            <rect
              x="0" y="0" width="224" height="88" rx="10"
              fill={pal.legendBox.fill}
              // R423 sibling — legend panel rect stroke tints to
              // legendAccent on hover (mirrors recent-signal panel
              // above). 4-layer hover cue stack now symmetric across
              // both side panels.
              stroke={hoveredPanel === 'legend' ? pal.legendAccent : pal.legendBox.stroke}
              // R348 sibling — legend panel rect opacity hover-state
              // bump 0.92 → 0.97 (cyber) / 0.97 → 1 (light) on
              // hoveredPanel === 'legend'. Pairs with the recent-signal
              // panel rect above so the two corner panels' hover cues
              // stay symmetric. Geometry-safe (paint-only).
              opacity={hoveredPanel === 'legend' ? (isLight ? 1 : 0.97) : (isLight ? 0.97 : 0.92)}
              style={{
                filter: hoveredPanel === 'legend'
                  ? (isLight ? 'drop-shadow(0 4px 12px rgba(15,23,42,0.14))'
                             : 'drop-shadow(0 4px 12px rgba(0,0,0,0.65))')
                  : (isLight ? 'drop-shadow(0 2px 6px rgba(15,23,42,0.08))'
                             : 'drop-shadow(0 2px 6px rgba(0,0,0,0.45))'),
                transition: 'filter 200ms ease-out, fill 200ms ease-out, stroke 200ms ease-out, opacity 200ms ease-out',
              }}
              data-topo-panel-elevation="legend"
            />
            {/* R106 / Loop: panel header — symmetric with the recent-
                signal panel's "recent signal · N flows" (R96). Same
                font + position vocabulary so the two side panels feel
                paired. Title text at x=13 y=21; total fleet count
                right-aligned at x=215 y=21 in the accent colour. */}
            {/* Round 266 / Loop: legend panel title fill picks up theme-
                toggle transition — sibling treatment to the recent-
                signal panel title at line ~5459. Pre-R266 both panel
                titles hard-flipped color on theme toggle while their
                surrounding chrome eased; R266 closes both at once. */}
            {/* R301: sibling to recent-signal panel title above —
                same letterSpacing 0.3 for editorial parity. */}
            {/* Round 483 / Loop — sibling to R482 (recent-signal panel
               title): legend panel title fontWeight 700 → 800 on
               pinnedStatus (any legend row pinned propagates to the
               panel title). Pre-R483 the title responded only to
               panel-chrome hover via R345 ls; the pinnedStatus row
               highlighted its own swatch + tint via R181/R477 but
               the title stayed flat — no upstream tightening to
               signal "panel context = inspecting".
               R483 closes the symmetry with R482: both panel titles
               (recent-signal + legend) now tighten typographically
               when ANY row inside them is in the active filter
               state. Same idiom, mirrored at the legend-row scope.
               data tightens family — now 10 anchors:
                 R416/R424/R425/R426 chip/panel/hub/edge digits
                 R444/R445/R446      group/recent/legend counts
                 R457                group-label parent
                 R482                recent-panel title
                 R483                legend-panel title  (this round)
               transition list extends to include 'font-weight 200ms
               ease-out' alongside R345's ls + R55's fill 200ms.
               data-legend-panel-title-fw + -active exposed for tests. */}
            {/* R345 sibling — legend panel title same hover letter-
                spacing tween 0.3 → 0.4 on panel hover. */}
            <text x="13" y="21" fill={pal.legendHeadline} fontSize="12" fontFamily="monospace" fontWeight={pinnedStatus ? '800' : '700'} letterSpacing={hoveredPanel === 'legend' ? '0.4' : '0.3'} style={{ transition: 'fill 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out' }} data-legend-panel-title data-legend-panel-title-fw={pinnedStatus ? '800' : '700'} data-legend-panel-title-active={pinnedStatus ? 'true' : 'false'}>legend</text>
            {/* Round 257 / Loop: legend panel header count picks up the
                symmetric 13L/13R inner-padding pattern from the recent-
                signal panel. Pre-R257 the legend header was 13px from
                the left edge (`x=13` title) but only 9px from the right
                edge (`x=215` end-anchored count → 224-215=9), while the
                recent-signal panel header used 13px on BOTH sides (x=13
                title + x=217 end-count → 230-217=13). The two panels
                sit as a side-by-side corner pair — mismatched header
                inner-padding read as a typographic nit on the panel
                chrome. x=211 (= 224-13) restores symmetric 13L/13R so
                the panel pair shares one inset rhythm. The per-row
                count text at x=215 (line ~6321) STAYS at 9px-from-right
                — that one is paired with the flow-arrow swatch geometry
                ('M140,80 Q164,56 196,80') and would visibly tighten
                against the arrow tip if moved further left. Header
                count has no such pairing; it stands alone. */}
            {/* Round 266 / Loop: legend count fill (pal.legendAccent
                — cyber #67e8f9 cyan ↔ light #10b981 emerald) picks up
                theme-toggle transition. Pre-R266 the count snapped
                color on theme flip; R266 eases it alongside the panel
                title (sibling text in the same header band). */}
            {/* Round 292 / Loop: legend panel header count adopts explicit
                fontVariantNumeric: 'tabular-nums' for parity with the
                recent-signal panel header count at line ~5814 (R232).
                The text is already fontFamily='monospace' so digit width
                is technically tabular by definition — the explicit
                directive documents intent at code level, survives a
                future font-family change without silently losing
                tabular alignment, and eliminates an asymmetry between
                two sibling panel-header counts. Sibling treatment to
                R225 (hub digit) / R224 (edge badge) / R232 (chip-row
                counts) — tabular-nums sweep continues wherever digits
                live next to non-digit characters. */}
            {/* Round 310 / Loop: legend panel-header count picks up
                fontWeight=600 for parity with R309 per-row count
                weight. Pre-R310 the header count 'N nodes' rendered
                at default 400 while the per-row counts (working
                'N' / idle 'N' / offline 'N') went semibold in R309.
                Same hierarchy reason as R309: the count is the DATA
                operators scan; the label ('legend' panel title +
                row labels 'working/idle/offline') is stable
                structural anchor. R309 established the rule at the
                row scope; R310 propagates it up to the panel-
                summary scope so the count typography is consistent
                across both the rollup and per-row counts inside
                the same legend panel. Existing pal.legendAccent
                fill + tabular-nums + R266 fill transition all
                preserved. */}
            {/* Round 336 / Loop: split legend panel count digit from
                unit " nodes" with nested opacity-0.7 tspan — sibling
                treatment to the recent-signal panel count and hot-
                count splits above. Three-panel-header surface family
                now sharing the same chip-internal-hierarchy pattern:
                  recent flows count + " flows" unit at 0.7
                  recent hot count   + " hot" unit at 0.7
                  legend nodes count + " nodes" unit at 0.7
                data-legend-panel-count-unit on the inner tspan for
                R336 introspection; the parent .textContent still
                reads "{N} node(s)" so existing R310 count tests via
                textContent unchanged. */}
            {/* R424 sibling — legend panel count digit fontWeight 600
                → 700 on panel hover. Closes 5-layer panel hover cue
                stack symmetric across both side panels (recent-signal
                + legend): depth (R135) + solidity (R348) + spacing
                (R345) + edge color (R423) + weight (R424). R310 base
                fw=600 + R292 tabular-nums + R266 fill transition + R336
                unit-tspan opacity-0.7 all preserved. Same "data tightens
                under attention" idiom R416 established at chip scope. */}
            <text
              x="211" y="21" textAnchor="end"
              fill={pal.legendAccent} fontSize="10" fontFamily="monospace" fontWeight={hoveredPanel === 'legend' ? '700' : '600'}
              // R349 sibling — legend panel header count picks up
              // letterSpacing="0.2", one tier below the R301 panel
              // title 0.3. Pairs with the recent-signal panel count
              // letter-spacing above so the two corner panels' header
              // typography stays editorially symmetric.
              letterSpacing="0.2"
              data-legend-panel-count
              data-legend-panel-count-letter-spacing="0.2"
              style={{
                transition: 'fill 200ms ease-out, font-weight 200ms ease-out',
                fontVariantNumeric: 'tabular-nums',
              }}
            >{sessions.length}<tspan opacity="0.7" data-legend-panel-count-unit> node{sessions.length === 1 ? '' : 's'}</tspan></text>
            {(() => {
              const idleCount = onlineNodes.length - workingCount;
              // R106: rows shift +8 px (was y0=24, 48, 72 → 32, 56, 80)
              // to clear the new header row. R57 panel rect grew 96 →
              // 104 to seat them.
              const rows = [
                /* Round 277 / Loop: legend panel compress 104 → 88 (matches
                   recent-signal panel height post-R256) per Vincent
                   5214/5215-5217 simplification ask. Row stride drops
                   24 → 18: row 1 working anchored at y0=32 (unchanged so
                   R271 hitbox-swatch-center test at y=21 still passes);
                   row 2 idle y0=56→50 (-6); row 3 offline y0=80→68 (-12).
                   Flow-arrow swatch path (line ~6607) tracks new offline
                   cy from y=80 to y=68. Net: legend panel takes ~15%
                   less vertical chrome, panel pair (recent-signal+
                   legend) now share same height = symmetric corner
                   pair. Tests still pass: R257/R266/R269/R274 probe
                   x attrs, fill transitions, text content — none
                   sensitive to y0 stride. R271 probes working row
                   hitbox y=21 (row.y0-11 with row.y0=32), unchanged.
                   Corner-to-center distance increases (panel ends
                   higher, further from center) — geometric ring-clear
                   improves slightly. */
                /* Round 308 / Loop: continue the R307 legend label 减法.
                   'working node' (12 chars) → 'working' (7 chars):
                   the 'node' qualifier is redundant — the row is in
                   the LEGEND for a node graph, every row inherently
                   describes a node state. 'online idle' (11 chars) →
                   'idle' (4 chars): the 'online' qualifier was
                   disambiguation against the offline row, but the
                   dashed-vs-solid status ring already discriminates
                   online idle from offline visually. After R307+R308
                   the three legend labels are all just status words:
                   working / idle / offline — a clean 3-state list at
                   roughly comparable lengths (7 / 4 / 7) for the
                   tightest legend column to date. Pure 减法; visual
                   information already encoded by row position +
                   status-color swatch + status-ring dashing. */
                { key: 'working' as const, y0: 32, y1: 36, fill: isLight ? '#059669' : '#22c55e', label: 'working', count: workingCount },
                { key: 'idle'    as const, y0: 50, y1: 54, fill: isLight ? '#0d9488' : '#2dd4bf', label: 'idle',    count: idleCount },
                /* Round 269 / Loop: " / " → " · " delimiter unification.
                   R138 swept the recent-signal row separators from
                   ASCII " / " to typographic " · " (matching filter
                   pills, node tooltips, edge badges, active-links
                   tooltip). The legend's offline-row label was the
                   LAST hardcoded " / " holdover in TopoGraph. Same
                   monospace cell width (no layout shift), completes
                   the R138 delimiter sweep.
                   Round 307 / Loop: drop the ' · no SSE' qualifier.
                   'offline · no SSE' (16 chars) → 'offline' (7 chars).
                   The visual already communicates the same idea
                   redundantly: status ring strokeDasharray='5 5' for
                   offline nodes (line ~5193) + gray fill + offline
                   row's own gray swatch. Text qualifier was
                   technical disambiguation that the visual encodes
                   directly. Same R275-R281/R290/R291/R294 减法
                   register — remove redundant text the eye doesn't
                   need. Sibling row labels 'working node' (12 chars)
                   + 'online idle' (11 chars) read at roughly the
                   same length now too — legend rows look more
                   balanced across the 3 lines. */
                { key: 'offline' as const, y0: 68, y1: 72, fill: isLight ? '#94a3b8' : '#6b7280', label: 'offline', count: offlineNodes.length },
              ];
              return rows;
            })().map(row => {
              // Round 61 / Loop: legend rows pin too — symmetric with the
              // R60 pressure-bar segments. R55 hover stays transient; the
              // new onClick toggles pinnedStatus so users can lock a
              // filter without holding the cursor still. Pinned row gets
              // an inset ring on the swatch (same vocab as R60).
              const isPinned = pinnedStatus === row.key;
              const isRowHovered = hoveredStatus === row.key;
              const isLifted = isRowHovered || isPinned;
              return (
                <g
                  key={row.key}
                  data-legend-status={row.key}
                  data-legend-row-lifted={isLifted ? 'true' : 'false'}
                  className="anet-topo-svg-focus"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isPinned}
                  // R144: mirror of R143 — extend the row-lift idiom to the
                  // legend panel rows for symmetry with the recent-signal
                  // panel rows. Same translate-1px transform, same 150ms
                  // cubic-bezier timing. R55 hovers the row (transient),
                  // R61 pins it (sticky); both states earn the lift.
                  // Composes with R105 row-bg-tint and R135 panel hover-
                  // shadow → three layers of feedback at three nested
                  // scopes (panel chrome → row text lift → bg tint).
                  style={{
                    cursor: 'pointer',
                    transform: isLifted ? 'translateY(-1px)' : undefined,
                    transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  // R61: stopPropagation on pointerdown so the SVG-level
                  // pan handler (R103) doesn't setPointerCapture and
                  // redirect the follow-up click away from this <g>.
                  // Same trick the node <g> uses (and R52 hub).
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => setHoveredStatus(row.key)}
                  onMouseLeave={() => setHoveredStatus(prev => prev === row.key ? null : prev)}
                  onClick={() => setPinnedStatus(prev => prev === row.key ? null : row.key)}
                >
                  {/* R149 / Loop: legend row gains a <title> tooltip
                      symmetric with R148's recent-signal row tooltip.
                      Same R97 idiom — anywhere the UI shows "N" should
                      hover-explain WHICH N — applied to the legend
                      panel which had been showing only the bucket
                      count without alias context. Header line names
                      the status bucket; body lists the matched aliases
                      with 8-truncate + "+N more"; footer hint flips
                      with pin state. Hot-lane convention doesn't apply
                      here (status buckets aren't traffic counts), so
                      no isHot suffix. */}
                  <title>{(() => {
                    const aliases = row.key === 'working'
                      ? onlineNodes.filter(s => s.status === 'working').map(s => s.alias)
                      : row.key === 'idle'
                      ? onlineNodes.filter(s => s.status !== 'working').map(s => s.alias)
                      : offlineNodes.map(s => s.alias);
                    const preview = aliases.slice(0, 8).join(', ');
                    const suffix = aliases.length > 8 ? ` + ${aliases.length - 8} more` : '';
                    return [
                      `${row.label} · ${row.count}`,
                      aliases.length > 0 ? `${preview}${suffix}` : null,
                      isPinned ? 'click to release pin (Esc to clear)' : 'click to pin · hover to preview',
                    ].filter(Boolean).join('\n');
                  })()}</title>
                  {/* R55 hitbox covers the row so cursor doesn't need to
                      be exactly on the 5-px swatch. R105 / Loop: the
                      hitbox now also carries a subtle hover/pin tint —
                      mirroring R104's recent-signal row treatment so
                      both side panels share the list-item idiom. The
                      tint borrows the ROW'S OWN swatch colour rather
                      than legendAccent, so the user's eye associates
                      the tinted row with its colour swatch instead of
                      a generic accent. Pin is a stronger tint than
                      hover; idle stays fully transparent. */}
                  {/* Round 271 / Loop: hitbox y shifts row.y0-12 → row.y0-11
                      so hitbox center aligns exactly with swatch cy=row.y0.
                      Pre-R271 hitbox spanned y=row.y0-12 to y=row.y0+10
                      (center at row.y0-1), with swatch cy at row.y0 — 1px
                      asymmetric. Hover/pin tint band drifted 1px above
                      the swatch. Post-R271: hitbox spans y=row.y0-11 to
                      y=row.y0+11 (center exactly at row.y0), swatch sits
                      11px from both edges (symmetric). Label text
                      vertical center also benefits — label baseline
                      y=row.y1=row.y0+4, visual midpoint ~row.y0+1.25,
                      now ~1.25px below hitbox center (vs ~2.25px pre).
                      No height change, no test ripple (other than this
                      one), no R260/R268/R270 chrome regressions. */}
                  {/* Round 473 / Loop — final cadence-sync follow-on,
                     closing the legacy 150ms transition at the
                     LEGEND-ROW tint scope. R459 (group-label hitbox)
                     + R472 (recent-row hitbox) already lifted the
                     two sibling panel-row hitboxes to 200ms; the
                     legend-row was the last per-row tint still
                     snapping at 150ms.
                     After R473 the 200ms ease-out vocabulary is
                     uniform across ALL three panel-row scopes —
                     group-label, recent-signal, and legend — so
                     hover/pin state-change cascades read coherently
                     at every panel-tier surface. data-legend-row-
                     tint-transition='200ms' attr exposed for tests.
                     Geometry/paint unchanged. */}
                  <rect
                    x="6" y={row.y0 - 11}
                    width="170" height="22" rx="3"
                    fill={hoveredStatus === row.key || isPinned ? row.fill : 'transparent'}
                    opacity={isPinned ? (isLight ? 0.14 : 0.18)
                            : hoveredStatus === row.key ? (isLight ? 0.08 : 0.12)
                            : 1}
                    data-legend-row-tinted={isPinned ? 'pinned' : hoveredStatus === row.key ? 'hover' : 'none'}
                    data-legend-row-tint-transition="200ms"
                    style={{ transition: 'fill 200ms ease-out, opacity 200ms ease-out' }}
                  />
                  {/* Round 197 / Loop: swatch dot scales r 5.5 → 7 when its
                      row is hovered or pinned. Pre-R197 the swatch was a
                      flat constant size — the row got R55/R61 fill brighten,
                      R105 bg tint, R144 1px row lift, R181 pin ring, but
                      the swatch dot at the row's *visual identity anchor*
                      stayed still. Adding the size response gives the
                      swatch its own click/hover feel and visually rhymes
                      with R177 hub hover-lift (hub ring r 14→17). Stays
                      well inside the r=8 R181 pin ring (7 + 0 stroke vs
                      8 - 0.75 inner ≈ 7.25) so the two layers don't fight.
                      CSS r-as-property is interpolatable by Chrome/Safari/
                      FF post-2020. Geometry-unchanged at rest, so the
                      overlap test sees the same baseline. */}
                  {/* Round 295 / Loop: legend swatch base radius 5.5 → 6.
                      Pre-R295 the swatch idle radius was 5.5 and R197
                      grew it to 7 on hover/pin — a 1.5px jump (~27%
                      area). Bumping idle to 6 keeps hover at 7, so
                      the hover delta becomes a smoother 1px (~36%
                      area but 17% radius). Side effect: idle swatch
                      reads slightly more like an authored color
                      anchor than a faint dot — matches the post-R294
                      减法 register where the legend is one of the
                      few remaining persistent canvas-side info
                      surfaces. Geometry stays well inside the r=8
                      R181 pin ring (6 + 0 stroke vs 8 - 0.75 inner
                      ≈ 7.25). data-legend-swatch is unchanged so
                      R197 / R55 / R61 tests probe the same handle. */}
                  <circle
                    cx="16" cy={row.y0}
                    r="6"
                    fill={row.fill}
                    data-legend-swatch={row.key}
                    data-legend-swatch-state={isPinned ? 'pinned' : isRowHovered ? 'hover' : 'idle'}
                    style={{
                      r: isRowHovered || isPinned ? '7px' : '6px',
                      transition: 'r 150ms ease-out',
                    } as React.CSSProperties}
                  />
                  {/* R61 pinned-state ring — concentric stroke at r=8 in
                      the row colour, draws OUTSIDE the swatch so it
                      doesn't fight the fill colour the user is matching.
                      Round 181 / Loop: the ring used to mount/unmount
                      with the conditional render, snapping on every
                      pin/unpin. Now always mounted with opacity gated
                      by isPinned + a 150ms transition so the ring
                      eases in on pin and out on unpin — same gesture
                      vocabulary the R165/R180 smooth-pin-mirror family
                      uses for the chip-row pin chips. strokeWidth=1.5
                      is the R51 overlap-test sentinel but the test
                      selector is gated to g[data-node] ancestors,
                      so this legend-internal circle is invisible to
                      that probe. pointerEvents:none so the ring can't
                      intercept the row click that produced it. */}
                  {/* Round 402 / Loop: legend pin-ring strokeWidth 1.5
                      → 1.75. Sibling visual-weight bump (12th anchor)
                      to R385 hub hover-ring strokeWidth 1.5 → 1.75 —
                      both are pin/hover state indicators painted as
                      stroke-only circles outside their target swatch
                      with the R51 sentinel value 1.5. R402 lifts to
                      1.75 (matching R385's choice) so the pin signal
                      reads slightly heavier without crossing the
                      R51 sentinel band (3 reserved for offline node).
                      The R51 selector is gated to g[data-node]
                      ancestors so this legend-internal circle (lives
                      under a <g data-legend-status>) is invisible
                      to the probe — same lesson R177/R385 documented.
                      Visual-weight bump family (12 anchors now):
                        R287 minimap viewport stroke   1   → 1.5
                        R295 legend swatch radius      5.5 → 6
                        R359 recent-row pip radius     1.6 → 1.8
                        R360 hub digit fontSize        11  → 12
                        R361 edge-badge digit fontSize 10  → 11
                        R365 hub-highlight radius      5   → 5.5
                        R367 edge-badge rest stroke    1   → 1.25
                        R374 pressure-bar height       1.5 → 2
                        R383 recent-row pip radius     1.8 → 2.0
                        R384 minimap online dot        1.7 → 1.9
                        R385 hub hover-ring stroke     1.5 → 1.75
                        R402 legend pin-ring stroke    1.5 → 1.75  (this round)
                      R181 always-mount opacity gate + 150ms transition
                      + pointerEvents:none all preserved. data-legend-
                      pin-ring-stroke-width attr exposes the value for
                      tests. */}
                  {/* Round 477 / Loop — legend pin-ring gains a filter:
                     drop-shadow glow on isPinned. Extends R476's
                     drop-shadow idiom from hub-digit (focal scope)
                     to the legend-row pin-ring (sibling pin-state
                     surface). When a status row is pinned, the
                     concentric ring around the swatch now lights
                     up with a colour-matched halo using row.fill,
                     reinforcing "this filter is locked" via a
                     glow layer above the R402 sw bump + R181
                     opacity fade-in.
                     Hue: row.fill at 0.55 alpha — picks up each
                     status tier's signature colour (working green /
                     idle teal / offline slate). 3px blur stays
                     subtle but unmistakable when the row is locked.
                     Reduced-motion users skip the filter via R29
                     a11y blanket (transition-duration → 0.001ms
                     so the glow appears/disappears instantly with
                     pin toggle).
                     Filter is paint-only — bbox unchanged, R51
                     overlap-test gated to g[data-node] descendants
                     so this legend-internal ring is invisible to
                     the probe anyway. Transition list extends to
                     include 'filter 200ms ease-out' so the glow
                     eases under the same cadence as opacity. */}
                  <circle
                    cx="16" cy={row.y0} r="8"
                    fill="none"
                    stroke={row.fill}
                    strokeWidth="1.75"
                    opacity={isPinned ? 1 : 0}
                    data-legend-pin-ring={row.key}
                    data-legend-pin-ring-pinned={isPinned ? 'true' : 'false'}
                    data-legend-pin-ring-stroke-width="1.75"
                    data-legend-pin-ring-glow={isPinned ? 'true' : 'false'}
                    style={{
                      pointerEvents: 'none',
                      filter: isPinned
                        ? `drop-shadow(0 0 3px ${row.fill}88)`
                        : undefined,
                      transition: 'opacity 150ms ease-out, filter 200ms ease-out',
                    }}
                  />
                  {/* Round 219 / Loop: legend row text gains the same
                      letter-spacing pin signature R218 added to group
                      labels — 0px → 0.5px when isPinned. Pre-R219 the
                      legend row's hover and pin states shared fill
                      colour (R55/R61 both brighten to legendHeadline)
                      so the text was typographically identical at the
                      letter-form level for transient hover vs sticky
                      pin. R181 pin ring + R197 swatch grow + R143 row
                      lift differentiated the row chrome; R219 adds the
                      text-level signature so the LABEL itself reads
                      "locked in" at type. Mirror of R218's group label
                      treatment — chrome-level + type-level pin
                      vocabulary now unified across both interactive
                      label surfaces (group + legend). transition adds
                      `letter-spacing 150ms` alongside R55 fill 150ms;
                      same ease pace, same beat. */}
                  <text
                    x="30" y={row.y1}
                    fill={hoveredStatus === row.key || isPinned ? pal.legendHeadline : pal.legendText}
                    fontSize="11"
                    fontFamily="monospace"
                    /* Round 364 / Loop: legend-row label fontWeight 400
                       → 500. Sibling typography lift to R363 recent-row
                       text fw 400 → 500. Both surfaces render small
                       monospace text against panel chrome at fontSize
                       9-11 where SVG-default fw 400 sits at the
                       legibility floor. font-medium tier (500) gives
                       the label a more deliberate-data register.
                       The R309 per-row count text (separate element
                       below at x=215 textAnchor=end) keeps its own
                       fontWeight 600 inline override, so the count >
                       label hierarchy stays intact at the legend
                       scope same as R363 holds it at the recent-row
                       scope:
                         legend  label  fw 500  (R364, this round)
                         legend  count  fw 600  (R309)
                         recent  alias  fw 500  (R363)
                         recent  count  fw 600/700  (R320)
                       data-legend-row-label-font-weight attr exposes
                       the value for tests. R219 letter-spacing pin
                       tween + R55 fill transition + R181 always-mount
                       pin ring all preserved. */
                    fontWeight="500"
                    data-legend-row-label={row.key}
                    data-legend-row-label-pinned={isPinned ? 'true' : 'false'}
                    data-legend-row-label-hovered={!isPinned && hoveredStatus === row.key ? 'true' : 'false'}
                    data-legend-row-label-font-weight="500"
                    /* Round 433 / Loop: legend-row text extends from
                       R219's pin-only letter-spacing (0px → 0.5px on
                       isPinned) to a 3-tier scale matching the R432
                       group-label pattern:
                         rest             → 0px
                         hoveredStatus    → 0.25px   ← this round
                         isPinned         → 0.5px   (R219 preserved)
                       Pre-R433 hover already brightened the fill
                       (hoveredStatus===row.key || isPinned matches the
                       legendHeadline branch) but the letter-form
                       stayed dead-typographic on transient hover —
                       only the pin tier carried a kerning signature.
                       R433 adds the missing mid tier so hover
                       telegraphs through BOTH fill brighten AND a
                       subtle 0.25-px kerning spread, mirroring
                       R427/R431/R432 at legend-row scope. Pin tier
                       still wins so the locked vs preview distinction
                       at the type level stays intact.
                       Hover-letter-spacing family extension (9 anchors
                       now): R344/R345/R347/R351/R420/R427/R431/R432/
                       R433. 3-tier letter-spacing pattern now spans 4
                       surfaces (node-alias R427, edge-badge R431,
                       group-label R432, legend-row R433). R55 fill
                       150ms + R219 letter-spacing 150ms transition
                       untouched — additive conditional case. */
                    /* Round 475 / Loop — final closure of the panel-row
                       text scope cadence-sync. R473 lifted the legend-
                       row TINT RECT to 200ms; R474 lifted the recent-
                       row TEXT to 200ms; R475 closes the matching
                       legend-row text desync — fill + letter-spacing
                       both 150 → 200ms ease-out. After R475 the 3-tier
                       panel-row cadence family is fully 200ms across
                       BOTH rect and text at every panel-row scope
                       (group-label / recent-row / legend-row). Hover/
                       pin state-flip at any panel-row tier reads as
                       one motion-coherent unit. data-legend-row-
                       label-transition='200ms' attr exposed for tests.
                       R433 3-tier letter-spacing values (0/0.25/0.5)
                       unchanged; R55 fill brighten unchanged — only
                       the timing axis shifts. */
                    data-legend-row-label-transition="200ms"
                    style={{
                      transition: 'fill 200ms ease-out, letter-spacing 200ms ease-out',
                      letterSpacing: isPinned ? '0.5px' :
                                     hoveredStatus === row.key ? '0.25px' : '0px',
                    }}
                  >{row.label}</text>
                  {/* R95: live count anchored to the right edge of the
                      panel (x=215, after the flow-arrow swatch). Same
                      counts the chip-row shows ("3 working" etc.) but
                      here next to the swatch the user is matching —
                      saves crossing the canvas to the chip row for
                      the number. text-anchor=end aligns the column
                      visually like a table. pointerEvents:none so the
                      count doesn't intercept the row hover hitbox.

                      Round 204 / Loop: count text recedes when the
                      tier is empty. Pre-R204 the "0" sat at the same
                      opacity 0.65 as "12" — visually identical, so
                      the eye got zero signal that a status tier was
                      empty unless the operator read the digit. R204
                      drops empty rows to 0.30 (dark) / 0.28 (light)
                      so empty tiers fade into the panel chrome while
                      populated tiers stay visually prominent. R204 a
                      crossing zero / coming back from zero eases via
                      the existing 150ms opacity transition. data-
                      legend-count-empty exposes the binary signal
                      for tests. */}
                  {/* Round 239 / Loop: legend count text gains a tier-
                      coloured fill on hover/pin, completing the hover-
                      deepen-own-hue idiom at this surface. Pre-R239 the
                      count digit's opacity bumped 0.65→0.95 on hover
                      (R204 thinning) but its fill stayed at the neutral
                      pal.legendText gray — same digit, brighter gray,
                      no tier identity. R239 flips fill to row.fill
                      (green/teal/slate per tier) when the row is
                      hovered OR pinned, so the count lights up in its
                      OWN colour, matching the swatch directly above it.
                      The whole row now reads as one tier-coloured unit
                      under cursor (swatch + label + count); R55/R197
                      already do this for swatch + label, R239 closes
                      the trio at the count. Opacity transition stays at
                      150ms; fill joins the same transition list at 150ms
                      so the colour shift eases alongside the opacity
                      ramp. data-legend-count-fill exposes the active
                      fill state for tests; empty tiers (row.count===0)
                      stay at pal.legendText regardless — empty doesn't
                      get to claim tier identity. 8th surface in the
                      hover-deepen-own-hue family. */}
                  {/* Round 274 / Loop: legend per-row count picks up
                      tabular-nums (sibling treatment to R225's recent-
                      signal panel header flow-count + R230's group-
                      label pip strip). The text uses fontFamily=
                      'monospace' which is typically tabular by
                      nature, but some monospace implementations have
                      subtle digit-pair width variance (e.g., '0' vs
                      '1' at the visual boundary). Explicit
                      fontVariantNumeric: 'tabular-nums' is belt-and-
                      suspenders: locks digit widths regardless of
                      the rendered monospace font, so the count
                      column stays planted as offline/idle/working
                      counters roll across 9→10 / 99→100 thresholds.
                      Pure CSS-level addition, no layout shift.
                      10th surface in the info-density tabular-nums
                      sweep family. */}
                  {/* Round 309 / Loop: legend per-row count gains
                      fontWeight=600 (semibold). The count is the
                      DATA the operator scans (how many working /
                      idle / offline nodes); the row label is the
                      stable status word. Default weight (400) on
                      both makes them visually equal — but a glance-
                      first read pattern needs the digit to register
                      faster than the label.
                      fontWeight=600 gives the digit semibold
                      emphasis (matching the h2 'Command mesh'
                      semibold in the title block) while the row
                      label stays at default 400/normal — a clean
                      'digit semibold > label regular' hierarchy
                      that makes the count the optical anchor in
                      each row. After R307+R308 simplified the
                      labels to single status words, the count
                      becomes proportionally more important; this
                      round emphasizes that role typographically. */}
                  {/* Round 446 / Loop: legend per-row count fontWeight
                      lift 600 → 700 on isPinned. Mirror of R444 group-
                      label-count + R445 recent-row-count at the
                      legend-row scope. Closes the 3-panel-row family
                      for the "data tightens under attention" pattern —
                      every panel-row count now responds to pin with a
                      typographic-weight bump:
                        R444 group-label-count   500 → 600
                        R445 recent-row-count    600 → 700  (cold-pin route)
                        R446 legend-row-count    600 → 700  ← this round
                      Hover gate (hoveredStatus===row.key) keeps rest
                      fw=600 so the locked-vs-preview distinction at
                      the type level stays intact — same gate R433 used
                      on the parent <text> letter-spacing tween. R309
                      fw=600 baseline + R204 empty-row opacity dim +
                      R225 tabular-nums all preserved. transition list
                      extends to include 'font-weight 150ms ease-out'
                      matching R433 fill/letter-spacing cadence.
                      data-legend-count-pinned + -font-weight attrs
                      exposed for tests. */}
                  <text
                    x="215" y={row.y1}
                    textAnchor="end"
                    fill={row.count > 0 && (hoveredStatus === row.key || isPinned) ? row.fill : pal.legendText}
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight={isPinned ? '700' : '600'}
                    /* Round 449 / Loop: legend-row count active-state
                       opacity 0.95 → 1.0 on (hoveredStatus===row.key
                       || isPinned). Pre-R449 R204 lifted populated-row
                       active opacity from rest 0.65 to 0.95 — visibly
                       brighter but kept a 5 pct alpha gap (1 - 0.95).
                       R449 closes the gap to 1.0 so the active count
                       reads as confidently present alongside the R446
                       fw=600→700 + R433 letter-spacing tween. Theme-
                       consistency / canvas-presence family extension
                       (7th anchor on the active-presence lift sub-
                       family): R370 hub hover-ring 0.7→0.8, R371 edge-
                       badge rest 0.82→0.85, R372 minimap offline-dot
                       0.5→0.6, R386 hub-highlight idle 0.9→0.95, R387
                       hover-detail panel 0.94→0.97, R429 label-card
                       body 0.94→1.0, R449 legend-count active 0.95→1.0
                       ← this round. Empty-row opacity (R204: 0.28
                       light / 0.30 cyber) and idle 0.65 rest both
                       preserved. */
                    opacity={row.count === 0
                      ? (isLight ? 0.28 : 0.30)
                      : (hoveredStatus === row.key || isPinned ? 1 : 0.65)}
                    data-legend-count={row.key}
                    data-legend-count-empty={row.count === 0 ? 'true' : 'false'}
                    data-legend-count-pinned={isPinned ? 'true' : 'false'}
                    data-legend-count-font-weight={isPinned ? '700' : '600'}
                    data-legend-count-fill={row.count > 0 && (hoveredStatus === row.key || isPinned) ? 'tier' : 'neutral'}
                    style={{ pointerEvents: 'none', transition: 'opacity 150ms ease-out, fill 150ms ease-out, font-weight 150ms ease-out', fontVariantNumeric: 'tabular-nums' }}
                  >{row.count}</text>
                </g>
              );
            })}
            {/* Flow-arrow swatch tracks the offline row — R106 shifted
                rows down by 8 px to make space for the panel header so
                this moves from y=72 to y=80. Drop its pointerEvents so
                the offline legend row stays hoverable (R55). It's
                decoration, no need to receive events. */}
            {/* Round 254 / Loop: legend flow-arrow swatch stroke
                transition for theme toggle (cyber #67e8f9 ↔ light
                #10b981). Last theme-driven legend element snap. */}
            {/* Round 277 / Loop: flow-arrow path tracks new offline-row
                cy=68 after the legend panel compress (was 80 pre-R277).
                Endpoints follow the offline row to keep the swatch
                logically tied to the row it demonstrates; control point
                proportionally shifts so apex stays mid-arc between
                rows 2 and 3. */}
            <path d="M140,68 Q164,44 196,68" fill="none" stroke={pal.flowEdge} strokeWidth="3" markerEnd="url(#topo-arrow)" data-legend-flow-arrow style={{ pointerEvents: 'none', transition: 'stroke 200ms ease-out' }} />
          </g>

          {/* Round 282 / Loop: sleep2agi brand watermark per Vincent
              5215 ask (relayed via 通信龙). Plain monospace text at
              canvas bottom-left (the only fully-empty corner — top
              corners hold recent-signal + legend panels, bottom-
              right holds the chrome strip). No icon yet — public/
              has only favicon.svg (small abstract network icon
              with hardcoded #0a0a1a dark bg that wouldn't blend on
              light theme) + intern_avatar.png (书生 brand-specific).
              Without a sleep2agi-specific crescent/lockup asset,
              R282 ships a low-opacity text-only mark; R283+ can
              swap in the real logo if Vincent provides the asset.

              Position: x=16 (matches the 16-unit SVG inset that the
              corner panels use); y=672 (≈12 px from viewBox bottom
              y=680, descender ≈ y=675, so the entire glyph sits
              clear of the bottom edge). Theme-aware fill:
              pal.legendText (cyber #94a3b8 slate-400 ↔ light
              #475569 slate-600). 0.4 opacity makes it a
              watermark — present but not visually loud. Pointer-
              events:none so it can't intercept clicks on the
              canvas backdrop.

              Note: the brand mark is INTENTIONALLY in a corner
              that no overlay/panel occupies, AND it's purely
              decorative additive after 7 rounds of 减法 (R275-
              R281). Adds 1 small text element back into the
              canvas — but Vincent specifically asked for it. */}
          {/* Round 289 / Loop: brand watermark picks up letterSpacing
              0.5px. For a 9-character wordmark at fontSize 11 monospace,
              0.5px between characters (8 gaps × 0.5 = 4px total
              widening) lifts "sleep2agi" from "body text that happens
              to be a name" to "deliberate wordmark register". Same
              R285-family idiom (kicker tracking-widest, title
              tracking-tight) applied to the brand mark — letter-
              spacing as typographic intent. Stays well inside the
              bottom-left corner; opacity 0.4 unchanged so the
              watermark stays a watermark. */}
          <text
            x="16" y="672"
            fontSize="11" fontFamily="monospace" fontWeight="600"
            letterSpacing="0.5"
            fill={pal.legendText}
            opacity="0.4"
            data-topo-brand-watermark
            style={{ pointerEvents: 'none', transition: 'fill 200ms ease-out' }}
          >sleep2agi</text>
          {/* v0.10.0 Hero 3 Wave 1 / RFC §3.I (Vincent 5215 + 通信龙
              lead-autonomy Q4 dual-anchor minimal): canvas top-left
              crescent moon brand mark, visible ONLY when the
              recent-signal panel is hidden (composes with §3.C). The
              two never co-exist — when flowLinks.length > 0 the
              recent-signal panel occupies the (16,16) corner; when
              flowLinks.length === 0 the corner is empty and the
              brand crescent fills it. R310 title-block crescent
              remains the primary mark; this one is the secondary
              canvas-internal anchor (Q4 dual-anchor minimal).
              Inline path geometry identical to public/sleep2agi-
              logo.svg + the title-block SVG (mask = outer disc minus
              offset inner disc → crescent). Local mask id
              (`s2a-canvas-corner-mask`) prevents collision with the
              other inline crescents. opacity 0.35 (slightly more
              subtle than the bottom watermark's 0.4 since the
              canvas top-left has more contrast headroom). */}
          {/* Round 327 / Loop: canvas brand crescent joins the always-
              mount-opacity-gate family (R181/R182/R183/R213×2/R214/R215/
              R221/R222/R223). Pre-R327 the crescent conditionally
              mounted on `flowLinks.length === 0` — first flow arriving
              SNAP-removed it, last flow leaving SNAP-added it. The
              recent-signal panel at the same (16,16) corner has the
              same snap problem on its conditional-mount path; this
              round closes the crescent's snap-on-mount (the panel's
              own crossfade is a larger surface, deferred).

              Always-mounted with `opacity={flowLinks.length === 0 ?
              0.35 : 0}` + 300ms ease-out transition: when the panel
              hides, the crescent fades in over 300ms; when the panel
              shows, the crescent fades out. Same opacity ramp time
              the R175 panel-fade-in uses for cascade rhythm. data-
              topo-brand-canvas-mark-visible exposes the gate for
              tests. */}
          <g
            opacity={flowLinks.length === 0 ? 0.35 : 0}
            data-topo-brand-canvas-mark
            data-topo-brand-canvas-mark-visible={flowLinks.length === 0 ? 'true' : 'false'}
            style={{ pointerEvents: 'none', transition: 'opacity 300ms ease-out, fill 200ms ease-out' }}
          >
            <defs>
              <mask id="s2a-canvas-corner-mask">
                <rect x="0" y="0" width="28" height="28" fill="black" />
                <circle cx="14" cy="14" r="12" fill="white" />
                <circle cx="17.5" cy="13" r="10" fill="black" />
              </mask>
            </defs>
            <rect
              x="16" y="16" width="28" height="28"
              fill={pal.legendText}
              mask="url(#s2a-canvas-corner-mask)"
            />
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
              /* Round 332 / Loop: minimap container rounded-md → rounded-lg
                 (6 → 8 px) — continues the R330-R331 corner-radius cascade
                 onto the minimap overlay card. The minimap is a smaller
                 surface than the inner SVG panels (120×82 vs 230×88), so
                 it sits one tier inward in the size hierarchy: panels at
                 rx=10 (R331), minimap at rounded-lg=8 (R332), inner
                 detail card at rx=8 (codex 8f981a9). Same 2 px gradient
                 step the rest of the cascade uses. Geometry-safe — the
                 minimap is an HTML overlay positioned `bottom: 56` +
                 `right-4`, no impact on SVG layout or topo-overlap-test. */
              className="absolute right-4 rounded-lg border shadow-lg shadow-black/30 overflow-hidden anet-fade-in anet-topo-chip-focus"
              /* Round 254 / Loop: minimap container theme transitions —
                 background-color, border-color, color (used for SVG
                 currentColor inside) all ease at 200ms alongside the
                 R254 wrapper + R247 panel treatments. */
              style={{ bottom: 56, background: pal.legendBox.fill, borderColor: pal.containerBorder, cursor: 'crosshair', color: pal.legendAccent, transition: 'background-color 200ms ease-out, border-color 200ms ease-out, color 200ms ease-out' }}
              // R157: minimap a11y completion. Pre-R157 the element had
              // role="img" + aria-label but no tabIndex / onKeyDown — it
              // was clickable for mouse users (recenter to where you
              // clicked) but tab-unreachable. role="img" was also wrong
              // for an interactive surface; role="button" matches the
              // canonical pattern R116 / R139 / R140 / R151 / R152 use.
              // Keyboard activation can't compute a click position, so
              // Enter / Space falls back to resetView() — same gesture
              // as the dedicated reset button (R104). Click semantics
              // unchanged; only added a clarifying tail to the aria-
              // label + title. anet-topo-chip-focus picks up R155's
              // cyan outline via color: pal.legendAccent inline so the
              // currentColor inherits cleanly on the rounded card.
              role="button"
              tabIndex={0}
              aria-label="Topology minimap — click to recenter, Enter to reset view"
              title="Minimap · click to recenter · Enter to reset view"
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
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  resetView();
                }
              }}
              // R346: viewport rect hover affordance driven by parent.
              onMouseEnter={() => setHoveredMinimap(true)}
              onMouseLeave={() => setHoveredMinimap(false)}
              onFocus={() => setHoveredMinimap(true)}
              onBlur={() => setHoveredMinimap(false)}
              data-topo-minimap
              data-topo-minimap-hovered={hoveredMinimap ? 'true' : 'false'}
            >
              <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`} style={{ display: 'block' }}>
                {/* Round 198 / Loop: minimap dots gain smooth status
                    transitions. Pre-R198 a session flipping working→idle
                    or going offline made the minimap dot snap in a single
                    frame (opacity 0.9→0.5, r 1.7→1.2, fill swap). The
                    canvas itself eases all of these via R167 status-ring
                    transitions, R10 freshness, R3 fade-in — but the
                    minimap mirror was still snap-cut. Adding opacity /
                    fill / r to the CSS transition list lets a status
                    change ripple smoothly through both views at the
                    same rhythm. 200ms matches the R167 nodeStrokeWidth
                    interpolation on the main canvas so the two surfaces
                    visually flip in sync. r-as-property is well supported
                    Chrome ≥ 95 / Safari ≥ 16 / FF ≥ 70 (same support
                    matrix R197 just leveraged on the legend swatch).
                    data-topo-minimap-dot exposes each dot for the test;
                    data-topo-minimap-dot-online encodes the binary status
                    used by the visible attributes. */}
                {[...onlineNodes, ...offlineNodes].map(s => {
                  const p = nodePositions[s.alias];
                  if (!p) return null;
                  const sseN = (s.network_id ? sseSessions[`${s.network_id}:${s.alias}`] : undefined) ?? sseSessions[s.alias];
                  const isOn = s.status !== 'offline' || !!sseN;
                  const st = nodeStatus(s, isOn, isLight);
                  return (
                    /* Round 372 / Loop: minimap offline-dot opacity
                       0.5 → 0.6. Sibling stale-state legibility lift
                       to R358 freshness ramp floor 0.25 → 0.30 + R317
                       subordinate-text-lift family. Pre-R372 R198
                       drew offline dots at α=0.5 (44 % below online
                       0.9). The minimap is a small overlay against
                       the canvas backdrop — at α=0.5 offline dots
                       sat at the legibility floor when the minimap
                       mounted (only on non-default view). R372 lifts
                       offline 0.5 → 0.6 for +20 % relative presence;
                       online stays at 0.9 so the offline/online
                       contrast ratio is now 0.6/0.9 ≈ 0.67 (vs prior
                       0.5/0.9 ≈ 0.56) — still a clear two-tier
                       distinction. R198 opacity + fill + r transition
                       list preserved so status flips still ease
                       smoothly. data-topo-minimap-dot-opacity attr
                       exposes the resolved value for tests. */
                    <circle
                      key={s.alias}
                      cx={p.x * sx} cy={p.y * sy}
                      /* Round 384 / Loop: minimap online dot radius 1.7
                         → 1.9. Sibling visual-weight bump (10th anchor)
                         to R383 recent-row pip 1.8 → 2.0. R198 designed
                         the dots at 1.7 (online) / 1.2 (offline) — at
                         the minimap's 120 × 82 scale these read clearly
                         but the online ↔ offline contrast was modest
                         (1.7/1.2 = 1.42×). R384 bumps online to 1.9 so
                         the tier delta widens to 1.58× (1.9/1.2). Pair
                         completes minimap-dot legibility polish:
                           R358 (era R372) offline opacity 0.5 → 0.6
                           R384            online radius 1.7 → 1.9 (this round)
                         R198 transition list (opacity + fill + r 200ms)
                         preserved so status flips still ease smoothly.
                         data-topo-minimap-dot-radius attr exposes the
                         resolved value for tests. */
                      /* Round 392 / Loop: minimap online dot opacity
                         0.9 → 0.95. Theme-consistency / canvas-presence
                         polish family (7th anchor) — mirrors R386's
                         hub-highlight idle 0.9 → 0.95 lift on the
                         minimap surface: the online-dot's idle alpha
                         gap (0.10 against full presence) halves to
                         0.05, so the live-fleet anchors on the minimap
                         read more confidently. Offline dot stays at
                         R372 0.6 — the binary online/offline contrast
                         ratio shifts from 0.6/0.9 ≈ 0.67 to 0.6/0.95
                         ≈ 0.63, preserved as a clear two-tier
                         distinction. R198 opacity + fill + r transition
                         list + R384 r=1.9 + R372 offline 0.6 all
                         preserved. data-topo-minimap-dot-opacity attr
                         bumps to '0.95' for tests. */
                      /* Round 421 / Loop: online dot opacity 0.95 → 1.0
                         on minimap container hover. Sibling to R346
                         viewport rect strokeWidth/opacity hover tween.
                         When the user hovers the minimap container,
                         the live-fleet anchors brighten from R392
                         baseline (0.95) to full opacity in concert
                         with the R346 viewport rect lift. Offline
                         stays at R372 0.6 — hover state focuses
                         attention on the ACTIVE anchors, not the
                         stale ones. data-topo-minimap-dot-opacity
                         attr (R392) reflects the resolved hover-
                         state value for tests. */
                      /* Round 486 / Loop — 3rd anchor in the
                         inspection-overrides-encoding pattern. Sibling
                         to R484 (recent-row timestamp) + R485 (edge
                         particle). When the operator hovers a node
                         alias on the main canvas, the matching
                         minimap dot lifts to opacity=1.0 regardless
                         of the binary online/offline encoding —
                         cross-reference cue between canvas focal
                         and the minimap wayfinding overlay.
                         Pre-R486 an offline node's minimap dot stayed
                         at 0.6 even when the operator was inspecting
                         it via canvas hover; R486 makes the
                         inspection signal jump the minimap dot to
                         full presence so the spatial reference is
                         unambiguous.
                         Encoding survives: data-topo-minimap-dot-
                         online preserves the online/offline binary,
                         data-topo-minimap-dot-opacity-rest preserves
                         the would-be opacity. Only the LIVE painted
                         opacity flips on inspection.
                         inspection-overrides-encoding family — 3
                         anchors now:
                           R484 recent-row timestamp
                           R485 edge particle
                           R486 minimap dot   ← this round
                         data-topo-minimap-dot-lifted attr exposes
                         the override gate. */
                      r={isOn ? 1.9 : 1.2}
                      fill={st.primary}
                      opacity={hoveredAlias === s.alias ? 1 : (isOn ? (hoveredMinimap ? 1 : 0.95) : 0.6)}
                      data-topo-minimap-dot={s.alias}
                      data-topo-minimap-dot-online={isOn ? 'true' : 'false'}
                      data-topo-minimap-dot-opacity={hoveredAlias === s.alias ? 1 : (isOn ? (hoveredMinimap ? 1 : 0.95) : 0.6)}
                      data-topo-minimap-dot-opacity-rest={isOn ? (hoveredMinimap ? 1 : 0.95) : 0.6}
                      data-topo-minimap-dot-lifted={hoveredAlias === s.alias ? 'true' : 'false'}
                      data-topo-minimap-dot-radius={isOn ? 1.9 : 1.2}
                      style={{
                        transition: 'opacity 200ms ease-out, fill 200ms ease-out, r 200ms ease-out',
                      } as React.CSSProperties}
                    />
                  );
                })}
                {/* viewport rectangle.
                    Round 199 / Loop: rect dimensions transition smoothly
                    during R169 smoothView arming (discrete zoom button
                    clicks + keyboard +/− + reset/fit). Pre-R199 the main
                    canvas crossfaded over R168's 280ms opacity blend
                    while the minimap viewport rect snap-cut to its new
                    x/y/w/h in one frame — exactly the same rhythm
                    mismatch R198 just closed for the minimap dots, now
                    fixed for the rectangle that frames them.

                    Gated to smoothView=true so continuous wheel-zoom /
                    drag-pan stay snappy (a CSS transition during drag
                    would cause the rect to chase the cursor with a
                    280ms lag). Discrete zooms arm smoothView for 350ms,
                    long enough to cover the 280ms x/y/w/h transition.

                    Setting x/y/width/height as CSS PROPERTIES (style.x
                    etc.) — same approach R197 used for legend swatch
                    r. Modern Chrome/Safari/FF interpolate these.

                    data-topo-minimap-viewport / -smooth expose state for
                    tests. */}
                {/* Round 287 / Loop: minimap viewport rect strokeWidth
                    1 → 1.5. The rect frames the user's current view
                    within the full topology — it IS the wayfinding
                    indicator. At 1px stroke against a 120×82 mini-
                    canvas it was readable but reserved; 1.5px gives
                    the boundary clearer presence without crowding the
                    miniaturised dots (still r 1.2-1.7) inside.
                    Same micro-polish family as R283 monogram stroke
                    1 → 1.5 — small visual-weight bump on a high-
                    information element to lift it above ambient
                    chrome. opacity 0.9 stays — strokeWidth alone
                    does the lifting. */}
                {/* Round 379 / Loop: minimap viewport rect picks up
                    strokeLinejoin='round'. Pre-R379 the rect's 4
                    corners painted with default 'miter' joins —
                    sharp 90° corners with a small miter overshoot
                    (≈ strokeWidth × 1.4 = 2.1 px at sw=1.5). R379
                    rounds the joins so corners arc smoothly through
                    a quarter-circle of radius ≈ strokeWidth/2. At
                    sw=1.5 that's a 0.75-px radius — subtle but
                    matches the same stroke-softening vocabulary R288
                    chrome icons (zoom/reset/fullscreen) and R378
                    flow-rail already speak. Geometry-safe: stroke-
                    linejoin only affects the corner overshoot, the
                    rect's bbox is unchanged. R287 strokeWidth=1.5 +
                    R346 hover-state strokeWidth/opacity bump + R199
                    smoothView x/y/w/h transition all preserved.
                    data-topo-minimap-viewport-linejoin attr exposes
                    the value for tests. */}
                {/* Round 393 / Loop: minimap viewport rect rx 0 → 2.
                    Pre-R393 the cyan-stroked viewport rect (the frame
                    showing what's currently visible on the canvas)
                    drew with sharp corners inside the R332 rounded
                    minimap container (rx=8). A small frame with sharp
                    corners sitting inside a rounded container reads
                    as visually loud — the 90° corners catch the eye
                    against the soft container edge. R393 adds rx=2
                    so the viewport corners get a subtle radius that
                    matches the family's softening idiom on a sub-
                    element scale. The R379 strokeLinejoin='round'
                    already softens stroke joins; R393 adds a complete
                    geometric soften via rx.
                    Corner-radius cascade (7 anchors now):
                      R330 canvas             rx 12
                      R331 panels             rx 10
                      R332 minimap container  rx 8
                      R375 Layout-toggle      rx 8
                      R376 nodeSize/zoom      rx 8
                      R390 hover-detail       rx 10
                      R393 minimap viewport   rx 2  (this round, sub-element)
                    The 2-px radius is intentionally small — the
                    viewport rect is typically only 30-50px wide,
                    where rx=2 reads as "rounded enough to not snap"
                    without feeling pillowy. data-topo-minimap-
                    viewport-rx attr exposes the resolved value
                    for tests. R346 hover-state tweens (strokeWidth
                    + opacity) preserved verbatim. */}
                <rect
                  x={Math.max(0, rectX)} y={Math.max(0, rectY)}
                  width={Math.max(0, Math.min(MW - Math.max(0, rectX), rectW))}
                  height={Math.max(0, Math.min(MH - Math.max(0, rectY), rectH))}
                  rx="2"
                  fill="none" stroke={pal.legendAccent}
                  // R346: strokeWidth + opacity tween on container hover.
                  strokeWidth={hoveredMinimap ? '1.75' : '1.5'}
                  strokeLinejoin="round"
                  /* Round 450 / Loop · milestone: minimap viewport rest
                     opacity 0.9 → 0.95. Closes half the alpha gap on
                     the wayfinding indicator while preserving the
                     R346 hover delta to 1.0. Pre-R450 the rest viewport
                     sat at 0.9 (10 pct alpha gap) — adequate but
                     under-confident for the user's primary "you are
                     here" indicator on the minimap. R450 lifts to 0.95
                     so the rest read is more present without erasing
                     the hover lift cue (the +0.05 rest-to-hover delta
                     is small but pairs with R346 sw 1.5→1.75 to keep
                     hover clearly distinguishable). Sibling to R449
                     legend-count active opacity 0.95→1.0 — same
                     "close the active-presence alpha gap" idiom now
                     applied to the REST tier of the wayfinding rect
                     (the minimap viewport stays at canvas-presence
                     register even when un-hovered since it's the
                     spatial referent). Theme-consistency / canvas-
                     presence family (8th anchor on the active-
                     presence lift sub-arc).
                     R287 strokeWidth=1.5 + R379 strokeLinejoin='round'
                     + R346 hover-state tweens + R393 rx=2 + R199
                     smoothView x/y/w/h transition all preserved. */
                  opacity={hoveredMinimap ? '1' : '0.95'}
                  data-topo-minimap-viewport
                  data-topo-minimap-viewport-rx="2"
                  data-topo-minimap-viewport-smooth={smoothView ? 'true' : 'false'}
                  data-topo-minimap-viewport-hover={hoveredMinimap ? 'true' : 'false'}
                  data-topo-minimap-viewport-linejoin="round"
                  /* Round 481 / Loop — 6th anchor in the drop-shadow
                     visual-polish family. New gate type: ZOOM STATE.
                     When current canvas zoom > 1.5x (50% above the
                     default 1.0 baseline), the minimap viewport rect
                     gains a soft cyan halo signaling "you're zoomed
                     in beyond default". The minimap viewport already
                     shrinks as you zoom in (rectW = VIEWBOX_W /
                     view.zoom * sx, so at zoom=2 it halves) — the
                     glow tells you the wayfinding marker is now
                     scaled-down rather than at canvas-default size.
                     Drop-shadow family — 6 gate types covered:
                       R476  hub digit       hover-gated
                       R477  legend pin-ring pin-gated
                       R478  freshness pip   freshness-gated
                       R479  group label     pin-gated
                       R480  edge badge      hot-lane-gated
                       R481  minimap         zoom-gated      ← this round
                     6 distinct semantic gates (user interaction
                     transient/sticky × 2, data freshness, data
                     volume, canvas zoom state). Each anchor uses
                     hue family appropriate to its semantic context.
                     Hue: pal.legendAccent at 0x80 alpha — matches
                     the existing R107 tint family and R478/R479
                     cyan-tone choices. 2-px blur reads as subtle
                     (the minimap viewport is small, ~120×82 px).
                     Filter is paint-only — bbox unchanged. transition
                     list extends to include 'filter 200ms ease-out'
                     so the glow eases when zoom crosses 1.5x. */
                  data-topo-minimap-viewport-glow={view.zoom > 1.5 ? 'true' : 'false'}
                  style={{
                    filter: view.zoom > 1.5
                      ? `drop-shadow(0 0 2px ${pal.legendAccent}80)`
                      : undefined,
                    transition: smoothView
                      ? 'x 280ms ease-out, y 280ms ease-out, width 280ms ease-out, height 280ms ease-out, stroke-width 200ms ease-out, opacity 200ms ease-out, filter 200ms ease-out'
                      : 'stroke-width 200ms ease-out, opacity 200ms ease-out, filter 200ms ease-out',
                  } as React.CSSProperties}
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
        {/* Round 261 / Loop: chrome strip bottom-3 right-3 (12 CSS px) →
            bottom-4 right-4 (16 CSS px) to align HTML overlay padding
            with the SVG corner panels at (16, 16) panel-translate. Pre-
            R261 the SVG panels (at 16 SVG units from canvas edges,
            ≈ 15 CSS px after render-scale ~0.94) and the HTML chrome
            (at 12 CSS px) sat at visually different distances from
            the canvas edges — small but real ~3 CSS px optical
            asymmetry between SVG-layer and HTML-layer overlay padding.
            16 CSS px ≈ 17 SVG units, unifying the visual padding
            vocabulary across both layers. Sibling change at the
            minimap container (line ~6444, `absolute right-3` →
            `right-4`) keeps the bottom-right corner HTML overlays
            aligned at the same canvas-edge inset. */}
        {/* Round 326 / Loop: chrome strip outer wrapper gap 1.5 → 2
            (6px → 8px between control groups). Pre-R326 the four
            chrome groups (nodeSize segmented S/M/L, zoom +/100%/−,
            reset, fullscreen) sat 6px apart — close enough that on a
            busy canvas with bright cyan accents they read as one
            uniform strip rather than four distinct affordances. Bump
            to 8px gives each group its own visual breath without
            disturbing the bottom-4 right-4 corner-inset alignment.
            Sibling treatment to R298/R299 title-block gap polish on
            the top side of the canvas — both ends of the canvas
            chrome now breathe at the same 8px rhythm. Geometry-safe
            for the overlap-test (chrome is HTML overlay on top of
            the SVG, not part of the viewBox 1000x680 surface; ring
            r=325 / grid gx0 layout untouched). */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2 text-xs select-none" data-topo-chrome>
          {/* #113: node size — S / M / L segmented control (Vincent 4727).
              R154: stable data-* hooks for tests + focus-visible ring so
              keyboard navigation lands somewhere visible against the
              dark canvas (browser default outline often vanishes on
              cyber theme). */}
          {/* Round 264 / Loop: nodeSize wrapper gains theme-toggle
              transition. Pre-R264 the wrapper's bg (pal.legendBox.fill)
              + borderColor (pal.containerBorder) were inline theme-
              conditional, but neither inline transition nor a
              transition-colors className → wrapper snapped on cyber↔
              light flip while the inner S/M/L buttons eased via their
              own transition-colors. Same R254 holdover pattern that
              R263 just closed at the canvas wrapper scope, now at the
              chrome strip's nodeSize sub-wrapper scope. */}
          {/* Round 376 / Loop: nodeSize wrapper rounded-md → rounded-lg.
              Sibling polish to R375 Layout-toggle wrapper. Three
              chrome-strip segmented controls now all share rounded-lg
              at the wrapper tier:
                R375 Layout-toggle wrapper  rounded-lg  8 px
                R376 nodeSize  wrapper      rounded-lg  8 px (this round)
                R376 zoom      wrapper      rounded-lg  8 px (this round)
              Individual atomic chrome buttons (reset, fullscreen) keep
              rounded-md (6 px) as their own atomic-button tier — the
              chrome strip's typography now expresses a clear two-tier
              hierarchy: 'segmented control container' (rounded-lg)
              vs 'standalone button' (rounded-md). Pure paint change,
              no layout shift. */}
          <div
            className="flex items-center rounded-lg border overflow-hidden"
            data-topo-chrome-nodesize-radius="rounded-lg"
            style={{
              background: pal.legendBox.fill,
              borderColor: pal.containerBorder,
              transition: 'background-color 200ms ease-out, border-color 200ms ease-out',
            }}
            role="group"
            aria-label="Node size"
            data-topo-chrome-fleet-group-trailer
          >
            {([['S', 0.7], ['M', 0.84], ['L', 1]] as const).map(([lbl, v], idx) => {
              const popKey = `size-${lbl}` as 'size-S' | 'size-M' | 'size-L';
              return (
              <button
                key={lbl}
                onClick={() => { popChrome(popKey); pickNodeScale(v); }}
                aria-pressed={nodeScale === v}
                data-topo-chrome-nodesize={lbl}
                data-topo-chrome-nodesize-active={nodeScale === v ? 'true' : 'false'}
                data-topo-chrome-nodesize-popping={chromePopping === popKey ? 'true' : 'false'}
                title={`Node size: ${lbl === 'S' ? 'small' : lbl === 'M' ? 'medium' : 'large'}`}
                // Round 179 / Loop: nodeSize S/M/L active-button hover
                // variant closes the inconsistency with R163 layout
                // toggle and R178 fullscreen. Pre-R179 the active
                // (selected) S/M/L button had bg-cyan-500/15 + text-
                // cyan-300 but NO hover response — the chip looked
                // 'locked', not 'still interactive'. R163 and R178
                // both add hover:bg-cyan-500/20 on the active variant
                // so the active chip stays responsive to mouse. R179
                // closes the trio so all three chrome active-cyan
                // surfaces ship the same gesture.
                // Round 196 / Loop: nodeSize buttons pick up press-state
                // (active:) — selected variant deepens to cyan-500/25,
                // unselected to white/10. Same tier pattern as R196 layout
                // toggle + zoom/reset/fullscreen below.
                // Round 250 / Loop: nodeSize buttons close the chrome-pop
                // family — every clickable chrome button now fires the
                // R186 .anet-chrome-pop scale-pulse on release. R171
                // canvas crossfade (nodeSizeSwitching) keeps masking the
                // node radius change at the global scope; R250 chrome-pop
                // adds the LOCAL button-level confirmation. The two
                // happen simultaneously without conflict — local scale
                // pulse on the button, global canvas dim around it.
                // Milestone round: the entire chrome strip (zoom -/+,
                // ring/grid, fullscreen, S/M/L) now speaks one
                // consistent click vocabulary.
                /* Round 270 / Loop: nodeSize INACTIVE buttons align with
                   the Layout toggle's R163 hover-preview pattern. Pre-
                   R270 inactive S/M/L used `hover:bg-white/5
                   active:bg-white/10` (neutral white tint) while the
                   Layout toggle's inactive Ring/Grid uses `hover:bg-
                   cyan-500/5 active:bg-cyan-500/15` (faint cyan ghost
                   that previews what the active state will look like —
                   the active variant is bg-cyan-500/15). Two different
                   hover vocabularies for visually-analogous toggle
                   controls. R270 unifies inactive toggle hover to
                   cyan so all TOGGLE chrome buttons (Layout / nodeSize
                   / fullscreen) preview their active state on hover.
                   Pure actions (zoom -/+, reset) stay white — they
                   aren't toggles, have no active state to preview. */
                // Round 493 / Loop — extends R492 chrome-strip press-feedback
                // family to nodeSize S/M/L buttons. Adds active:scale-95
                // alongside the existing color-deepen (R196) + chrome-pop
                // (R249). transition-transform + duration-200 + ease-out
                // + transform-gpu added since this className previously had
                // transition-colors only — without the transform transition,
                // active:scale-95 would hard-cut. transform-gpu promotes the
                // layer so scale doesn't trigger paint thrash.
                className={`px-2 py-1 transition-colors transition-transform duration-200 ease-out transform-gpu active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 focus-visible:ring-inset ${idx > 0 ? 'border-l' : ''} ${nodeScale === v ? 'bg-cyan-500/15 text-cyan-300 font-medium hover:bg-cyan-500/20 active:bg-cyan-500/25' : 'hover:bg-cyan-500/5 active:bg-cyan-500/15'}${chromePopping === popKey ? ' anet-chrome-pop' : ''}`}
                style={{ color: nodeScale === v ? undefined : pal.legendText, borderColor: pal.containerBorder }}
              >
                {lbl}
              </button>
              );
            })}
          </div>
          {/* Round 255 / Loop: semantic gap between the fleet-control group
              (node size S/M/L) and the view-control group (zoom / reset /
              fullscreen). Pre-R255 the four groups sat at uniform gap-1.5
              (6px); the spatial signal read as "4 separate things" instead
              of "1 fleet control + 3 view controls". Doubling the gap before
              the first view-control (ml-1.5 = 6px stacks on top of the
              parent's gap-1.5 = 6px, total 12px) communicates the semantic
              boundary through proximity alone — classic "law of proximity"
              layout polish, no extra chrome, no new visual elements.
              data-topo-chrome-view-group-leader marks the boundary surface
              for the test probe; data-topo-chrome-fleet-group-trailer marks
              the nodeSize wrapper's right edge for the gap measurement. */}
          {/* R376 sibling — zoom wrapper rounded-md → rounded-lg.
              Closes the chrome-strip segmented-control corner radius
              cascade (Layout R375 + nodeSize R376 + zoom R376). */}
          <div
            className="ml-1.5 flex items-center rounded-lg border overflow-hidden"
            data-topo-chrome-zoom-wrapper-radius="rounded-lg"
            style={{
              background: pal.legendBox.fill,
              borderColor: pal.containerBorder,
              transition: 'background-color 200ms ease-out, border-color 200ms ease-out',
            }}
            data-topo-chrome-view-group-leader
            data-topo-chrome-zoom-wrapper
          >
            <button
              onClick={() => { popChrome('zoom-out'); zoomByDiscrete(1 / 1.2); }}
              data-topo-chrome-zoom-out
              data-topo-chrome-zoom-out-popping={chromePopping === 'zoom-out' ? 'true' : 'false'}
              // R196: press-state deepens bg one tier above hover (white/5
              // → white/10) so mouse-down has a tactile dim before the
              // R186 icon pop fires on release.
              // R352: `group` lets the inner svg respond via group-hover.
              // R493 — zoom +/− buttons join the chrome-strip active:scale-95
              // press-feedback family (R492 + nodeSize above). transition-
              // transform + duration-200 + ease-out + transform-gpu added
              // since the className had only transition-colors.
              className="group px-2 py-1 hover:bg-white/5 active:bg-white/10 transition-colors transition-transform duration-200 ease-out transform-gpu active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 focus-visible:ring-inset"
              style={{ color: pal.legendText }}
              aria-label="Zoom out"
              title="Zoom out (−)"
            >
              {/* R186: icon pop on click. CSS animation runs once;
                  React removes the class after 240ms so a quick
                  re-click can replay. */}
              {/* Round 352 / Loop: zoom-out icon picks up group-hover:
                  scale-110 — sibling to R350 reset hover-rotate. Pre-
                  R352 hovering the zoom button only changed the bg
                  (white/5); the icon inside stayed perfectly still.
                  R352 lifts the icon 10% on hover for a tactile "this
                  button does something" cue. The R186 anet-chrome-pop
                  keyframe (220ms scale 1→1.06→1) still owns transform
                  during click via CSS-animation precedence over
                  transition-transform; after the pop ends + className
                  is removed, the group-hover scale-110 picks up
                  smoothly. `transform-gpu` hint promotes the svg to
                  its own compositor layer for crisper edges during
                  the scale tween. Sibling change on zoom-in icon
                  below. */}
              {/* Round 454 / Loop: extend R453 chrome reset icon hover
                  sw lift to zoom +/− icons via Tailwind arbitrary class
                  group-hover:[stroke-width:2.8]. Chrome icon hover sw
                  lift family now 5 anchors:
                    R208 runtime badge outer ring   1.5 → 2
                    R443 runtime badge inner icon   2.4 → 2.8
                    R453 chrome reset icon          2.5 → 2.8
                    R454 chrome zoom-out icon       2.5 → 2.8  ← this round
                    R454 chrome zoom-in icon        2.5 → 2.8  ← this round
                  Tailwind v4 arbitrary-value group-hover variant
                  resolves [stroke-width:2.8] as a CSS property which
                  overrides the static strokeWidth='2.5' attribute on
                  hover. transition-[stroke-width] appended to the
                  existing transition-transform list so the sw tween
                  eases under the same 200ms cadence as R352 group-
                  hover:scale-110. R186 anet-chrome-pop keyframe still
                  owns transform during click via CSS-animation
                  precedence over transition-transform. Sibling change
                  on zoom-in icon below. */}
              <svg
                width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                aria-hidden
                className={`transition-[transform,stroke-width] duration-200 ease-out group-hover:scale-110 group-hover:[stroke-width:2.8] transform-gpu${chromePopping === 'zoom-out' ? ' anet-chrome-pop' : ''}`}
                data-topo-chrome-zoom-out-icon
              ><path d="M5 12h14" /></svg>
            </button>
            {/* Round 192 / Loop: zoom-level readout span participates in the
                R186 click-feel pop alongside the +/− icons. Pre-R192 a click
                on + or − triggered:
                  · icon pop          (R186, ~220ms scale 1→1.06→1)
                  · canvas crossfade  (R169, ~280ms opacity blend)
                  · readout text snap (instant — 100% → 120%)
                The readout was the only surface that didn't acknowledge the
                gesture. Reusing the existing .anet-chrome-pop CSS keyframe
                (no new keyframes) lets the "%" number gently bounce in
                sync with the icon — same 0.22s ease-out, transform-origin
                center. transform-box: fill-box on the keyframe is
                SVG-specific and harmlessly ignored on this HTML span. The
                base layout classes (px / border / tabular-nums / minWidth)
                stay intact; only when chromePopping is 'zoom-in' or
                'zoom-out' do we splice in the animation class. Same
                React-clears-after-240ms cleanup R186 already runs, so the
                class can replay on a repeat click. */}
            {/* Round 312 / Loop: chrome strip zoom readout '{N}%'
                picks up `font-medium` (500). Extends the R309-R311
                'data digit weighs more than label' rule to the
                chrome strip's one data display — the zoom
                percentage. Every other chrome strip text is a
                control (S/M/L buttons, zoom +/-, reset, fullscreen,
                Ring/Grid labels); the percent readout is the only
                live DATA. font-medium (not 600 like the SVG panel
                counts) is a tier below because the readout sits in
                HTML chrome context (lighter visual baseline) where
                500 reads as 'noticeably data-prominent' without
                competing with the SVG panel counts. tabular-nums
                + minWidth 46 stay (R225 family), the existing R264
                color/border transitions stay, the R186 chrome-pop
                class still toggles on zoom-click. */}
            <span
              className={`px-2 py-1 tabular-nums font-medium border-x text-center${
                chromePopping === 'zoom-in' || chromePopping === 'zoom-out'
                  ? ' anet-chrome-pop' : ''
              }`}
              data-topo-chrome-zoom-level
              data-topo-chrome-zoom-level-popping={
                chromePopping === 'zoom-in' || chromePopping === 'zoom-out'
                  ? 'true' : 'false'
              }
              data-topo-chrome-zoom-level-hover={hoveredZoomLevel ? 'true' : 'false'}
              onMouseEnter={() => setHoveredZoomLevel(true)}
              onMouseLeave={() => setHoveredZoomLevel(false)}
              style={{
                color: pal.legendText,
                borderColor: pal.containerBorder,
                minWidth: 46,
                display: 'inline-block',
                // R347: letter-spacing hover tween — extends R344/R345
                // hover-letter-spacing family into the chrome strip.
                letterSpacing: hoveredZoomLevel ? '0.5px' : '0',
                // Round 420 / Loop: zoom-level readout gains a SECOND
                // hover axis — fontWeight 500 → 600 on hover. Sibling
                // to R347 (same element, hover letter-spacing tween).
                // The chrome strip's only data display now has a two-
                // axis hover signature (letter-spacing + fontWeight),
                // matching the R416 chip-row chip digit hover-bold
                // pattern at the chrome scope. Pre-R420 hovering only
                // spread the digits 0 → 0.5px; the weight stayed at
                // R332's 'font-medium' (500) baseline. Post-R420
                // hover lifts BOTH letter-spacing AND weight so the
                // percent reads with the same data-tier emphasis
                // intensification the chip-row chips do on hover.
                // Inline fontWeight overrides the className's
                // 'font-medium' since they target the same property.
                // 200ms transition list extends to font-weight for
                // smooth easing. data-topo-chrome-zoom-level-hover
                // attr surfaces the hover state for tests.
                fontWeight: hoveredZoomLevel ? 600 : 500,
                /* Round 264 / Loop: zoom level readout gains theme-toggle
                   transition. The span has theme-driven color (pal.
                   legendText) + border-x (pal.containerBorder via the
                   inline borderColor) but className lacks transition-
                   colors — the readout's text + side dividers snapped
                   on theme flip while siblings eased. Sibling treatment
                   to the nodeSize + zoom wrapper transitions added this
                   round. */
                transition: 'color 200ms ease-out, border-color 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out',
              }}
              title="Current zoom level"
            >
              {Math.round(view.zoom * 100)}%
            </span>
            <button
              onClick={() => { popChrome('zoom-in'); zoomByDiscrete(1.2); }}
              data-topo-chrome-zoom-in
              data-topo-chrome-zoom-in-popping={chromePopping === 'zoom-in' ? 'true' : 'false'}
              // R196: press-state (mirror of zoom-out above).
              // R352: `group` lets the inner svg respond via group-hover.
              // R493 — zoom +/− buttons join the chrome-strip active:scale-95
              // press-feedback family (R492 + nodeSize above). transition-
              // transform + duration-200 + ease-out + transform-gpu added
              // since the className had only transition-colors.
              className="group px-2 py-1 hover:bg-white/5 active:bg-white/10 transition-colors transition-transform duration-200 ease-out transform-gpu active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 focus-visible:ring-inset"
              style={{ color: pal.legendText }}
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
              {/* R186: icon pop on click. Same one-shot CSS animation
                  as zoom-out; React removes the class after 240ms. */}
              {/* R352 sibling — zoom-in icon picks up the same
                  group-hover:scale-110 family. Mirror change at
                  the zoom-out icon above. */}
              {/* R454 sibling — zoom-in icon picks up the same
                  group-hover:[stroke-width:2.8] family lift. */}
              <svg
                width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                aria-hidden
                className={`transition-[transform,stroke-width] duration-200 ease-out group-hover:scale-110 group-hover:[stroke-width:2.8] transform-gpu${chromePopping === 'zoom-in' ? ' anet-chrome-pop' : ''}`}
                data-topo-chrome-zoom-in-icon
              ><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          <button
            onClick={() => { armResetSpin(); resetView(); }}
            data-topo-chrome-reset
            data-topo-chrome-reset-spinning={resetSpinning ? 'true' : 'false'}
            data-topo-chrome-reset-hover={hoveredReset ? 'true' : 'false'}
            // R350: hover state drives the icon transform below.
            onMouseEnter={() => setHoveredReset(true)}
            onMouseLeave={() => setHoveredReset(false)}
            onFocus={() => setHoveredReset(true)}
            onBlur={() => setHoveredReset(false)}
            // R196: press-state deepens before R184 reset-spin fires on
            // release — mouse-down dim then 450ms spin = full handshake.
            /* Round 400 / Loop · milestone: chrome reset + fullscreen
               buttons gain hover:-translate-y-px lift — closes the
               hover-lift gesture vocabulary across every standalone
               interactive HTML element in TopoGraph. Segmented
               controls (zoom -/+, nodeSize S/M/L, Layout Ring/Grid)
               intentionally stay planted: lifting one segment of a
               unified strip would tear the visual unity of the
               segmented control. Only the standalone chrome buttons
               (reset, fullscreen) get the lift.
               Gesture vocabulary post-R400 (now complete across HTML):
                 chip-row chips (3×)  -1 px  R398, R399
                 filter pin pills (4×) -1 px R397
                 recent-signal row    -1 px  R143
                 legend row           -1 px  R144
                 reset button         -1 px  R400 (this round)
                 fullscreen button    -1 px  R400 (this round)
               Every standalone interactive HTML surface in TopoGraph
               now lifts on hover. data-topo-chrome-reset-hover-lift
               attr surfaces the lift for tests. */
            // R493 — reset button joins the chrome-strip active:scale-95
            // press-feedback family. The button already has transition-
            // transform + transform-gpu (R350 reset spin + R400 hover lift),
            // so just appending active:scale-95 plugs straight in. Compound
            // active state during press = hover-lift (-1px) + scale-95
            // composes as translateY(-1px) scale(0.95) — lift-and-compress
            // for tactile click feel.
            className="p-1.5 rounded-md border hover:bg-white/5 active:bg-white/10 hover:-translate-y-px active:scale-95 transition-colors transition-transform duration-200 ease-out transform-gpu focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60"
            data-topo-chrome-reset-hover-lift="true"
            style={{ background: pal.legendBox.fill, borderColor: pal.containerBorder, color: pal.legendText }}
            aria-label="Reset view"
            title="Reset zoom + pan (0, or double-click the canvas)"
          >
            {/* R184: the refresh-arrow icon does one counter-clockwise
                rotation on click. CSS animation runs once; React removes
                the className after 460ms (just past the 450ms duration)
                so a subsequent click can replay. */}
            {/* Round 288 / Loop: reset icon strokeWidth 2 → 2.5 unifies
                the chrome icon weight family. Pre-R288 zoom-in / zoom-
                out icons rendered at strokeWidth 2.5 while reset +
                fullscreen icons sat thinner at strokeWidth 2 — five
                chrome icons in a single horizontal strip with two
                weights is exactly the inconsistency R268 closed for
                border colors. Same unification idiom now applied to
                icon strokes: zoom (2.5) + reset (2.5) + fullscreen
                (2.5) all share one weight. View-box (24×24) and
                display size (13×13) unchanged, so geometry stays
                pixel-stable — only the stroke deepens. */}
            {/* Round 453 / Loop: chrome reset icon strokeWidth hover
                lift — 2.5 → 2.8 on hoveredReset && !resetSpinning.
                Sibling to R443 runtime badge inner-icon sw lift
                (2.4→2.8) — both chrome icons now thicken on hover
                for tactile feedback. Pre-R453 reset hover was a
                rotate-only cue (R350); R453 adds a stroke-weight
                axis so the affordance reads with both motion (R350
                rotate -8°) AND geometry (R453 sw +0.3). Gated on
                !resetSpinning so the R184 spin keyframe owns paint
                during its 450ms run. 200ms stroke-width transition
                appended to the style list matches R350 transform
                cadence. data-topo-chrome-reset-icon-stroke-width
                attr exposes the resolved value for tests. */}
            <svg
              width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor"
              strokeWidth={hoveredReset && !resetSpinning ? '2.8' : '2.5'}
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden
              className={resetSpinning ? 'anet-reset-spin' : undefined}
              data-topo-chrome-reset-icon
              data-topo-chrome-reset-icon-stroke-width={hoveredReset && !resetSpinning ? '2.8' : '2.5'}
              // R350: hover-rotate preview of the R184 click-spin.
              // Gated on !resetSpinning so the anet-reset-spin keyframe
              // owns transform during its 450ms run. transformOrigin
              // 'center' so rotation pivots around the icon's centre
              // (default would be top-left and the icon would arc).
              style={{
                transform: hoveredReset && !resetSpinning ? 'rotate(-8deg)' : 'rotate(0deg)',
                transformOrigin: 'center',
                transition: 'transform 200ms ease-out, stroke-width 200ms ease-out',
              }}
              data-topo-chrome-reset-icon-hover={hoveredReset && !resetSpinning ? 'true' : 'false'}
            >
              <path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
          {/* Round 178 / Loop: fullscreen chrome button picks up the
              active-state visual indicator R163 introduced for the
              Ring/Grid layout toggle. Pre-R178 the button changed
              icon when isFullscreen flipped but its background +
              foreground stayed unchanged — operators in fullscreen
              didn't get a strong 'you're in fullscreen' cue. Adding
              the bg-cyan-500/15 + text-cyan-300 active variant
              mirrors R163's pattern; hover variants tier 1
              brighter (cyan-500/20) when active so the chip
              continues to respond to mouse. Inline style now omits
              background + color when active so the Tailwind cyan
              classes win specificity. */}
          <button
            onClick={() => { popChrome('fullscreen'); toggleFullscreen(); }}
            data-topo-chrome-fullscreen
            data-topo-chrome-fullscreen-active={isFullscreen ? 'true' : 'false'}
            data-topo-chrome-fullscreen-popping={chromePopping === 'fullscreen' ? 'true' : 'false'}
            // R196: fullscreen also picks up press-state — active variant
            // deepens cyan-500/20 → cyan-500/25 on press; non-active
            // deepens white/5 → white/10.
            // R249: chrome-pop on click — same one-vocabulary click signal
            // as layout toggle and zoom buttons.
            /* Round 270 / Loop: fullscreen INACTIVE picks up the cyan
               hover-preview pattern from the Layout toggle. The
               fullscreen button is a TOGGLE (enter/exit fullscreen) so
               its inactive state benefits from the same "hover previews
               active state" idiom R163 designed. Sibling treatment to
               the nodeSize buttons at line ~6711. */
            // R353: `group` lets the inner svg respond via group-hover —
            // sibling to R352 zoom buttons. Closes the chrome-strip per-
            // icon hover-affordance arc (zoom-out / zoom-in / reset /
            // fullscreen now all carry an icon-level hover gesture in
            // addition to the bg hover).
            // R400: hover translateY(-1px) lift — see reset button above for family doc.
            // R493 — fullscreen joins active:scale-95 press family (same as
            // reset above: lift-and-compress compound transform on press).
            className={`group p-1.5 rounded-md border hover:-translate-y-px active:scale-95 transition-colors transition-transform duration-200 ease-out transform-gpu focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400/60 ${
              isFullscreen
                ? 'bg-cyan-500/15 text-cyan-300 font-medium hover:bg-cyan-500/20 active:bg-cyan-500/25'
                : 'hover:bg-cyan-500/5 active:bg-cyan-500/15'
            }${chromePopping === 'fullscreen' ? ' anet-chrome-pop' : ''}`}
            data-topo-chrome-fullscreen-hover-lift="true"
            style={{
              borderColor: pal.containerBorder,
              ...(isFullscreen
                ? {}
                : { background: pal.legendBox.fill, color: pal.legendText }),
            }}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {/* R288 / Loop: fullscreen enter + exit icons strokeWidth
                2 → 2.5 — same chrome-icon weight unification described
                at the reset icon above. data-topo-chrome-fullscreen-
                icon attribute exposes BOTH variants (entered / exited)
                for the round's stroke-width regression probe. */}
            {/* Round 353 / Loop: fullscreen icon (both enter + exit
                variants) picks up the R352 family group-hover:scale-110.
                Pre-R353 hovering the button only changed the bg; the
                icon stayed still. R353 lifts the icon 10 % on hover —
                same gesture vocabulary as the zoom buttons. transform-
                gpu hint promotes the svg to its own compositor layer
                for crisper edges during the scale tween. Closes the
                chrome-strip per-icon hover-affordance arc. */}
            {/* R455 — fullscreen ENTER + EXIT icons pick up the same
                group-hover:[stroke-width:2.8] family lift as the
                zoom +/− icons (R454) and chrome reset icon (R453).
                Chrome icon hover sw lift family now 6 anchors —
                R208/R443 runtime badge + R453/R454-zoom-out/zoom-in
                + R455 fullscreen (this round). transition-[transform,
                stroke-width] expands existing transition-transform
                so the sw lift eases under R352 scale-110 cadence. */}
            {isFullscreen ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-[transform,stroke-width] duration-200 ease-out group-hover:scale-110 group-hover:[stroke-width:2.8] transform-gpu" data-topo-chrome-fullscreen-icon="exit">
                <path d="M8 3v4a1 1 0 0 1-1 1H3M21 8h-4a1 1 0 0 1-1-1V3M3 16h4a1 1 0 0 1 1 1v4M16 21v-4a1 1 0 0 1 1-1h4" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-[transform,stroke-width] duration-200 ease-out group-hover:scale-110 group-hover:[stroke-width:2.8] transform-gpu" data-topo-chrome-fullscreen-icon="enter">
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
