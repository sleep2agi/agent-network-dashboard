'use client';

import { useEffect, useState } from 'react';

/** Issue #119 — server-side panel listing the hub's hosts + CPU/RAM bars.
 *
 * Round 5 ships the UI with mock data; the real data path lands when:
 *   1. agent-node attaches a `host` payload to `report_status` (SDK马)
 *   2. CommHub exposes `GET /api/servers` aggregating it (通信牛)
 *   3. dashboard swaps the mock for a SWR fetch — the contract below
 *      matches the issue spec, so step 3 is a one-line change.
 *
 * Collapsed by default to a thin vertical icon strip so it never competes
 * with the topology graph for horizontal real-estate. State persists to
 * localStorage just like the other dashboard drawers.
 */

interface ServerCard {
  hostname: string;
  ip?: string | null;
  cpu_load_1min: number | null;
  cpu_cores: number;
  mem_used_gb: number | null;
  mem_total_gb: number | null;
  agent_count: number;
  status: 'online' | 'offline';
  note?: string;
}

// Mock seed — kept close to the #119 ASCII mock so Vincent / the team can
// eyeball the layout against the spec. Swap to a SWR fetch when the endpoint
// is live; the shape is identical, so the only code change is the source.
const MOCK_SERVERS: ServerCard[] = [
  {
    hostname: 'iZrj93pr', ip: '127.0.0.1', cpu_load_1min: 3.05, cpu_cores: 8,
    mem_used_gb: 10.4, mem_total_gb: 61.4, agent_count: 30, status: 'online', note: '本机',
  },
  {
    hostname: 'iZ0jlc8', cpu_load_1min: 0.5, cpu_cores: 4,
    mem_used_gb: 1.2, mem_total_gb: 8, agent_count: 1, status: 'online',
  },
  {
    hostname: 'elaine-Sys', cpu_load_1min: null, cpu_cores: 0,
    mem_used_gb: null, mem_total_gb: null, agent_count: 2, status: 'offline',
  },
];

// Bar tint by usage — green ≤60%, amber 60–85%, red >85%. Keeps the eye
// going to whichever box is actually about to tip over.
function barTint(pct: number) {
  if (pct >= 85) return { fill: '#ef4444', track: 'rgb(239 68 68 / 0.16)' };
  if (pct >= 60) return { fill: '#f59e0b', track: 'rgb(245 158 11 / 0.16)' };
  return { fill: '#10b981', track: 'rgb(16 185 129 / 0.16)' };
}

function Bar({ pct, label }: { pct: number; label: string }) {
  const t = barTint(pct);
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px] text-[var(--fg-muted)] font-mono">
        <span>{label}</span>
        <span className="tabular-nums">{Math.round(clamped)}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: t.track }}>
        <div
          className="h-full transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%`, background: t.fill }}
        />
      </div>
    </div>
  );
}

export function ServersDrawer() {
  const [open, setOpen] = useState(false);
  // Drawer state is per-user-machine — persist like the other dashboard
  // sticky toggles (`anet-topo-layout`, `anet-topo-view`, etc.).
  useEffect(() => {
    try { if (localStorage.getItem('anet-servers-drawer') === '1') setOpen(true); } catch {}
  }, []);
  const toggle = () => setOpen(prev => {
    const next = !prev;
    try { localStorage.setItem('anet-servers-drawer', next ? '1' : '0'); } catch {}
    return next;
  });

  const servers = MOCK_SERVERS; // TODO(#119 step 3): useSWR('/api/hub/servers')
  const onlineCount = servers.filter(s => s.status === 'online').length;

  return (
    <aside
      className="fixed right-0 top-20 z-40 hidden lg:flex flex-col rounded-l-xl border border-r-0 shadow-xl shadow-black/30 anet-fade-in"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        width: open ? 296 : 40,
        maxHeight: 'calc(100vh - 6rem)',
        transition: 'width 200ms ease-out',
      }}
      aria-label="Servers panel"
    >
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse servers panel' : 'Expand servers panel'}
        className="flex items-center gap-2 px-2.5 py-2 border-b text-[11px] font-semibold tracking-wide select-none"
        style={{ color: 'var(--fg)', borderColor: 'var(--border)' }}
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="6" rx="1.5" />
          <rect x="3" y="14" width="18" height="6" rx="1.5" />
          <circle cx="7" cy="7" r="0.7" fill="currentColor" />
          <circle cx="7" cy="17" r="0.7" fill="currentColor" />
        </svg>
        {open && (
          <>
            <span className="flex-1 text-left">Servers</span>
            <span className="text-[10px] text-[var(--fg-muted)] font-mono">{onlineCount}/{servers.length}</span>
          </>
        )}
      </button>

      {open && (
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2">
          {servers.map(s => {
            const offline = s.status === 'offline';
            const cpuPct = s.cpu_load_1min != null && s.cpu_cores > 0 ? (s.cpu_load_1min / s.cpu_cores) * 100 : null;
            const memPct = s.mem_used_gb != null && s.mem_total_gb != null && s.mem_total_gb > 0 ? (s.mem_used_gb / s.mem_total_gb) * 100 : null;
            return (
              <div
                key={s.hostname}
                className="rounded-lg border px-2.5 py-2 space-y-1.5"
                style={{
                  background: 'var(--bg)',
                  borderColor: 'var(--border)',
                  opacity: offline ? 0.55 : 1,
                }}
                title={s.ip ? `${s.hostname} · ${s.ip}` : s.hostname}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 flex items-baseline gap-1.5">
                    <span className="font-mono text-[12px] font-semibold truncate" style={{ color: 'var(--fg)' }}>{s.hostname}</span>
                    {s.note && <span className="text-[9px] text-[var(--fg-dim)]">({s.note})</span>}
                  </div>
                  <span className="text-[10px] text-[var(--fg-muted)] font-mono tabular-nums shrink-0">
                    {s.agent_count}&nbsp;agent{s.agent_count === 1 ? '' : 's'}
                  </span>
                </div>
                {!offline && cpuPct != null && (
                  <Bar pct={cpuPct} label={`CPU ${s.cpu_load_1min!.toFixed(2)}/${s.cpu_cores}`} />
                )}
                {!offline && memPct != null && (
                  <Bar pct={memPct} label={`RAM ${s.mem_used_gb!.toFixed(1)}/${s.mem_total_gb!.toFixed(1)}G`} />
                )}
                {offline && (
                  <div className="text-[10px] text-[var(--fg-dim)] font-mono italic">CPU n/a · RAM n/a · offline</div>
                )}
              </div>
            );
          })}
          <div className="pt-1 text-[9px] text-[var(--fg-dim)] font-mono text-center">
            mock data · live when <span className="text-[var(--fg-muted)]">/api/servers</span> ships
          </div>
        </div>
      )}
    </aside>
  );
}
