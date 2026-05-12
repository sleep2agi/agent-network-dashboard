'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { useNetworkId } from '../lib/network-context';
import { ThemeSwitcher } from './ThemeSwitcher';

const networkFetcher = (url: string) => fetch(url).then(r => r.ok ? r.json() : { networks: [] });

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { href: '/tasks', label: 'Tasks', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { href: '/nodes', label: 'Nodes', icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01' },
  { href: '/messages', label: 'Messages', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { href: '/settings/networks', label: 'Networks', icon: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
  { href: '/logs', label: 'Audit Log', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/server-logs', label: 'Server Logs', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { href: '/admin', label: 'Admin', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { href: '/settings', label: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

interface SidebarNetwork {
  network_id: string;
  network_name: string;
  role?: string;
}

const ROLE_ICON: Record<string, string> = { owner: '⭐', admin: '🔧', member: '👤', viewer: '👁' };

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { networkId, setNetworkId } = useNetworkId();
  const { data: netData } = useSWR<{ networks: SidebarNetwork[] }>('/api/hub/networks', networkFetcher, { refreshInterval: 15000, dedupingInterval: 10000 });
  const networks = netData?.networks || [];

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
          className={`relative flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors active:bg-[#1a1a3a] ${
            isActive(item.href)
              ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 anet-nav-active'
              : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a2a]'
          } ${collapsed ? 'justify-center' : ''}`}
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
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-3 z-50 lg:hidden bg-[#111128] border border-[#2a2a4a] rounded-lg p-2.5 text-gray-400 hover:text-white active:bg-[#1a1a3a]"
        aria-label="Toggle menu"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {mobileOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — `bg-[#0d0d1a]` resolves to var(--bg) in dark themes,
          but in light/mint we want a distinct surface, so we layer
          `lg:bg-white` / `lg:dark:bg-[#0d0d1a]` via the theme attribute.
          The CSS shim in globals.css upgrades sidebar bg to bg-secondary
          in light themes so the sidebar reads as its own card. */}
      <aside data-anet-sidebar="true" className={`
        fixed top-0 left-0 h-full z-40 bg-[#0d0d1a] border-r border-[#2a2a4a]
        transition-all duration-200
        ${collapsed ? 'w-16' : 'w-52'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:shrink-0
      `}>
        {/* Logo */}
        <div className={`px-4 py-5 border-b border-[#2a2a4a] ${collapsed ? 'text-center' : ''}`}>
          {collapsed ? (
            <span className="text-cyan-400 font-bold text-lg">A</span>
          ) : (
            <div>
              <div className="text-white font-bold text-sm">Agent Network</div>
              <div className="text-gray-600 text-xs">Dashboard</div>
            </div>
          )}
        </div>

        {/* Network list */}
        {!collapsed && networks.length > 0 && (
          <div className="px-2 py-3 border-b border-[#2a2a4a]">
            <div className="px-3 text-[10px] text-gray-600 uppercase mb-2">Networks</div>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {networks.map((n: SidebarNetwork) => (
                <button
                  key={n.network_id}
                  onClick={() => { setNetworkId(n.network_id); setMobileOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors text-left ${
                    networkId === n.network_id
                      ? 'bg-cyan-500/10 text-cyan-300'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-[#1a1a2a]'
                  }`}
                >
                  <span>{ROLE_ICON[n.role || 'member'] || '👤'}</span>
                  <span className="truncate">{n.network_name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pb-20">
          {nav}
        </div>

        {/* Sign out + collapse */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-[#2a2a4a] bg-[#0d0d1a]">
          {!collapsed && (
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                sessionStorage.removeItem('anet_v3_auth');
                window.location.assign('/login');
              }}
              className="w-full flex items-center gap-3 px-5 py-3 text-xs text-gray-500 hover:text-red-400 hover:bg-red-500/5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              Sign out
            </button>
          )}
          <div className={`flex items-center gap-2 px-3 py-2 ${collapsed ? 'justify-center' : 'justify-between'}`}>
            <ThemeSwitcher compact={collapsed} />
            <button
              onClick={() => setCollapsed(!collapsed)}
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
