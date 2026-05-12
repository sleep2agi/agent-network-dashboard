'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAnetConfig, useHealth, useLicense } from '../lib/hooks';

export default function SettingsPage() {
  const { config } = useAnetConfig();
  const { health } = useHealth();
  const { license: licData } = useLicense();
  const [licKey, setLicKey] = useState('');
  const [licResult, setLicResult] = useState('');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdResult, setPwdResult] = useState('');
  const rowClass = 'flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between';
  const valueClass = 'break-all sm:max-w-[320px] sm:text-right';

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <h1 className="text-2xl font-bold text-white mb-6 lg:ml-0 ml-10">Settings</h1>

      <div className="max-w-2xl space-y-8">
        {/* ── Group: Connection ─────────────────────────────────── */}
        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-600 px-1">Connection</div>

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
              <span className="text-gray-500">SSE Connections</span>
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
              <span className={`text-gray-300 ${valueClass}`}>V2.1</span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Data Layer</span>
              <span className={`text-gray-300 ${valueClass}`}>SWR (5s refresh, 3s dedup)</span>
            </div>
            <div className={rowClass}>
              <span className="text-gray-500">Pages</span>
              <span className={`text-gray-300 ${valueClass}`}>Overview, Tasks, Nodes, Messages, Settings</span>
            </div>
          </div>
        </section>
        </div>

        {/* ── Group: Account ────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-600 px-1">Account</div>

        {/* License */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            License
            {licData?.license && (
              <span
                className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                  licData.license.type === 'pro'
                    ? 'text-green-300 bg-green-500/10 border-green-500/30'
                    : licData.license.days_left <= 7
                      ? 'text-red-300 bg-red-500/10 border-red-500/30'
                      : 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                }`}
              >
                <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current" />
                {licData.license.type}{licData.license.days_left ? ` · ${licData.license.days_left}d left` : ''}
              </span>
            )}
          </h2>
          {licData?.license ? (
            <div className="space-y-3 text-sm">
              <div className={rowClass}>
                <span className="text-gray-500">Type</span>
                <span className={`font-medium ${licData.license.type === 'pro' ? 'text-green-400' : 'text-yellow-400'}`}>
                  {licData.license.type}
                </span>
              </div>
              <div className={rowClass}>
                <span className="text-gray-500">Days Left</span>
                <span className={`${licData.license.days_left <= 7 ? 'text-red-400' : 'text-gray-300'}`}>
                  {licData.license.days_left} days
                  {licData.license.days_left <= 7 && ' — expiring soon!'}
                </span>
              </div>
              <div className={rowClass}>
                <span className="text-gray-500">Expires</span>
                <span className={`text-gray-300 ${valueClass}`}>{licData.license.expires_at}</span>
              </div>
              {licData.limits && (
                <>
                  <div className={rowClass}>
                    <span className="text-gray-500">Max Agents</span>
                    <span className={`text-gray-300 ${valueClass}`}>{licData.limits.max_agents}</span>
                  </div>
                  <div className={rowClass}>
                    <span className="text-gray-500">Max Networks</span>
                    <span className={`text-gray-300 ${valueClass}`}>{licData.limits.max_networks}</span>
                  </div>
                  <div className={rowClass}>
                    <span className="text-gray-500">Tasks/Day</span>
                    <span className={`text-gray-300 ${valueClass}`}>{licData.limits.max_tasks_day}</span>
                  </div>
                </>
              )}
              <div className="pt-3 border-t border-[#2a2a4a]">
                <div className="flex gap-2">
                  <input type="text" value={licKey} onChange={e => setLicKey(e.target.value)}
                    placeholder="anet-XXXX-XXXX-XXXX-XXXX"
                    className="flex-1 bg-[#0a0a15] border border-[#2a2a4a] rounded px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none" />
                  <button onClick={async () => {
                    if (!licKey.trim()) return;
                    const res = await fetch('/api/hub/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: licKey }) });
                    const data = await res.json();
                    setLicResult(data.ok ? `Activated: ${data.type}` : `Failed: ${data.error}`);
                    if (data.ok) setLicKey('');
                    setTimeout(() => setLicResult(''), 5000);
                  }} className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs rounded transition-colors">
                    Activate
                  </button>
                </div>
                {licResult && <div className={`mt-2 text-xs ${licResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{licResult}</div>}
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-600">License info not available</div>
          )}
        </section>

        {/* Change Password */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Change Password</h2>
          <div className="space-y-3">
            <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Current password"
              className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password"
              className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
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
        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-[0.12em] text-gray-600 px-1">Resources</div>

        {/* API Tokens + Networks */}
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
        </div>
        </div>

        {/* hidden — replaced by neutral Session card inside Account group above */}
        <section className="hidden bg-[#111128] border border-red-900/30 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-red-400 mb-4">Session (legacy)</h2>
          <p className="text-xs text-gray-500 mb-3">Sign out will clear your dashboard session cookie.</p>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
              window.location.assign('/login');
            }}
            className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-300 text-sm rounded-lg border border-red-800/30 transition-colors"
          >
            Sign out
          </button>
        </section>
      </div>
    </div>
  );
}
