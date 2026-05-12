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

function polarPoint(index: number, total: number, radius: number) {
  const spread = total <= 2 ? Math.PI : Math.PI * 1.78;
  const start = -Math.PI / 2 - spread / 2;
  const angle = total <= 1 ? -Math.PI / 2 : start + (spread * index) / (total - 1);
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

function nodeStatus(session: Session, isOnline: boolean) {
  if (!isOnline) {
    return {
      label: 'offline',
      primary: '#6b7280',
      halo: '#111827',
      text: '#9ca3af',
    };
  }

  if (session.status === 'working') {
    return {
      label: 'working',
      primary: '#22c55e',
      halo: '#14532d',
      text: '#dcfce7',
    };
  }

  if (session.status === 'idle') {
    return {
      label: 'idle',
      primary: '#2dd4bf',
      halo: '#134e4a',
      text: '#ccfbf1',
    };
  }

  return {
    label: session.status || 'online',
    primary: '#38bdf8',
    halo: '#0c4a6e',
    text: '#e0f2fe',
  };
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

    offline.forEach((s, index) => {
      positions[s.alias] = polarPoint(index, Math.max(offline.length, 1), offlineRadius);
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

      <div className="relative overflow-hidden rounded-lg border border-[#2a2a4a] bg-[#080814] shadow-2xl shadow-cyan-950/30">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />

        <svg viewBox="0 0 1000 680" className="w-full h-auto block" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="topo-panel" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#0b1220" />
              <stop offset="48%" stopColor="#080814" />
              <stop offset="100%" stopColor="#101018" />
            </linearGradient>
            <radialGradient id="topo-radar" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.18" />
              <stop offset="45%" stopColor="#22c55e" stopOpacity="0.045" />
              <stop offset="100%" stopColor="#020617" stopOpacity="0" />
            </radialGradient>
            <filter id="topo-glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker id="topo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#67e8f9" />
            </marker>
          </defs>

          <rect width="1000" height="680" fill="url(#topo-panel)" />
          <circle cx={cx} cy={cy} r="330" fill="url(#topo-radar)" />

          {/* radar rings */}
          {[90, 170, 250, 330].map(radius => (
            <circle key={radius} cx={cx} cy={cy} r={radius} fill="none" stroke="#164e63" strokeWidth="1" opacity="0.35" />
          ))}
          {[0, 30, 60, 90, 120, 150].map(angle => (
            <line
              key={angle}
              x1={cx - 360 * Math.cos(angle * Math.PI / 180)}
              y1={cy - 360 * Math.sin(angle * Math.PI / 180)}
              x2={cx + 360 * Math.cos(angle * Math.PI / 180)}
              y2={cy + 360 * Math.sin(angle * Math.PI / 180)}
              stroke="#164e63"
              strokeWidth="1"
              opacity="0.18"
            />
          ))}

          {/* hub links */}
          {onlineNodes.map(session => {
            const pos = nodePositions[session.alias];
            if (!pos) return null;
            const path = curvePath({ x: cx, y: cy }, pos, 0);

            return (
              <path
                key={`hub-${session.alias}`}
                d={path}
                fill="none"
                stroke={activeAliases.has(session.alias) ? '#22d3ee' : '#155e75'}
                strokeWidth={activeAliases.has(session.alias) ? 2 : 1}
                strokeDasharray={activeAliases.has(session.alias) ? 'none' : '8 10'}
                opacity={activeAliases.has(session.alias) ? 0.65 : 0.35}
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
                  stroke="#67e8f9"
                  strokeWidth={width}
                  opacity="0.28"
                  filter="url(#topo-glow)"
                  markerEnd="url(#topo-arrow)"
                />
                <path
                  id={`flow-path-${index}`}
                  d={path}
                  fill="none"
                  stroke="#e0f2fe"
                  strokeWidth="1"
                  strokeDasharray="2 12"
                  opacity="0.75"
                />
                <circle r="4" fill="#fef08a" filter="url(#topo-glow)">
                  <animateMotion dur={`${duration}s`} repeatCount="indefinite" path={path} />
                </circle>
              </g>
            );
          })}

          {/* center hub — 24px pulse signal source.
              Previous design (56px filled circle + 42px animated ring +
              `+` glyph + "DASHBOARD" / "command relay" labels) over-emphasized
              the hub and competed with the agent nodes for visual weight.
              The new design is a calm 12px emerald source with two outward
              pulse rings — reads as "signal origin" without a placeholder
              logo or label. Closes agent-network#5. */}
          <g>
            {/* outer pulse 1 */}
            <circle cx={cx} cy={cy} r="6" fill="none" stroke="#10b981" strokeWidth="1.5">
              <animate attributeName="r" values="6;28;6" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0;0.55" dur="2.4s" repeatCount="indefinite" />
            </circle>
            {/* outer pulse 2 (delayed 1.2s) */}
            <circle cx={cx} cy={cy} r="6" fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0">
              <animate attributeName="r" values="6;28;6" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.45;0;0.45" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
            </circle>
            {/* core dot — 12px diameter (r=6), emerald with inner highlight */}
            <circle cx={cx} cy={cy} r="6" fill="#10b981" />
            <circle cx={cx} cy={cy} r="3" fill="#d1fae5" opacity="0.9" />
          </g>

          {/* agent nodes */}
          {[...onlineNodes, ...offlineNodes].map(session => {
            const pos = nodePositions[session.alias];
            if (!pos) return null;

            const sseCountFor = (session.network_id ? sseSessions[`${session.network_id}:${session.alias}`] : undefined) ?? sseSessions[session.alias];
            const isOnline = session.status !== 'offline' || !!sseCountFor;
            const status = nodeStatus(session, isOnline);
            const isActive = activeAliases.has(session.alias);
            const radius = isOnline ? 26 : 18;

            return (
              <g key={session.alias} className="transition-opacity">
                {isActive && (
                  <circle cx={pos.x} cy={pos.y} r={radius + 14} fill={status.primary} opacity="0.12">
                    <animate attributeName="r" values={`${radius + 8};${radius + 22};${radius + 8}`} dur="2.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.18;0.04;0.18" dur="2.4s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={pos.x} cy={pos.y} r={radius + 8} fill={status.halo} opacity={isOnline ? 0.55 : 0.25} />
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={radius}
                  fill={isOnline ? '#020617' : '#080814'}
                  stroke={status.primary}
                  strokeWidth={isOnline ? 3 : 1.5}
                  strokeDasharray={isOnline ? 'none' : '5 5'}
                  filter={isOnline ? 'url(#topo-glow)' : undefined}
                />
                <circle cx={pos.x} cy={pos.y} r={isOnline ? 8 : 5} fill={status.primary} />
                {session.status === 'working' && (
                  <path d={`M${pos.x - 9},${pos.y + 11} h18`} stroke="#fef08a" strokeWidth="3" strokeLinecap="round">
                    <animate attributeName="opacity" values="1;0.25;1" dur="1.1s" repeatCount="indefinite" />
                  </path>
                )}

                <g transform={`translate(${pos.x}, ${pos.y + radius + 22})`}>
                  <rect x="-62" y="-14" width="124" height="42" rx="6" fill="#020617" stroke="#1f2937" opacity="0.94" />
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
            <rect x="0" y="0" width="285" height={60 + Math.min(flowLinks.length, 4) * 20} rx="8" fill="#020617" stroke="#1f2937" opacity="0.94" />
            <text x="16" y="26" fill="#e5e7eb" fontSize="13" fontFamily="monospace" fontWeight="700">recent signal</text>
            <text x="178" y="26" fill="#67e8f9" fontSize="11" fontFamily="monospace">{messages.length} messages</text>
            {flowLinks.slice(0, 4).map((link, index) => (
              <text key={link.key} x="16" y={54 + index * 20} fill="#94a3b8" fontSize="10" fontFamily="monospace">
                {truncate(link.from, 8)} {'->'} {truncate(link.to, 8)} / {link.count} / {truncate(link.content, 18)}
              </text>
            ))}
          </g>

          {/* legend */}
          <g transform="translate(720, 34)">
            <rect x="0" y="0" width="250" height="112" rx="8" fill="#020617" stroke="#1f2937" opacity="0.94" />
            <circle cx="18" cy="26" r="6" fill="#22c55e" />
            <text x="34" y="30" fill="#94a3b8" fontSize="11" fontFamily="monospace">working node</text>
            <circle cx="18" cy="52" r="6" fill="#2dd4bf" />
            <text x="34" y="56" fill="#94a3b8" fontSize="11" fontFamily="monospace">online idle</text>
            <circle cx="18" cy="78" r="6" fill="#6b7280" />
            <text x="34" y="82" fill="#94a3b8" fontSize="11" fontFamily="monospace">offline / no SSE</text>
            <path d="M150,78 Q176,52 210,78" fill="none" stroke="#67e8f9" strokeWidth="3" markerEnd="url(#topo-arrow)" />
          </g>
        </svg>
      </div>
    </section>
  );
}
