'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { useNetworkId } from '../lib/network-context';

const networkFetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : { networks: [] });

// Cleanup (issue #4): sidebar collapsed to the 6 core destinations. The
// low-frequency / unverified entries (Messages, Networks, Audit Log,
// Server Logs) were removed from primary nav — those pages still exist
// and stay reachable via direct URL and the command palette (⌘K); they
// were just cluttering the main rail. Restore here if usage warrants.
const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/tasks', label: 'Tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { href: '/nodes', label: 'Nodes', icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01' },
  { href: '/servers', label: 'Servers', icon: 'M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v1A2.5 2.5 0 0117.5 10h-11A2.5 2.5 0 014 7.5v-1zM4 16.5A2.5 2.5 0 016.5 14h11a2.5 2.5 0 012.5 2.5v1a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5v-1zM7 7h.01M7 17h.01' },
  { href: '/admin', label: 'Admin', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { href: '/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

interface SidebarNetwork {
  network_id: string;
  network_name: string;
  role?: string;
  /** Round 107: live agent count, derived from /api/status sessions. */
  agentCount?: number;
}

const ROLE_ICON: Record<string, string> = { owner: '⭐', admin: '🔧', member: '👤', viewer: '👁' };

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { networkId, setNetworkId } = useNetworkId();
  const { data: netData } = useSWR<{ networks: SidebarNetwork[] }>('/api/hub/networks', networkFetcher, { refreshInterval: 15000, dedupingInterval: 10000 });
  // Round 107 (issue #92): /api/networks can be scope-limited (a hub owner's
  // token may only list "default" even when agents live in other networks).
  // The unfiltered /api/status response carries every visible session with
  // its network_id, so derive networks from there and merge them in — the
  // admin can then switch to any network that actually has agents.
  const { data: statusData } = useSWR<StatusData>(
    '/api/hub/status', statusFetcher, { refreshInterval: 15000, dedupingInterval: 10000 },
  );
  const apiNetworks = netData?.networks || [];
  const networks: SidebarNetwork[] = (() => {
    const agentCount = new Map<string, number>();
    for (const s of statusData?.sessions || []) {
      if (s.network_id) agentCount.set(s.network_id, (agentCount.get(s.network_id) || 0) + 1);
    }
    const known = new Set(apiNetworks.map(n => n.network_id));
    const derived: SidebarNetwork[] = [...agentCount.keys()]
      .filter(id => !known.has(id))
      .map(id => ({ network_id: id, network_name: id }));
    return [...apiNetworks, ...derived].map(n => ({ ...n, agentCount: agentCount.get(n.network_id) || 0 }));
  })();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === '/settings') return pathname === '/settings';
    return pathname.startsWith(href);
  };

  const nav = (
    <nav className="flex flex-col gap-1 px-2 py-4">
      {NAV_ITEMS.map(item => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          onClick={() => setMobileOpen(false)}
          title={collapsed ? item.label : undefined}
          className={`relative flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors active:bg-[#232327] ${
            isActive(item.href)
              ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 anet-nav-active'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#1c1c1f]'
          } ${collapsed ? 'justify-center px-0' : ''}`}
        >
          <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
          </svg>
          {!collapsed && <span>{item.label}</span>}
        </Link>
      ))}
    </nav>
  );

  return (
    <>
      {/* Mobile hamburger — R13 of #190: was p-2.5 = ~40px tap target,
          just below the iOS 44px guideline. Bump padding and add an
          explicit min-w/min-h so it can never be miss-tapped. */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-3 left-3 z-50 lg:hidden bg-[#161618] border border-[#26262b] rounded-lg p-3 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-white active:bg-[#232327]"
        aria-label="Toggle menu"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {mobileOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
      </button>

      {/* Mobile overlay — round 47: fades in via anet-fade-in (150ms ease-out)
          matching the TaskDrawer / TaskChatPanel backdrop. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden anet-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — `bg-[#111113]` resolves to var(--bg) in dark themes,
          but in light/mint we want a distinct surface, so we layer
          `lg:bg-white` / `lg:dark:bg-[#111113]` via the theme attribute.
          The CSS shim in globals.css upgrades sidebar bg to bg-secondary
          in light themes so the sidebar reads as its own card.
          Round 47: explicit ease-out curve + slight shadow so the drawer
          edge "leaves a trail" as it slides in. */}
      <aside data-anet-sidebar="true" className={`
        fixed top-0 left-0 h-full z-40 bg-[#111113] border-r border-[#26262b]
        transition-transform duration-200 ease-out
        ${collapsed ? 'w-16' : 'w-52'}
        ${mobileOpen ? 'translate-x-0 shadow-2xl shadow-black/40 lg:shadow-none' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:shrink-0 lg:shadow-none
      `}>
        {/* Brand header — round 4: 3-node mesh mark matches /login,
            with an inline live "online" pulse so every page surfaces
            fleet health without leaving for /nodes. */}
        <SidebarBrand collapsed={collapsed} />
        <div className={`border-b border-[#26262b]`} />

        {/* Network list */}
        {!collapsed && networks.length > 0 && (
          <div className="px-2 py-3 border-b border-[#26262b]">
            <div className="px-3 text-[10px] text-gray-600 uppercase mb-2">Networks</div>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {networks.map((n: SidebarNetwork) => (
                <button
                  key={n.network_id}
                  onClick={() => { setNetworkId(n.network_id); setMobileOpen(false); }}
                  title={n.network_id}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 lg:py-1.5 rounded-md text-xs transition-colors text-left ${
                    networkId === n.network_id
                      ? 'bg-cyan-500/10 text-cyan-300'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-[#1c1c1f]'
                  }`}
                >
                  <span>{ROLE_ICON[n.role || 'member'] || '👤'}</span>
                  <span className="truncate flex-1">{n.network_name}</span>
                  {/* Round 107 (issue #92): show live agent count so an
                      admin can spot which network actually has agents —
                      the whole point of the bug was a network with 30
                      agents being invisible. */}
                  {n.agentCount ? (
                    <span className="shrink-0 tabular-nums text-[10px] text-gray-600">{n.agentCount}</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* #209 R26 (Vincent msg 540 screenshot — "设置页面没展示全"): the
            absolute-bottom footer below stacks 3 rows (Quick search /
            Sign out / collapse) ≈ 92-100px tall, but this spacer was
            pb-20 (80px), so the last nav entry (Settings on /settings)
            was being eaten by the footer overlay. Bump to pb-28 (112px)
            to clear the actual footer height. */}
        <div className="pb-28">
          {nav}
        </div>

        {/* Sign out + collapse — round 27: collapsed-state gets icon-only
            variants so users still have Sign out / Quick search access at
            56px width, plus title= tooltips. */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-[#26262b] bg-[#111113]">
          <button
            onClick={() => {
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true }));
            }}
            title={collapsed ? 'Quick search (⌘K)' : undefined}
            className={`w-full flex items-center text-[11px] text-gray-600 hover:text-gray-400 hover:bg-[#1c1c1f] transition-colors ${
              collapsed ? 'justify-center px-0 py-2.5' : 'justify-between gap-2 px-5 py-3 lg:py-2'
            }`}
            aria-label="Open command palette"
          >
            <span className={`flex items-center ${collapsed ? '' : 'gap-2'}`}>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {!collapsed && 'Quick search'}
            </span>
            {!collapsed && <kbd className="text-[10px] border border-current rounded px-1 py-0.5 opacity-60 font-mono">⌘K</kbd>}
          </button>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
              sessionStorage.removeItem('anet_v3_auth');
              window.location.assign('/login');
            }}
            title={collapsed ? 'Sign out' : undefined}
            className={`w-full flex items-center text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/5 transition-colors ${
              collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-5 py-3'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {!collapsed && 'Sign out'}
          </button>
          <div className={`flex items-center ${collapsed ? 'flex-col px-0 py-2' : 'px-3 py-2 justify-end'}`}>
            <button
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:flex p-1.5 rounded text-gray-600 hover:text-gray-400 transition-colors"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

interface StatusData {
  sessions?: Array<{ status?: string; alias?: string; network_id?: string }>;
}

const statusFetcher = (url: string) =>
  fetch(url).then(r => r.ok ? r.json() as Promise<StatusData> : { sessions: [] });

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  // Live online count — re-uses the same /api/hub/status endpoint the
  // Overview already polls, so SWR dedupes the request. Pulse is muted —
  // emerald dot at 4px with a 1.6s slow opacity pulse, no glow, no halo.
  const { data } = useSWR<StatusData>('/api/hub/status', statusFetcher, {
    refreshInterval: 10000,
    dedupingInterval: 4000,
  });
  const sessions = data?.sessions || [];
  const online = sessions.filter(s => s.status && s.status !== 'offline').length;
  const total = sessions.length;

  if (collapsed) {
    return (
      <Link href="/" className="block px-3 py-4 flex justify-center hover:opacity-80 transition-opacity" aria-label="Agent Network — home">
        <BrandMark size={32} />
      </Link>
    );
  }

  return (
    <Link
      href="/"
      className="block px-4 py-4 flex items-center gap-3 hover:bg-[#161618]/40 transition-colors rounded-r-xl"
      aria-label="Agent Network — home"
    >
      <BrandMark size={32} />
      <div className="min-w-0">
        <div className="text-white text-[13px] font-semibold leading-tight">Agent Network</div>
        <div className="text-[10px] text-gray-500 flex items-center gap-1.5 mt-0.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${online > 0 ? 'bg-emerald-400 anet-brand-pulse' : 'bg-gray-600'}`}
            aria-hidden
          />
          {total === 0 ? (
            <span>waiting for agents</span>
          ) : (
            <span><span className="text-gray-300 font-medium tabular-nums">{online}</span><span className="text-gray-600">/{total}</span> online</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** 3-node mesh mark — same SVG as /login, reusable. */
function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.2" className="text-cyan-400" />
      <line x1="16" y1="10" x2="10" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.45" className="text-cyan-400" />
      <line x1="16" y1="10" x2="22" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.45" className="text-cyan-400" />
      <line x1="10" y1="20" x2="22" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.45" className="text-cyan-400" />
      <circle cx="16" cy="10" r="2.5" fill="currentColor" className="text-cyan-400" />
      <circle cx="10" cy="20" r="2.5" fill="currentColor" className="text-green-400" />
      <circle cx="22" cy="20" r="2.5" fill="currentColor" className="text-violet-400" />
    </svg>
  );
}
