'use client';

import { ServersPanel } from '../components/ServersDrawer';

export default function ServersPage() {
  return (
    <main className="min-h-screen bg-[#0a0a1a] px-4 py-5 text-gray-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-2xl border border-[#2a2a4a] bg-[#111128] p-5 shadow-lg shadow-black/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">Infrastructure</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">Servers</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                Host-level health, disk, memory, CPU history, and agent rollups from CommHub telemetry.
              </p>
            </div>
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs font-mono text-cyan-200">
              live · refreshes every 5s
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-[#2a2a4a] bg-[#111128] p-3 shadow-lg shadow-black/20">
          <ServersPanel className="max-h-none overflow-visible" />
        </section>
      </div>
    </main>
  );
}
