'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAnetConfig, useHealth } from '../lib/hooks';
import { applyTheme } from '../components/ThemeSwitcher';
import { DASHBOARD_VERSION } from '../lib/version';
import { clearPrivateChatStorage } from '../lib/chat-outbox';

export default function SettingsPage() {
  const { config } = useAnetConfig();
  const { health, error: healthError } = useHealth();
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window === 'undefined') return 'cyber';
    try { return localStorage.getItem('anet-theme') || 'cyber'; } catch { return 'cyber'; }
  });
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdResult, setPwdResult] = useState('');
  const cardClass = 'rounded-[10px] bg-[var(--bg-secondary)] p-4 shadow-[var(--ds-shadow-card)]';
  const headingClass = 'mb-1 text-[15px] font-semibold text-[var(--fg)]';
  const rowClass = 'flex min-h-11 flex-col justify-center gap-0.5 border-t border-[var(--border)] py-2 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4';
  const labelClass = 'shrink-0 text-[13px] font-medium text-[var(--fg-muted)]';
  const valueClass = 'min-w-0 break-all text-sm text-[var(--fg)] sm:max-w-[60%] sm:text-right';

  return (
    <div className="anet-page min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="anet-page-inner max-w-2xl">
      <h1 className="mb-2 text-[22px] font-semibold text-[var(--fg)]">Settings</h1>
      <p className="mb-6 text-[13px] leading-6 text-[var(--fg-muted)]">外观、连接和账号。主题会记在这台浏览器里。</p>

      {/* Section anchor nav (round 28) — jump to a group instead of scrolling
          through the whole page. Mirrors the section headers below; pages
          with 7+ cards benefit from a visible table-of-contents.
          R3 of #190 mobile polish: matches the /admin chip treatment
          (preview.3) — 44px tap-target + visible border so the chips read
          as tappable rather than as inert headings on 375–390px. */}
      {/* #209 R36: mb-8 → mb-4 sm:mb-8 — same pattern R31 applied to
          /admin's identical jump-nav. Saves 16 px on phones. */}
      <nav className="mb-6 flex flex-wrap gap-2">
        {[
          { href: '#appearance', label: 'Appearance' },
          { href: '#connection', label: 'Connection' },
          { href: '#account',    label: 'Account' },
          { href: '#resources',  label: 'Resources' },
        ].map(a => (
          <a key={a.href} href={a.href}
            className="inline-flex h-8 items-center rounded-[10px] bg-[var(--bg-elevated)] px-3 text-[13px] font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]">
            {a.label}
          </a>
        ))}
      </nav>

      <div className="max-w-2xl space-y-10">
        {/* ── Group: Appearance (#217 S6 — Vincent: "设置里面再来一个
            优化白色的主题"). The light theme tokens were restored from
            pre-R8 history; this card is the visible owner of the toggle
            (previously theme switching hid inside Cmd+K only). */}
        <div id="appearance" className="space-y-3 scroll-mt-6">
          <div className="px-1 text-[13px] font-medium text-[var(--fg-muted)]">Appearance</div>
          <section className={cardClass}>
            <h2 className={headingClass}>Theme</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                { id: 'cyber', label: 'Dark', swatch: '#0e0e11' },
                { id: 'light', label: 'Light', swatch: '#f3f4f6' },
                { id: 'slack', label: 'Slack', swatch: '#3f0e40' },
              ] as const).map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    try { localStorage.setItem('anet-theme', t.id); } catch {}
                    applyTheme(t.id);
                    setTheme(t.id);
                  }}
                  aria-pressed={theme === t.id}
                  className={`flex h-11 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors ${
                    theme === t.id
                      ? 'bg-[var(--accent-tonal)] font-medium text-[var(--accent)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] hover:text-[var(--fg)]'
                  }`}
                >
                  <span
                    aria-hidden
                    className="inline-block h-5 w-5 shrink-0 rounded-full border border-[var(--border)]"
                    style={{ backgroundColor: t.swatch }}
                  />
                  {t.label}
                  {theme === t.id && (
                    <svg aria-hidden className="ml-auto h-4 w-4 text-[var(--accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* ── Group: Connection ─────────────────────────────────── */}
        <div id="connection" className="space-y-3 scroll-mt-6">
          <div className="px-1 text-[13px] font-medium text-[var(--fg-muted)]">Connection</div>

        <section className={cardClass}>
          <h2 className={headingClass}>CommHub Connection</h2>
          <div className="text-sm">
            <div className={rowClass}>
              <span className={labelClass}>Hub URL</span>
              <span className={valueClass}>{config?.hub || 'not configured'}</span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Config Source</span>
              <span className={valueClass}>
                {config?.source === 'file' ? 'Local file (~/.anet/config.json)' : config?.source === 'runtime-env' ? 'Vercel env vars' : 'Missing'}
              </span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Auth Token</span>
              <span className={`${config?.tokenConfigured ? 'text-[var(--success)]' : 'text-[var(--error)]'} ${valueClass}`}>
                {config?.tokenConfigured ? `Configured (${config.tokenPreview})` : 'Not configured'}
              </span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Server Auth</span>
              <span className={`${health?.auth === 'enabled' ? 'text-[var(--success)]' : 'text-[var(--warn)]'} sm:text-right`}>
                {health?.auth || '--'}
              </span>
            </div>
            {config?.error && (
              <div className="border-t border-[var(--border)] pt-3 text-xs text-[var(--fg-dim)]">
                {config.error}
              </div>
            )}
            {(healthError || health?.ok === false) && (
              <div className="space-y-1.5 border-t border-[var(--border)] pt-3 text-xs" role="alert">
                <div className="font-medium text-[var(--error)]">CommHub unreachable — how to recover:</div>
                <div className="text-[var(--fg-muted)]">1. Check the hub process on the server: <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[var(--fg)]">anet hub status</code></div>
                <div className="text-[var(--fg-muted)]">2. Start it if stopped: <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[var(--fg)]">anet hub start</code></div>
                <div className="text-[var(--fg-muted)]">3. Confirm the Hub URL above matches where the hub actually listens.</div>
              </div>
            )}
          </div>
        </section>

        <section className={cardClass}>
          <h2 className={headingClass}>Server Info</h2>
          <div className="text-sm">
            <div className={rowClass}>
              <span className={labelClass}>Version</span>
              <span className={valueClass}>{health?.version || '--'}</span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Sessions</span>
              <span className={valueClass}>{health?.sessions ?? '--'}</span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>SSE streams <span className="text-[var(--fg-dim)]">· server</span></span>
              <span className={valueClass}>{health?.sse_connections ?? '--'}</span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Uptime</span>
              <span className={valueClass}>{health?.uptime ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : '--'}</span>
            </div>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className={headingClass}>Dashboard</h2>
          <div className="text-sm">
            <div className={rowClass}>
              <span className={labelClass}>Version</span>
              <span className={`font-mono ${valueClass}`} title="From package.json @sleep2agi/agent-network-dashboard">
                {DASHBOARD_VERSION}
              </span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Data Layer</span>
              <span className={valueClass}>SWR (5s refresh, 3s dedup)</span>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>Pages</span>
              <span className={valueClass}>Overview, Tasks, Nodes, Messages, Networks, Audit, Server Logs, Admin, Settings</span>
            </div>
          </div>
        </section>
        </div>

        {/* ── Group: Account ────────────────────────────────────── */}
        <div id="account" className="space-y-3 scroll-mt-6">
          <div className="px-1 text-[13px] font-medium text-[var(--fg-muted)]">Account</div>

        <section className={cardClass}>
          <h2 className={headingClass}>Change Password</h2>
          <div className="mt-3 space-y-3">
            <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Current password"
              className="w-full rounded-[10px] bg-[var(--bg-elevated)] px-3 py-2 text-base text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] sm:text-sm" />
            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password"
              className="w-full rounded-[10px] bg-[var(--bg-elevated)] px-3 py-2 text-base text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] sm:text-sm" />
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
              className="h-8 rounded-[10px] bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-50">
              Change Password
            </button>
          </div>
          {pwdResult && <div className={`mt-2 text-xs ${pwdResult.startsWith('Failed') ? 'text-[var(--error)]' : 'text-[var(--success)]'}`}>{pwdResult}</div>}
        </section>

        <section className={cardClass}>
          <h2 className={headingClass}>Sign out</h2>
          <p className="mb-3 text-xs text-[var(--fg-dim)]">Signing out clears your dashboard session cookie. You&apos;ll return to the login page.</p>
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
              clearPrivateChatStorage();
              sessionStorage.removeItem('anet_v3_auth');
              window.location.assign('/login');
            }}
            className="h-8 rounded-[10px] bg-[var(--bg-elevated)] px-4 text-[13px] font-medium text-[var(--fg)] transition-colors hover:text-[var(--fg)]"
          >
            Sign out
          </button>
        </section>
        </div>

        {/* ── Group: Resources ──────────────────────────────────── */}
        <div id="resources" className="space-y-3 scroll-mt-6">
          <div className="px-1 text-[13px] font-medium text-[var(--fg-muted)]">Resources</div>

        <section className={cardClass}>
          <ul>
            {([
              { href: '/settings/tokens', title: 'API Tokens', detail: 'Create and manage tokens for CLI access.' },
              { href: '/settings/networks', title: 'Networks', detail: 'Create, manage, and delete agent networks.' },
              { href: '/settings/providers', title: 'Model Providers', detail: 'Configure providers and per-server reachability.' },
              { href: '/messages', title: 'Messages', detail: 'Global timeline of CommHub messages.' },
              { href: '/logs', title: 'Audit Log', detail: 'Authentication, token rotations, and admin actions.' },
              { href: '/server-logs', title: 'Server Logs', detail: 'Live stdout / stderr from the CommHub server.' },
            ] as const).map((item) => (
              <li key={item.href} className="border-t border-[var(--border)] first:border-t-0">
                <Link href={item.href} className="flex h-11 min-w-0 items-center gap-3 hover:bg-[var(--bg-elevated)]">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--fg)]">{item.title}</span>
                  <span className="hidden min-w-0 max-w-[46%] truncate text-xs text-[var(--fg-dim)] sm:block">{item.detail}</span>
                  <span aria-hidden className="shrink-0 text-xs text-[var(--fg-dim)]">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        </div>

      </div>
      </div>
    </div>
  );
}
