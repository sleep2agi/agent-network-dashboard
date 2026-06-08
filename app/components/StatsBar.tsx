'use client';

interface StatsBarProps {
  online: number;
  working: number;
  total: number;
  version: string;
  uptime: string;
}

export function StatsBar({ online, working, total, version, uptime }: StatsBarProps) {
  const onlinePercent = total > 0 ? Math.round((online / total) * 100) : 0;
  const fleetEmpty = total === 0;

  // #209 R29 (mobile vertical rhythm — goal "大幅提升移动端体验"):
  // populated branch previously left mb-8 (32 px) below the 4-card grid,
  // the single biggest gap on the Overview page. Drop to mb-4 (16 px)
  // on phones, restore mb-8 from sm: up. Pairs with R28's section-gap
  // tighten — together they reclaim ~48 px of pure scroll waste before
  // the agent grid. The empty-fleet branch already used mb-4 since R72,
  // so this only touches the populated case.
  return (
    <div className={fleetEmpty ? 'mb-4' : 'mb-4 sm:mb-8'}>
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">Agent Network</h1>
        <span className="text-xs text-gray-500">
          CommHub {version} &middot; {uptime}
        </span>
      </div>

      {fleetEmpty ? (
        /* Round 72: thin status strip replaces the 4-card grid when fleet
           is empty. Saves ~280px on mobile (CTA y=650 → ~370) and keeps
           the same data visible in a single inline row. */
        <div className="anet-stat-strip flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-500 border-t border-b border-[#2a2a4a] py-2">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
            <span className="text-gray-300 tabular-nums">0</span> online
          </span>
          <span className="text-gray-700">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
            <span className="text-gray-300 tabular-nums">0</span> working
          </span>
          <span className="text-gray-700">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-gray-600" />
            <span className="text-gray-300 tabular-nums">0</span> registered
          </span>
        </div>
      ) : (
        /* Populated state — full 4-card grid as before */
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            value={online}
            label="Online"
            sub={`${onlinePercent}% of fleet`}
            color="text-green-400"
            accent="from-green-500/20 to-green-500/0"
            border="border-green-500/15"
          />
          <StatCard
            value={working}
            label="Working"
            sub={online > 0 ? `${Math.round((working / online) * 100)}% utilization` : '--'}
            color="text-cyan-400"
            accent="from-cyan-500/20 to-cyan-500/0"
            border="border-cyan-500/15"
          />
          <StatCard
            value={total - online}
            label="Offline"
            sub={total - online === 0 ? 'All systems go' : `${total - online} disconnected`}
            color="text-gray-400"
            accent="from-gray-500/10 to-gray-500/0"
            border="border-gray-500/15"
          />
          <StatCard
            value={total}
            label="Total"
            sub="Registered nodes"
            color="text-white"
            accent="from-blue-500/15 to-blue-500/0"
            border="border-blue-500/15"
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label, sub, color, accent, border }: {
  value: number; label: string; sub: string; color: string; accent: string; border: string;
}) {
  // Extract the color family (green/cyan/gray/blue/white) from `color` prop
  // so the light-theme top-strip CSS can pick the right accent.
  const accentKey = color.replace('text-', '').split('-')[0];
  return (
    <div
      data-anet-stat-card={accentKey}
      className={`anet-stat-card relative overflow-hidden rounded-xl border ${border} bg-[#111128] px-4 py-3 transition-all`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${accent} pointer-events-none`} />
      <div className="relative">
        <div className={`text-3xl font-bold ${color} tabular-nums leading-tight`}>{value}</div>
        <div className="text-sm text-gray-300 mt-0.5">{label}</div>
        <div className="text-xs text-gray-600 mt-1">{sub}</div>
      </div>
    </div>
  );
}
