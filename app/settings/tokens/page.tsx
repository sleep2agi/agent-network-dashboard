'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { timeAgo } from '../../components/utils';
import { EmptyState } from '../../components/EmptyState';

interface Token {
  token_id: string;
  name: string;
  scope: string;
  network_id: string;
  last_used_at: string;
  created_at: string;
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [createResult, setCreateResult] = useState<{ token?: string; error?: string }>({});

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/hub/tokens');
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  const createToken = async () => {
    if (!newName.trim()) return;
    try {
      const saved = sessionStorage.getItem('anet_v3_auth');
      if (!saved) return;
      const { token } = JSON.parse(saved);
      const res = await fetch('/api/hub/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_token', token, name: newName }),
      });
      const data = await res.json();
      if (data.ok) {
        setCreateResult({ token: data.token });
        setNewName('');
        fetchTokens();
      } else {
        setCreateResult({ error: data.error });
      }
    } catch { setCreateResult({ error: 'Failed' }); }
  };

  const revokeToken = async (tokenId: string) => {
    try {
      const saved = sessionStorage.getItem('anet_v3_auth');
      if (!saved) return;
      const { token } = JSON.parse(saved);
      await fetch('/api/hub/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke_token', token, token_id: tokenId }),
      });
      fetchTokens();
    } catch {}
  };

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/settings" className="text-gray-500 hover:text-gray-300 text-sm lg:ml-0 ml-10">&larr; Settings</Link>
        <h1 className="text-2xl font-bold text-white">API Tokens</h1>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Create token */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Create Token</h2>
          <div className="flex gap-2">
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Token name (e.g. my-cli)"
              className="flex-1 bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none" />
            <button onClick={createToken} disabled={!newName.trim()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 text-white text-sm rounded-lg transition-colors">
              Create
            </button>
          </div>
          {createResult.token && (
            <div className="mt-3 bg-green-500/5 border border-green-500/20 rounded-lg px-3 py-2">
              <div className="text-xs text-green-400 mb-1">Token created (copy now, shown only once):</div>
              <code className="text-sm text-green-300 break-all select-all">{createResult.token}</code>
            </div>
          )}
          {createResult.error && <div className="mt-2 text-xs text-red-400">{createResult.error}</div>}
        </section>

        {/* Token list */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Active Tokens ({tokens.length})</h2>
          {loading ? (
            <div className="animate-pulse space-y-2">{[1,2].map(i => <div key={i} className="h-12 bg-gray-800/20 rounded" />)}</div>
          ) : tokens.length === 0 ? (
            <EmptyState
              variant="tokens"
              compact
              sub="Tokens authenticate CLI tools and external integrations. Sign in with V3 auth, then create one above."
            />
          ) : (
            <div className="space-y-2">
              {tokens.map(t => (
                <div key={t.token_id} className="flex items-center justify-between bg-[#0a0a15] rounded-lg px-3 py-2 border border-[#1a1a2a]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{t.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        t.scope === 'full' ? 'text-cyan-300 border-cyan-500/20 bg-cyan-500/5' : 'text-gray-400 border-gray-600/20'
                      }`}>{t.scope}</span>
                    </div>
                    <div className="text-[10px] text-gray-500">{t.token_id} · network: {t.network_id?.slice(0, 12) || '--'} · used {timeAgo(t.last_used_at)}</div>
                  </div>
                  <button onClick={() => revokeToken(t.token_id)}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-800/30 hover:bg-red-500/10 transition-colors">
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
