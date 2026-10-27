'use client';

/**
 * TopoGraph3D — 军团拓扑的**等距平台**版本（2D 的 TopoGraph.tsx 保留不动）。
 *
 * 为什么是等距而不是真 3D：
 *   参考图的价值是「一眼数清有几支军团、谁在动」。等距投影能同时给出结构与人数，
 *   而自由旋转的 3D 会让人丢方向感。所以这里用 SVG 手工投影，不引 three.js
 *   （体积从 736 KB → 约 70 KB，文字永远清晰）。
 *
 * 几何与分组逻辑在 `app/lib/topology-3d.ts`（纯函数，有单测）：
 *   布局按 label 字典序排，不按人数——dashboard 每 15s 刷新，按人数排会让整张图跳。
 *
 * 颜色规则（两套色不混用）：
 *   面 = 编队色（区分军团）   环 = 状态色（区分死活）
 */

import { useEffect, useMemo, useState } from 'react';
import type { Session } from './types';
import { computeUnits, initialOf, iso, planGrid } from '../lib/topology-3d';

/** 编队色（深色底上用作描边/标签；面用同色 10% 填充） */
const PALETTE: string[] = [
  '#3fae7d', '#5b8dfa', '#e573a8', '#3fb3a6',
  '#7b7bf0', '#a978f2', '#e09a3c', '#4f9bc4',
  '#8ba845', '#d46a9c', '#6d879c', '#9aa1ad',
];

const STATUS_RING: Record<string, string> = {
  working: '#22c55e',
  idle: '#9aa1ad',
  offline: '#c9ced8',
  error: '#ef4444',
  blocked: '#f59e0b',
  unknown: '#b8bec9',
};
const STATUS_CN: Record<string, string> = {
  working: '在动', idle: '在停', offline: '出列', error: '故障', blocked: '阻塞', unknown: '未知',
};

interface Props {
  sessions: Session[];
  perRow?: number;
  maxPerUnit?: number;
}

/** 系统级"减少动态效果"偏好：呼吸动画必须可关（前庭敏感用户） */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

export function TopoGraph3D({ sessions, perRow = 5, maxPerUnit = 20 }: Props) {
  const [selected, setSelected] = useState<Session | null>(null);
  const reducedMotion = useReducedMotion();

  const layout = useMemo(() => {
    const units = computeUnits(sessions);
    const COLS = 4, STEP = 330, ORIGIN = { x: 800, y: 360 };
    const W = 250, D = 190;

    const bound = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    const grow = (p: { x: number; y: number }, pad = 0) => {
      bound.x1 = Math.min(bound.x1, p.x - pad); bound.y1 = Math.min(bound.y1, p.y - pad);
      bound.x2 = Math.max(bound.x2, p.x + pad); bound.y2 = Math.max(bound.y2, p.y + pad);
    };

    const platforms = units.map((u, idx) => {
      const col = idx % COLS, row = Math.floor(idx / COLS);
      const gx = ORIGIN.x + (col - (COLS - 1) / 2) * STEP;
      const gy = ORIGIN.y + row * 300;
      const quad = [
        iso(gx - W / 2, gy - D / 2), iso(gx + W / 2, gy - D / 2),
        iso(gx + W / 2, gy + D / 2), iso(gx - W / 2, gy + D / 2),
      ];
      quad.forEach((q) => grow(q, 10));
      const center = iso(gx, gy);

      const plan = planGrid(u.members.length, perRow, maxPerUnit);
      const dots = u.members.slice(0, plan.shown).map((s, i) => {
        const p = iso(
          gx - W / 2 + 40 + (i % perRow) * 34,
          gy - D / 2 + 38 + Math.floor(i / perRow) * 32,
        );
        grow(p, 18);
        return { s, p };
      });
      const labelPos = iso(gx, gy + D / 2 + 26);
      grow(labelPos, 24);

      return { unit: u, quad, center, dots, extra: plan.extra, labelPos, color: PALETTE[u.colorIndex % PALETTE.length] };
    });

    const hubX = (bound.x1 + bound.x2) / 2;
    const hubY = bound.y1 - 155;
    grow({ x: hubX - 130, y: hubY - 130 }); grow({ x: hubX + 130, y: hubY + 70 });

    const pad = 90;
    let vx = bound.x1 - pad, vy = bound.y1 - pad;
    let vw = bound.x2 - bound.x1 + pad * 2, vh = bound.y2 - bound.y1 + pad * 2;
    const ratio = 1600 / 980;
    if (vw / vh > ratio) { const h2 = vw / ratio; vy -= (h2 - vh) / 2; vh = h2; }
    else { const w2 = vh * ratio; vx -= (w2 - vw) / 2; vw = w2; }

    return { units, platforms, hub: { x: hubX, y: hubY }, viewBox: `${vx.toFixed(0)} ${vy.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}` };
  }, [sessions, perRow, maxPerUnit]);

  const working = sessions.filter((s) => s.status === 'working').length;
  const online = sessions.filter((s) => s.status !== 'offline').length;

  if (sessions.length === 0) {
    return (
      <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-1 bg-[var(--bg)]">
        <div className="text-sm font-medium text-[var(--fg)]">还没有可展示的 Agent</div>
        <div className="text-xs text-[var(--fg-muted)]">连上 Hub 并启动节点后，这里会自动出现军团拓扑</div>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-56px)] w-full overflow-hidden bg-[var(--bg)]">
      <div className="pointer-events-none absolute left-8 top-6 z-10">
        <div className="text-[34px] font-semibold leading-none tracking-tight text-[var(--fg)]">
          {sessions.length}
          <span className="ml-1 text-sm font-medium text-[var(--fg-muted)]">个数字员工</span>
        </div>
        <div className="mt-1 text-xs text-[var(--fg-muted)]">
          1 人指挥 · 其中 <span className="font-semibold text-[var(--success)]">{working} 个在动</span> · {online} 个在线
        </div>
      </div>

      <div className="pointer-events-none absolute right-8 top-6 z-10 text-right">
        <div className="text-[34px] font-semibold leading-none tracking-tight text-[var(--fg)]">
          {layout.units.length}
          <span className="ml-1 text-sm font-medium text-[var(--fg-muted)]">个编队</span>
        </div>
        <div className="mt-1 text-xs text-[var(--fg-muted)]">面 = 编队 · 环 = 状态</div>
      </div>

      <svg viewBox={layout.viewBox} className="h-full w-full" role="img" aria-label="Agent 军团拓扑（等距平台）">
        <defs>
          <filter id="tg3d-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#000000" floodOpacity="0.45" />
          </filter>
          <linearGradient id="tg3d-hub" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2f6bf6" /><stop offset="100%" stopColor="#1a4fd6" />
          </linearGradient>
        </defs>

        {/* 中枢 → 编队 */}
        {layout.platforms.map((p) => {
          const mid = { x: (layout.hub.x + p.center.x) / 2, y: layout.hub.y + (p.center.y - layout.hub.y) * 0.45 };
          return (
            <g key={`l-${p.unit.key}`}>
              <path
                d={`M${layout.hub.x} ${layout.hub.y} Q${mid.x.toFixed(0)} ${mid.y.toFixed(0)} ${p.center.x.toFixed(0)} ${(p.center.y - 30).toFixed(0)}`}
                fill="none" stroke={p.color} strokeOpacity={0.38} strokeWidth={1.6}
              />
              <circle cx={p.center.x} cy={p.center.y - 30} r={3} fill={p.color} fillOpacity={0.8} />
            </g>
          );
        })}

        {/* 平台 */}
        {layout.platforms.map((p) => {
          const [, q1, q2, q3] = p.quad;
          const pts = p.quad.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
          return (
            <g key={`p-${p.unit.key}`}>
              <polygon points={`${q1.x},${q1.y} ${q2.x},${q2.y} ${q2.x},${q2.y + 10} ${q1.x},${q1.y + 10}`} fill={p.color} fillOpacity={0.16} />
              <polygon points={`${q2.x},${q2.y} ${q3.x},${q3.y} ${q3.x},${q3.y + 10} ${q2.x},${q2.y + 10}`} fill={p.color} fillOpacity={0.26} />
              <polygon points={pts} fill={p.color} fillOpacity={0.1} stroke={p.color} strokeOpacity={0.55} strokeWidth={1.2} filter="url(#tg3d-soft)" />
              {p.dots.map(({ s, p: pos }) => (
                <g key={`${s.alias}-${s.node_id ?? ''}`} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}>
                  <circle cx={pos.x} cy={pos.y} r={14} fill="var(--bg-elevated)" stroke={STATUS_RING[s.status] ?? '#b8bec9'} strokeWidth={2.5}>
                    {s.status === 'working' && !reducedMotion && (
                      <animate attributeName="opacity" values="0.55;1;0.55" dur="2.2s" repeatCount="indefinite" />
                    )}
                  </circle>
                  <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--fg)">
                    {initialOf(s.alias)}
                  </text>
                </g>
              ))}
              {p.extra > 0 && (
                <text x={q2.x - 24} y={q2.y + 6} textAnchor="middle" fontSize={12} fill="var(--fg-muted)">+{p.extra}</text>
              )}
              <rect
                x={p.labelPos.x - Math.max(48, p.unit.label.length * 15 + 14)}
                y={p.labelPos.y - 13}
                width={Math.max(96, p.unit.label.length * 15 + 28)}
                height={26} rx={13} fill={p.color}
              />
              <text x={p.labelPos.x} y={p.labelPos.y + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#ffffff">
                {p.unit.label} · {p.unit.members.length}
              </text>
            </g>
          );
        })}

        {/* 中枢 */}
        <g>
          <rect x={layout.hub.x - 100} y={layout.hub.y - 132} width={200} height={46} rx={23} fill="var(--bg-secondary)" stroke="var(--border)" />
          <text x={layout.hub.x} y={layout.hub.y - 104} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--fg)">一句话派活</text>
          <text x={layout.hub.x} y={layout.hub.y - 87} textAnchor="middle" fontSize={10.5} fill="var(--fg-muted)">下达目标 · 把关交付</text>
          <line x1={layout.hub.x} y1={layout.hub.y - 86} x2={layout.hub.x} y2={layout.hub.y - 60} stroke="var(--border)" strokeWidth={1.6} />
          <circle cx={layout.hub.x} cy={layout.hub.y} r={42} fill="url(#tg3d-hub)" filter="url(#tg3d-soft)" />
          <text x={layout.hub.x} y={layout.hub.y + 7} textAnchor="middle" fontSize={17} fontWeight={700} fill="#ffffff">ANet</text>
          <text x={layout.hub.x} y={layout.hub.y + 64} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--fg)">ANet 调度中枢</text>
        </g>
      </svg>

      {selected && (
        <div className="absolute bottom-6 right-8 w-[250px] rounded-[14px] border border-[var(--border)] bg-[var(--bg-secondary)] p-3 shadow-lg">
          <div className="mb-1 break-all font-semibold text-[var(--fg)]">{selected.alias}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
            <dt className="text-[var(--fg-muted)]">状态</dt>
            <dd style={{ color: STATUS_RING[selected.status] ?? 'var(--fg-muted)' }}>{STATUS_CN[selected.status] ?? '未知'}</dd>
            <dt className="text-[var(--fg-muted)]">运行时</dt>
            <dd className="break-all">{selected.runtime || selected.agent || '—'}</dd>
            <dt className="text-[var(--fg-muted)]">最后心跳</dt>
            <dd className="break-all">{selected.last_seen_at || selected.updated_at || '从未上线'}</dd>
          </dl>
          <button className="mt-2 text-xs text-[var(--fg-muted)] underline" onClick={() => setSelected(null)}>关闭</button>
        </div>
      )}
    </div>
  );
}
