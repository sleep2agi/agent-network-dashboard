'use client';

import { FormEvent, useState } from 'react';
import { DASHBOARD_VERSION } from '../lib/version';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');

    try {
      const res = await fetch('/api/auth/v3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode, username, password }),
      });
      const data = await res.json();

      if (data.ok) {
        // Store V3 auth data for client-side features
        if (data.token) {
          sessionStorage.setItem('anet_v3_auth', JSON.stringify({
            user: data.user,
            token: data.token,
            networks: data.networks || [],
            currentNetwork: data.network_id || data.networks?.[0]?.network_id || '',
          }));
        }
        window.location.assign('/');
        return;
      }

      setError(data.error || 'Login failed');
    } catch {
      setError('Connection failed');
    }
    setPending(false);
  };

  const fieldClass = 'h-11 w-full rounded-[10px] bg-[var(--col-inset)] px-3 text-sm text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:shadow-[var(--focus-ring)] focus:outline-none';

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bg)] px-4 py-12 text-[var(--fg)]">
      <div className="anet-login-bg pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="anet-login-mark mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[14px] bg-[var(--bg-secondary)] text-[var(--accent)] shadow-[var(--ds-shadow-card)]">
            <svg className="h-8 w-8" viewBox="0 0 32 32" aria-hidden>
              <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.28" />
              <line x1="16" y1="10" x2="10" y2="20" stroke="currentColor" strokeWidth="1.25" opacity="0.7" />
              <line x1="16" y1="10" x2="22" y2="20" stroke="currentColor" strokeWidth="1.25" opacity="0.7" />
              <line x1="10" y1="20" x2="22" y2="20" stroke="currentColor" strokeWidth="1.25" opacity="0.7" />
              <circle cx="16" cy="10" r="2.4" fill="currentColor" />
              <circle cx="10" cy="20" r="2.4" fill="var(--success)" />
              <circle cx="22" cy="20" r="2.4" fill="currentColor" opacity="0.55" />
            </svg>
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight">Agent Network</h1>
          <p className="mx-auto mt-2 max-w-[18rem] text-[14px] leading-6 text-[var(--fg-muted)]">
            {mode === 'login'
              ? 'One dashboard for agents, tasks, and messages.'
              : 'Create an account and start from the fleet overview.'}
          </p>
        </div>

        <div className="mb-3 flex h-10 rounded-[10px] bg-[var(--bg-secondary)] p-1 shadow-[var(--ds-shadow-card)]" role="tablist" aria-label="Account mode">
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 rounded-md text-[13px] font-medium ${mode === m ? 'bg-[var(--accent-tonal)] text-[var(--accent)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg)]'}`}
            >
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="rounded-[14px] bg-[var(--bg-secondary)] p-6 shadow-[var(--ds-shadow-card)]">
          <label htmlFor="username" className="mb-2 block text-[13px] font-medium text-[var(--fg-muted)]">
            Username
          </label>
          <input id="username" type="text" value={username} onChange={e => setUsername(e.target.value)} autoFocus
            placeholder="Enter username"
            className={`${fieldClass} mb-4`} />

          <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-[var(--fg-muted)]">
            Password
          </label>
          <div className="relative">
            <input id="password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              className={`${fieldClass} pr-11`} />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex min-w-[44px] items-center justify-center px-3 text-[var(--fg-dim)] hover:text-[var(--fg)]"
            >
              {showPassword ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-3 rounded-[10px] px-3 py-2 text-sm text-[var(--danger)]" style={{ background: 'color-mix(in srgb, var(--danger) 12%, transparent)' }}>{error}</div>
          )}

          <button type="submit" disabled={pending || !password || !username.trim()}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] text-sm font-medium text-[var(--accent-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--bg-elevated)] disabled:text-[var(--fg-dim)] disabled:hover:brightness-100">
            {pending && (
              <svg aria-hidden className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            <span>{pending ? (mode === 'login' ? 'Signing in…' : 'Registering…') : (mode === 'login' ? 'Sign in' : 'Create account')}</span>
          </button>
        </form>

        <p className="mt-6 text-center text-[12px] leading-5 text-[var(--fg-dim)]">
          Sleep2AGI · Apache-2.0 · <a href="https://anet.sh" className="hover:text-[var(--fg)]">anet.sh</a>
          <span className="mx-1">·</span>
          <span className="font-mono" title="@sleep2agi/agent-network-dashboard">v{DASHBOARD_VERSION}</span>
        </p>
      </div>
    </main>
  );
}
