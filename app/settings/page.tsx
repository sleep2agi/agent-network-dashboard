'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAnetConfig, useHealth } from '../lib/hooks';
import { DASHBOARD_VERSION } from '../lib/version';

export default function SettingsPage() {
  const { config } = useAnetConfig();
  const { health } = useHealth();
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdResult, setPwdResult] = useState('');
  const rowClass = 'flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between';
  const valueClass = 'break-all sm:max-w-[320px] sm:text-right';

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <h1 className="text-2xl font-bold text-white mb-3 lg:ml-0 ml-10">Settings</h1>

      {/* Section anchor nav (round 28) — jump to a group instead of scrolling
          through the whole page. Mirrors the section headers below; pages
          with 7+ cards benefit from a visible table-of-contents.
          R3 of #190 mobile polish: matches the /admin chip treatment
          (preview.3) — 44px tap-target + visible border so the chips read
          as tappable rather than as inert headings on 375–390px. */}
      <nav className="mb-8 flex flex-wrap gap-2 text-xs">
        {[
          { href: '#connection', label: 'Connection' },
          { href: '#account',    label: 'Account' },
          { href: '#resources',  label: 'Resources' },
        ].map(a => (
          <a key={a.href} href={a.href}
            className="inline-flex min-h-[44px] items-center rounded-md border border-[#2a2a4a] bg-[#0a0a15]/60 px-3 py-2 text-gray-400 hover:border-cyan-500/50 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors">
            {a.label}
          </a>
        ))}
      </nav>

      <div className="max-w-2xl space-y-10">
        {/* ── Group: Connection ─────────────────────────────────── */}
        <div id="connection" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2 px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400 font-semibold">Connection</div>
            <div className="flex-1 h-px bg-[#2a2a4a]" />
          </div>

        {/* CommHub Connection */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">CommHub Connection</h2>
          <div className="space-y-3 text-sm">
            <div className={rowClass}>
              <span className="text-gray-500 shrink-0">Hub URL</span>
              <span className={`text-cyan-300 ${valueClass}`}>{config?.hub || 'not configured'}</span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Config Source</span>
              <span className={`text-gray-300 ${valueClass}`}>
                {config?.source === 'file' ? 'Local file (~/.anet/config.json)' : config?.source === 'runtime-env' ? 'Vercel env vars' : 'Missing'}
              </span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Auth Token</span>
              <span className={`${config?.tokenConfigured ? 'text-green-400' : 'text-red-400'} ${valueClass}`}>
                {config?.tokenConfigured ? `Configured (${config.tokenPreview})` : 'Not configured'}
              </span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Server Auth</span>
              <span className={`${health?.auth === 'enabled' ? 'text-green-400' : 'text-yellow-400'} sm:text-right`}>
                {health?.auth || '--'}
              </span>
            </div>
            {config?.error && (
              <div className="border-t border-[#2a2a4a] pt-3 text-xs text-gray-600">
                {config.error}
              </div>
            )}
          </div>
        </section>

        {/* Server Info */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Server Info</h2>
          <div className="space-y-3 text-sm">
            <div className={rowClass}>
              <span className="text-gray-500">Version</span>
              <span className={`text-gray-300 ${valueClass}`}>{health?.version || '--'}</span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Sessions</span>
              <span className={`text-gray-300 ${valueClass}`}>{health?.sessions ?? '--'}</span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">SSE streams <span className="text-gray-600">· server</span></span>
              <span className={`text-gray-300 ${valueClass}`}>{health?.sse_connections ?? '--'}</span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Uptime</span>
              <span className={`text-gray-300 ${valueClass}`}>{health?.uptime ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : '--'}</span>
            </div>
          </div>
        </section>

        {/* Dashboard Info */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Dashboard</h2>
          <div className="space-y-3 text-sm">
            <div className={rowClass}>
              <span className="text-gray-500">Version</span>
              <span className={`text-gray-300 font-mono ${valueClass}`} title="From package.json @sleep2agi/agent-network-dashboard">
                {DASHBOARD_VERSION}
              </span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Data Layer</span>
              <span className={`text-gray-300 ${valueClass}`}>SWR (5s refresh, 3s dedup)</span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Pages</span>
              <span className={`text-gray-300 ${valueClass}`}>Overview, Tasks, Nodes, Messages, Networks, Audit, Server Logs, Admin, Settings</span>
            </div>
          </div>
        </section>
        </div>

        {/* ── Group: Account ────────────────────────────────────── */}
        <div id="account" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2 px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400 font-semibold">Account</div>
            <div className="flex-1 h-px bg-[#2a2a4a]" />
          </div>

        {/* Change Password */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Change Password</h2>
          <div className="space-y-3">
            <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Current password"
              className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-base sm:text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password"
              className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-base sm:text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
            <button onClick={async () => {
              if (!oldPwd || !newPwd) return;
              const saved = sessionStorage.getItem('anet_v3_auth');
              if (!saved) { setPwdResult('Not logged in with V3 auth'); return; }
              const { token } = JSON.parse(saved);
              const res = await fetch('/api/hub/auth', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'change_password', token, current_password: oldPwd, new_password: newPwd }),
              });
              const data = await res.json();
              setPwdResult(data.ok ? 'Password changed' : `Failed: ${data.error}`);
              if (data.ok) {
                if (data.token) {
                  const auth = JSON.parse(saved);
                  sessionStorage.setItem('anet_v3_auth', JSON.stringify({ ...auth, token: data.token }));
                }
                setOldPwd('');
                setNewPwd('');
              }
              setTimeout(() => setPwdResult(''), 5000);
            }} disabled={!oldPwd || !newPwd}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm rounded-lg transition-colors">
              Change Password
            </button>
          </div>
          {pwdResult && <div className={`mt-2 text-xs ${pwdResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{pwdResult}</div>}
        </section>

        {/* Session — tone-neutral, no longer "danger zone" red */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Sign out</h2>
          <p className="text-xs text-gray-500 mb-3">Signing out clears your dashboard session cookie. You'll return to the login page.</p>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
              window.location.assign('/login');
            }}
            className="px-4 py-2 bg-transparent hover:bg-[#1a1a2a] text-gray-300 text-sm rounded-lg border border-[#2a2a4a] hover:border-[#3a3a5a] transition-colors"
          >
            Sign out
          </button>
        </section>
        </div>

        {/* ── Group: Resources ──────────────────────────────────── */}
        <div id="resources" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2 px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400 font-semibold">Resources</div>
            <div className="flex-1 h-px bg-[#2a2a4a]" />
          </div>

        {/* #209 (per Vincent 521/522): the low-frequency pages 通信龙
            moved out of the sidebar (Messages, Audit Log, Server Logs)
            need a discovery surface that isn't the primary nav — folded
            into the Settings/Resources grid alongside Tokens + Networks
            so the page tree stays the same (pages NOT deleted), the
            sidebar stays at 6, and users still have a one-tap way to
            reach them without remembering URLs or opening Cmd+K. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link href="/settings/tokens" className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5 hover:border-cyan-500/30 transition-colors">
            <h2 className="text-sm font-semibold text-gray-300">API Tokens</h2>
            <p className="text-xs text-gray-500 mt-2">Create and manage tokens for CLI access.</p>
            <span className="text-xs text-cyan-400 mt-3 inline-block">Manage &rarr;</span>
          </Link>
          <Link href="/settings/networks" className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5 hover:border-cyan-500/30 transition-colors">
            <h2 className="text-sm font-semibold text-gray-300">Networks</h2>
            <p className="text-xs text-gray-500 mt-2">Create, manage, and delete agent networks.</p>
            <span className="text-xs text-cyan-400 mt-3 inline-block">Manage &rarr;</span>
          </Link>
          <Link href="/messages" className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5 hover:border-cyan-500/30 transition-colors">
            <h2 className="text-sm font-semibold text-gray-300">Messages</h2>
            <p className="text-xs text-gray-500 mt-2">Global timeline of CommHub messages across all agents.</p>
            <span className="text-xs text-cyan-400 mt-3 inline-block">Open &rarr;</span>
          </Link>
          <Link href="/logs" className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5 hover:border-cyan-500/30 transition-colors">
            <h2 className="text-sm font-semibold text-gray-300">Audit Log</h2>
            <p className="text-xs text-gray-500 mt-2">Authentication, token rotations, and admin actions.</p>
            <span className="text-xs text-cyan-400 mt-3 inline-block">Open &rarr;</span>
          </Link>
          <Link href="/server-logs" className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5 hover:border-cyan-500/30 transition-colors">
            <h2 className="text-sm font-semibold text-gray-300">Server Logs</h2>
            <p className="text-xs text-gray-500 mt-2">Live stdout / stderr from the CommHub server.</p>
            <span className="text-xs text-cyan-400 mt-3 inline-block">Open &rarr;</span>
          </Link>
        </div>
        </div>

      </div>
    </div>
  );
}
