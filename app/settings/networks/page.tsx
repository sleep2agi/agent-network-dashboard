'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { timeAgo } from '../../components/utils';
import { EmptyState } from '../../components/EmptyState';
import { AliasAvatar } from '../../components/AliasAvatar';
import { Field, PageHeader, StatusPill, fieldControlClass, primaryButtonClass, quietButtonClass } from '../../components/requirement-chrome';
import useSWR from 'swr';

// Without the res.ok check a 401 or 500 carrying a JSON body resolves as a
// successful load, so SWR reports no error and the page renders whatever the
// error payload happened to contain — or an empty list, which is
// indistinguishable from "you have no networks".
const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

interface Network {
  network_id: string;
  network_name: string;
  owner_id: string;
  description: string;
  created_at: string;
}

interface Member {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  joined_at: string;
}

export default function NetworksPage() {
  const { data, mutate } = useSWR('/api/hub/networks', fetcher, { refreshInterval: 10000 });
  const networks: Network[] = data?.networks || [];
  const loading = !data;

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [result, setResult] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedNetwork, setExpandedNetwork] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, Member[]>>({});
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteCode, setInviteCode] = useState('');

  const getToken = () => {
    try {
      const saved = sessionStorage.getItem('anet_v3_auth');
      if (saved) return JSON.parse(saved).token;
    } catch {}
    return '';
  };

  const createNetwork = async () => {
    if (!newName.trim()) return;
    const token = getToken();
    if (!token) { setResult('V3 auth required — sign in via Agent Network login'); return; }
    const res = await fetch('/api/hub/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_network', token, name: newName, description: newDesc }),
    });
    const d = await res.json();
    setResult(d.ok ? `Created: ${d.network_id}` : `Failed: ${d.error}`);
    if (d.ok) { setNewName(''); setNewDesc(''); mutate(); }
    setTimeout(() => setResult(''), 5000);
  };

  const deleteNetwork = async (networkId: string) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/hub/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_network', token, network_id: networkId }),
    });
    const d = await res.json();
    setResult(d.ok ? 'Deleted' : `Failed: ${d.error}`);
    setConfirmDelete(null);
    if (d.ok) mutate();
    setTimeout(() => setResult(''), 5000);
  };

  const fetchMembers = async (networkId: string) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch(`/api/hub/auth?endpoint=/api/networks/${networkId}/members&token=${token}`);
    const d = await res.json();
    setMembers(prev => ({ ...prev, [networkId]: d.members || [] }));
  };

  const generateInvite = async (networkId: string) => {
    const token = getToken();
    if (!token) return;
    const res = await fetch('/api/hub/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invite_member', token, network_id: networkId, role: inviteRole }),
    });
    const d = await res.json();
    if (d.ok && d.invite_code) setInviteCode(d.invite_code);
    else setResult(`Invite failed: ${d.error}`);
  };

  return (
    <div className="anet-page min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* #217 D9: back link stacks above the title instead of sitting
          beside it — the old single row read as an off-balance
          "← Settings   Networks" pair on phones. */}
      <Link href="/settings" className="mb-3 inline-flex text-sm text-[var(--fg-muted)] hover:text-[var(--fg)]">&larr; Settings</Link>
      <PageHeader title="Networks" description="创建网络、查看成员，并生成邀请码。" />

      <div className="max-w-2xl space-y-6">
        <section className="rounded-[10px] bg-[var(--bg-secondary)] p-5 shadow-[var(--ds-shadow-card)]">
          <h2 className="mb-3 text-[15px] font-semibold text-[var(--fg)]">Create Network</h2>
          <div className="space-y-3">
            <Field label="名称">
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Network name" className={fieldControlClass} />
            </Field>
            <Field label="说明">
              <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)" className={fieldControlClass} />
            </Field>
            <button type="button" onClick={createNetwork} disabled={!newName.trim()} className={primaryButtonClass}>
              Create
            </button>
          </div>
          {result && <div className={`mt-2 text-xs ${result.startsWith('Failed') || result.startsWith('V3') || result.startsWith('Invite') ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>{result}</div>}
        </section>

        <section className="rounded-[10px] bg-[var(--bg-secondary)] p-5 shadow-[var(--ds-shadow-card)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--fg)]">My Networks</h2>
            {networks.length > 3 && (
              <span className="text-[11px] uppercase tracking-wide text-[var(--fg-dim)]">{networks.length} total</span>
            )}
          </div>
          {loading ? (
            <div className="animate-pulse space-y-2">{[1,2].map(i => <div key={i} className="h-14 rounded-[10px] bg-[var(--bg-elevated)]" />)}</div>
          ) : networks.length === 0 ? (
            <EmptyState
              variant="networks"
              compact
              sub="Create your first network above, or sign in with V3 auth to see existing ones."
            />
          ) : (
            <div className="space-y-3">
              {networks.map(n => (
                <div key={n.network_id} className="rounded-[10px] bg-[var(--bg-elevated)] px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <AliasAvatar alias={n.network_name} size={28} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--fg)]" title={n.network_name}>{n.network_name}</div>
                        <div className="truncate font-mono text-[11px] text-[var(--fg-dim)]" title={n.network_id}>{n.network_id} · {timeAgo(n.created_at)}</div>
                        {n.description && <div className="mt-1 line-clamp-2 text-xs text-[var(--fg-muted)]" title={n.description}>{n.description}</div>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => {
                        if (expandedNetwork === n.network_id) { setExpandedNetwork(null); return; }
                        setExpandedNetwork(n.network_id);
                        fetchMembers(n.network_id);
                      }} className="rounded-[10px] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent-tonal)]">
                        {expandedNetwork === n.network_id ? 'Hide' : 'Members'}
                      </button>
                      {confirmDelete === n.network_id ? (
                        <>
                          <button type="button" onClick={() => deleteNetwork(n.network_id)} className="rounded-[10px] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-2 py-1 text-xs text-[var(--danger)]">Confirm</button>
                          <button type="button" onClick={() => setConfirmDelete(null)} className="text-xs text-[var(--fg-dim)]">Cancel</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirmDelete(n.network_id)} className="rounded-[10px] px-2 py-1 text-xs text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedNetwork === n.network_id && (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      <div className="mb-2 text-xs text-[var(--fg-muted)]">Members ({(members[n.network_id] || []).length})</div>
                      {(members[n.network_id] || []).length === 0 ? (
                        <div className="text-[11px] text-[var(--fg-dim)]">No members or V3 auth required</div>
                      ) : (
                        (members[n.network_id] || []).map(m => {
                          const name = m.username || m.display_name || '?';
                          return (
                          <div key={m.user_id} className="flex items-center gap-2 justify-between text-xs py-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <AliasAvatar alias={name} size={16} />
                              <span className="truncate text-[var(--fg)]" title={name}>{name}</span>
                            </div>
                            <StatusPill status={m.role === 'owner' ? 'active' : 'idle'} label={m.role} />
                          </div>
                          );
                        })
                      )}

                      {/* Invite */}
                      <div className="mt-3 border-t border-[var(--border)] pt-3">
                        <div className="mb-2 text-xs text-[var(--fg-muted)]">Invite</div>
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label="角色">
                            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className={fieldControlClass}>
                              <option value="member">member</option>
                              <option value="admin">admin</option>
                              <option value="viewer">viewer</option>
                            </select>
                          </Field>
                          <button type="button" onClick={() => generateInvite(n.network_id)} className={primaryButtonClass}>
                            Generate Code
                          </button>
                        </div>
                        {inviteCode && (
                          <div className="mt-2 rounded-[10px] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] px-3 py-2">
                            <div className="mb-1 flex items-center justify-between">
                              <div className="text-[11px] uppercase tracking-wide text-[var(--success)]">Invite code</div>
                              <button
                                type="button"
                                onClick={() => { navigator.clipboard?.writeText(inviteCode).catch(() => {}); }}
                                className={quietButtonClass}
                              >
                                Copy
                              </button>
                            </div>
                            <code className="select-all break-all text-xs text-[var(--success)]">{inviteCode}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
