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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<{ token?: string; error?: string }>({});

  const fetchTokens = useCallback(async () => {
    // A swallowed failure here used to render the empty state, which tells the
    // user they have no tokens and invites them to create one — indistinguishable
    // from a hub that is down, and it invites duplicates. Surface it instead.
    setLoadError(null);
    try {
      const res = await fetch('/api/hub/tokens');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '请求失败');
    } finally { setLoading(false); }
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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] p-4 sm:p-6">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/settings" className="text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--accent)]">&larr; Settings</Link>
        <h1 className="text-[22px] font-semibold leading-7 text-[var(--fg)]">API Tokens</h1>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Create token */}
        <section className="rounded-[10px] bg-[var(--bg-secondary)] p-4 shadow-[var(--ds-shadow-card)] sm:p-5">
          <h2 className="mb-3 text-[15px] font-semibold leading-[22px] text-[var(--fg)]">Create Token</h2>
          <div className="flex gap-2">
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Token name (e.g. my-cli)"
              className="h-11 min-w-0 flex-1 rounded-[10px] bg-[var(--col-inset)] px-3 text-base text-[var(--fg)] placeholder:text-[var(--fg-dim)] focus:shadow-[var(--focus-ring)] focus:outline-none sm:h-9 sm:text-sm" />
            <button onClick={createToken} disabled={!newName.trim()}
              className="inline-flex h-11 items-center rounded-[10px] bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--bg-elevated)] disabled:text-[var(--fg-dim)] disabled:hover:brightness-100 sm:h-9">
              Create
            </button>
          </div>
          {createResult.token && (
            <div className="mt-3 rounded-[10px] px-3 py-2" style={{ background: 'color-mix(in srgb, var(--success) 14%, transparent)' }}>
              <div className="mb-1 text-xs text-[var(--success)]">Token created (copy now, shown only once):</div>
              <code className="text-sm break-all text-[var(--fg)] select-all">{createResult.token}</code>
            </div>
          )}
          {createResult.error && <div className="mt-2 text-xs text-[var(--danger)]">{createResult.error}</div>}
        </section>

        {/* Token list */}
        <section className="rounded-[10px] bg-[var(--bg-secondary)] p-4 shadow-[var(--ds-shadow-card)] sm:p-5">
          <h2 className="mb-3 text-[15px] font-semibold leading-[22px] text-[var(--fg)]">Active Tokens ({tokens.length})</h2>
          {loading ? (
            <div className="animate-pulse space-y-2">{[1,2].map(i => <div key={i} className="h-12 rounded-[10px] bg-[var(--bg-elevated)]" />)}</div>
          ) : loadError ? (
            <div
              data-testid="tokens-load-error"
              className="rounded-[10px] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--fg-muted)]"
            >
              <div className="text-[var(--fg)]">无法加载 token 列表({loadError})</div>
              <div className="mt-1 text-xs">这不代表你没有 token —— 请先确认 hub 可达,不要重复创建。</div>
              <button
                onClick={() => { setLoading(true); fetchTokens(); }}
                className="mt-2 inline-flex h-7 items-center rounded-md bg-[var(--bg)] px-2 text-xs font-medium text-[var(--fg)] hover:bg-[var(--hover-tint)]"
              >重试</button>
            </div>
          ) : tokens.length === 0 ? (
            <EmptyState
              variant="tokens"
              compact
              sub="Tokens authenticate CLI tools and external integrations. Sign in with V3 auth, then create one above."
            />
          ) : (
            <div className="space-y-2">
              {tokens.map(t => (
                <div key={t.token_id} className="flex items-center justify-between gap-3 rounded-[10px] bg-[var(--bg-elevated)] px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[var(--fg)]">{t.name}</span>
                      <span className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
                        t.scope === 'full' ? 'bg-[var(--accent-tonal)] text-[var(--accent)]' : 'bg-[var(--bg)] text-[var(--fg-muted)]'
                      }`}>{t.scope}</span>
                    </div>
                    <div className="truncate text-[11px] text-[var(--fg-dim)]">{t.token_id} · network: {t.network_id?.slice(0, 12) || '--'} · used {timeAgo(t.last_used_at)}</div>
                  </div>
                  <button onClick={() => revokeToken(t.token_id)}
                    className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium text-[var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]">
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
