'use client';

import { ServersPanel } from '../components/ServersDrawer';

export default function ServersPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-5 text-[var(--fg)] sm:px-6 lg:px-8">
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
        <header className="rounded-2xl bg-[var(--bg-secondary)] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 lg:ml-0 ml-10">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="hidden shrink-0 text-[11px] uppercase tracking-[0.18em] text-[var(--fg-muted)] sm:inline">
                Infrastructure
              </span>
              <span className="hidden text-[var(--border-hover)] sm:inline">·</span>
              <h1 className="truncate text-xl font-semibold text-[var(--fg)]">Servers</h1>
            </div>
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 font-mono text-[11px] text-[var(--fg-muted)]">
              <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--success)]" />
              <span className="hidden sm:inline">live · refreshes every 5s</span>
              <span className="sm:hidden">live</span>
            </div>
          </div>
          <p
            className="mt-2 ml-10 max-w-2xl truncate text-xs leading-snug text-[var(--fg-muted)] sm:whitespace-normal sm:leading-6 lg:ml-0"
            title="Host-level health, disk, memory, CPU history, and agent rollups from CommHub telemetry."
          >
            Host-level health, disk, memory, CPU history, and agent rollups from CommHub telemetry.
          </p>
        </header>

        <section className="rounded-2xl bg-[var(--bg-secondary)] p-3">
          <ServersPanel className="max-h-none overflow-visible" />
        </section>
      </div>
    </main>
  );
}
