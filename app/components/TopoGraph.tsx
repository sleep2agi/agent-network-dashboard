'use client';

import { useEffect, useMemo, useState } from 'react';
import { Session } from './types';

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
const offlineRadius = 315;

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
  } = useMemo(() => {
    const sseCount = (s: { alias: string; network_id?: string }) =>
      (s.network_id ? sseSessions[`${s.network_id}:${s.alias}`] : undefined) ?? sseSessions[s.alias];
    const online = sessions.filter(s => s.status !== 'offline' || sseCount(s));
    const offline = sessions.filter(s => s.status === 'offline' && !sseCount(s));
    const positions: Record<string, Point> = {};

    online.forEach((s, index) => {
      positions[s.alias] = polarPoint(index, Math.max(online.length, 1), onlineRadius);
    });

    // Offset the offline ring radially by half the online step so offline
    // bubbles sit in the angular gaps between online bubbles instead of
    // stacking directly behind them. Also push the outer ring further when
    // there are many offline nodes so labels don't crowd the legend.
    const spread = online.length <= 2 ? Math.PI : Math.PI * 1.78;
    const onlineStep = online.length > 1 ? spread / (online.length - 1) : 0;
    const offlineRotation = online.length > 0 ? onlineStep / 2 : 0;
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

    return {
      onlineNodes: online,
      offlineNodes: offline,
      nodePositions: positions,
      flowLinks: links,
      activeAliases: active,
    };
  }, [messages, sessions, sseSessions]);

  const workingCount = onlineNodes.filter(s => s.status === 'working').length;

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
        className={`relative overflow-hidden rounded-lg border shadow-2xl ${isLight ? 'shadow-zinc-900/5' : 'shadow-cyan-950/30'}`}
        style={{ background: pal.containerBg, borderColor: pal.containerBorder }}
      >
        <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${pal.topRailGradient}`} />

        <svg viewBox="0 0 1000 680" className="w-full h-auto block" preserveAspectRatio="xMidYMid meet">
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

          <rect width="1000" height="680" fill="url(#topo-panel)" />
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

            return (
              <g key={session.alias} className="transition-opacity">
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
                <circle cx={pos.x} cy={pos.y} r={isOnline ? 8 : 5} fill={status.primary} />
                {session.status === 'working' && (
                  <path d={`M${pos.x - 9},${pos.y + 11} h18`} stroke={pal.flowParticle} strokeWidth="3" strokeLinecap="round">
                    <animate attributeName="opacity" values="1;0.25;1" dur="1.1s" repeatCount="indefinite" />
                  </path>
                )}

                <g transform={`translate(${pos.x}, ${pos.y + radius + 22})`}>
                  <rect x="-62" y="-14" width="124" height="42" rx="6" fill={pal.labelBox.fill} stroke={pal.labelBox.stroke} opacity={isLight ? 1 : 0.94} />
                  <text x="0" y="1" textAnchor="middle" fill={status.text} fontSize="12" fontFamily="monospace" fontWeight="700">
                    {truncate(session.alias, 14)}
                  </text>
                  <text x="0" y="17" textAnchor="middle" fill={status.primary} fontSize="9" fontFamily="monospace">
                    {status.label}{isOnline && sseCountFor != null ? ` sse:${sseCountFor}` : ''}
                  </text>
                </g>
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
        </svg>
      </div>
    </section>
  );
}
