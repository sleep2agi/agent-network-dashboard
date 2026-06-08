'use client';

import { ServersPanel } from '../components/ServersDrawer';

export default function ServersPage() {
  return (
    <main className="min-h-screen bg-[#0a0a1a] px-4 py-5 text-gray-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* #209 R37: header card compressed for mobile. Original layout
            stacked 4 things vertically on phones (INFRASTRUCTURE eyebrow,
            big h1, 3-line description, full-width "live" chip) eating
            ~50% of the iPhone viewport before any server card appeared.
            New shape:
              row 1: h1 "Servers" + tiny live chip (inline on every width)
              row 2: optional desc line, single-truncate on mobile so it
                     fits without wrapping; full text via title= on hover.
              eyebrow: kept but inlined with h1 as small uppercase prefix
                       (sm: up) — drops out on phones for density.
            p-5 → p-4 sm:p-5 also tightens the inner padding.
            Zero feature removed; the eyebrow + desc still render where
            there is room. */}
        <header className="rounded-2xl border border-[#2a2a4a] bg-[#111128] p-4 sm:p-5 shadow-lg shadow-black/20">
          <div className="flex items-center justify-between gap-3 lg:ml-0 ml-10">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="hidden sm:inline text-[11px] uppercase tracking-[0.18em] text-cyan-300/70 shrink-0">
                Infrastructure
              </span>
              <span className="hidden sm:inline text-gray-700">·</span>
              <h1 className="text-xl sm:text-2xl font-semibold text-white truncate">Servers</h1>
            </div>
            <div className="shrink-0 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-mono text-cyan-200 inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="hidden sm:inline">live · refreshes every 5s</span>
              <span className="sm:hidden">live</span>
            </div>
          </div>
          <p
            className="mt-2 max-w-2xl text-xs sm:text-sm leading-snug sm:leading-6 text-gray-400 truncate sm:whitespace-normal lg:ml-0 ml-10"
            title="Host-level health, disk, memory, CPU history, and agent rollups from CommHub telemetry."
          >
            Host-level health, disk, memory, CPU history, and agent rollups from CommHub telemetry.
          </p>
        </header>

        <section className="rounded-2xl border border-[#2a2a4a] bg-[#111128] p-3 shadow-lg shadow-black/20">
          <ServersPanel className="max-h-none overflow-visible" />
        </section>
      </div>
    </main>
  );
}
