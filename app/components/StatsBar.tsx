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

  return (
    <div className="mb-8">
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">Agent Network</h1>
        <span className="text-xs text-gray-500">
          CommHub {version} &middot; {uptime}
        </span>
      </div>

      {/* Stats grid */}
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
          sub={total === 0 ? '--' : total - online === 0 ? 'All systems go' : `${total - online} disconnected`}
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
