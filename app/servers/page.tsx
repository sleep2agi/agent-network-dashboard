'use client';

import { DaemonFleetPanel } from '../components/DaemonFleetPanel';
import { PageHeader } from '../components/requirement-chrome';
import { ServersPanel } from '../components/ServersDrawer';

export default function ServersPage() {
  return (
    <main className="anet-page min-h-screen bg-[var(--bg)] text-[var(--fg)]">
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
        <PageHeader
          title="Servers"
          description="Host-level health, disk, memory, CPU history, and agent rollups from CommHub telemetry."
          actions={
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-[var(--fg-dim)]">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              <span className="hidden sm:inline">live · refreshes every 5s</span>
              <span className="sm:hidden">live</span>
            </span>
          }
        />

        <section className="rounded-[10px] bg-[var(--bg-secondary)] p-3 shadow-[var(--ds-shadow-card)]">
          <ServersPanel className="max-h-none overflow-visible" />
        </section>
        <DaemonFleetPanel />
      </div>
    </main>
  );
}
