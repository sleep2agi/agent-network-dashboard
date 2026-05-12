'use client';

import { FormEvent, useState } from 'react';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <main className="min-h-screen bg-[#0a0a1a] text-gray-100 font-mono flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-cyan-500/5 blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] rounded-full bg-blue-500/5 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 mb-4">
            <svg className="w-8 h-8 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Agent Network</h1>
          <p className="text-sm text-gray-500 mt-1">Dashboard</p>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-[#2a2a4a] bg-[#111128] p-1 mb-4">
          {(['login', 'register'] as const).map(m => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(''); }}
              className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${mode === m ? 'bg-cyan-500/10 text-cyan-300' : 'text-gray-500 hover:text-gray-200'}`}>
              {m === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="border border-[#2a2a4a] bg-[#111128]/80 backdrop-blur-sm rounded-xl p-6 shadow-2xl shadow-black/30">
          <label htmlFor="username" className="block text-xs text-gray-500 mb-2 uppercase tracking-wider">
            Username
          </label>
          <input id="username" type="text" value={username} onChange={e => setUsername(e.target.value)} autoFocus
            placeholder="Enter username"
            className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 focus:outline-none transition-all mb-4" />

          <label htmlFor="password" className="block text-xs text-gray-500 mb-2 uppercase tracking-wider">
            Password
          </label>
          <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Enter password"
            className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 focus:outline-none transition-all" />

          {error && (
            <div className="mt-3 text-sm text-red-300 bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">{error}</div>
          )}

          <button type="submit" disabled={pending || !password}
            className="mt-5 w-full px-4 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-600 text-white text-sm font-medium rounded-lg transition-all shadow-lg shadow-cyan-500/10 hover:shadow-cyan-500/20 disabled:shadow-none">
            {pending ? (mode === 'login' ? 'Signing in...' : 'Registering...') : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <p className="text-center text-xs text-gray-700 mt-6">Powered by Sleep2AGI</p>
      </div>
    </main>
  );
}
