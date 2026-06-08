'use client';

import { useState } from 'react';
import { useSessions, useHealth, useStats } from '../lib/hooks';
import { timeAgo } from '../components/utils';
import { AliasAvatar } from '../components/AliasAvatar';
import { STATUS_CHIP_CLASS, SESSION_STATUS_CHIP_CLASS } from '../lib/status';

export default function AdminPage() {
  const { sessions } = useSessions();
  const { health } = useHealth();
  const { stats } = useStats();
  const sseMap = health?.sse_sessions || {};
  // SSE keys are `network_id:alias` since server v0.7+; fall back to alias-only.
  const sseFor = (s: { alias: string; network_id?: string }) =>
    (s.network_id ? sseMap[`${s.network_id}:${s.alias}`] : undefined) ?? sseMap[s.alias];

  const [regUser, setRegUser] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regResult, setRegResult] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastResult, setBroadcastResult] = useState('');
  const [taskTarget, setTaskTarget] = useState('');
  const [taskContent, setTaskContent] = useState('');
  const [taskResult, setTaskResult] = useState('');

  const registerUser = async () => {
    if (!regUser.trim() || !regPass.trim()) return;
    try {
      const res = await fetch('/api/hub/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register', username: regUser, password: regPass }),
      });
      const data = await res.json();
      setRegResult(data.ok ? `Created: ${data.user.username} (${data.user.user_id})` : `Failed: ${data.error}`);
      if (data.ok) { setRegUser(''); setRegPass(''); }
    } catch { setRegResult('Failed'); }
    setTimeout(() => setRegResult(''), 8000);
  };

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    try {
      const res = await fetch('/api/hub/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMsg }),
      });
      const data = await res.json();
      setBroadcastResult(data.ok ? `Sent to ${data.recipients} nodes` : `Failed: ${data.error}`);
      if (data.ok) setBroadcastMsg('');
    } catch { setBroadcastResult('Failed'); }
    setTimeout(() => setBroadcastResult(''), 5000);
  };

  const sendTask = async () => {
    if (!taskTarget || !taskContent.trim()) return;
    try {
      const res = await fetch('/api/hub/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: taskTarget, task: taskContent }),
      });
      const data = await res.json();
      setTaskResult(data.ok ? 'Task sent' : `Failed: ${data.error}`);
      if (data.ok) setTaskContent('');
    } catch { setTaskResult('Failed'); }
    setTimeout(() => setTaskResult(''), 5000);
  };

  const onlineNodes = sessions.filter(s => sseFor(s));
  const offlineNodes = sessions.filter(s => !sseFor(s));

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-gray-100 p-4 sm:p-6 font-mono">
      <h1 className="text-2xl font-bold text-white mb-3 lg:ml-0 ml-10">Admin</h1>

      {/* Section anchor nav — same pattern as Settings r28; R2 of #190 mobile
          polish: idle chips were flat text-only with a ~24px tap height (below
          the 44px iOS guideline), so on the 375–390px screenshot pass they
          read as inert labels rather than tappable jumps. Wrapping each in a
          visible bordered chip restores the affordance and lifts tap height
          to ~44px without changing the desktop hierarchy. */}
      {/* #209 R31 (mobile vertical rhythm — same pattern as R28/R30):
          chip-jump nav was mb-8 (32 px) — biggest single gap on /admin
          above the fold. Drop to mb-4 sm:mb-8 — phones get 16 px, sm:
          up keeps the original breathing room. */}
      <nav className="mb-4 sm:mb-8 flex flex-wrap gap-2 text-xs">
        {[
          { href: '#status',  label: 'Status' },
          { href: '#actions', label: 'Actions' },
          { href: '#users',   label: 'Users' },
        ].map(a => (
          <a key={a.href} href={a.href}
            className="inline-flex min-h-[44px] items-center rounded-md border border-[#2a2a4a] bg-[#0a0a15]/60 px-3 py-2 text-gray-400 hover:border-cyan-500/50 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors">
            {a.label}
          </a>
        ))}
      </nav>

      <div className="max-w-6xl space-y-10">

        {/* ── Group: Status ─────────────────────────────────────── */}
        <div id="status" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2 px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400 font-semibold">Status</div>
            <div className="flex-1 h-px bg-[#2a2a4a]" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Server Overview */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Server Overview</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-3xl font-bold text-green-400 tabular-nums">{onlineNodes.length}</div>
              <div className="text-xs text-gray-500">Online</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-gray-500 tabular-nums">{offlineNodes.length}</div>
              <div className="text-xs text-gray-500">Offline</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-cyan-400 tabular-nums">{health?.sse_connections ?? '--'}</div>
              <div className="text-xs text-gray-500">
                SSE Streams <span className="text-gray-600">· server</span>
              </div>
            </div>
            <div>
              <div className="text-3xl font-bold text-white tabular-nums">{stats?.tasks?.total ?? '--'}</div>
              <div className="text-xs text-gray-500">Total Tasks</div>
            </div>
          </div>
          {stats?.tasks?.by_status && stats.tasks.by_status.length > 0 && (
            /* Round 90: adopt the shared STATUS_CHIP_CLASS palette so
               `acked`/`replied`/`failed` here color-match the same
               chips on /tasks, Overview r69, and /tasks/[id] r68.
               Unknown statuses fall back to the previous flat gray. */
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.tasks.by_status.map((s: { status: string; count: number }) => (
                <span key={s.status} className={`text-xs px-2 py-1 rounded border ${STATUS_CHIP_CLASS[s.status] || 'bg-[#0a0a15] border-[#1a1a2a] text-gray-400'}`}>
                  {s.status}: {s.count}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Online Sessions — pulled into Status group (was below Send Task) */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">
            Online Sessions <span className="text-gray-600">({onlineNodes.length})</span>
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {onlineNodes.length === 0 ? (
              <div className="text-xs text-gray-600 text-center py-4">No online sessions</div>
            ) : onlineNodes.map(s => (
              <div key={s.alias} className="flex items-center gap-3 bg-[#0a0a15] rounded-lg px-3 py-2 border border-[#1a1a2a]">
                <AliasAvatar alias={s.alias} size={20} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white font-medium truncate">{s.alias}</div>
                  <div className="text-xs text-gray-500 truncate">{s.agent || '--'} · {s.task || 'idle'}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Round 91: 5-state palette via shared
                      SESSION_STATUS_CHIP_CLASS (was working-vs-other, which
                      rendered blocked/error identical to idle). */}
                  <span className={`text-xs px-2 py-0.5 rounded border ${SESSION_STATUS_CHIP_CLASS[s.status] || SESSION_STATUS_CHIP_CLASS.idle}`}>{s.status}</span>
                  <span className="text-[10px] text-gray-600">{timeAgo(s.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

          </div>
        </div>

        {/* ── Group: Actions ────────────────────────────────────── */}
        <div id="actions" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2 px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400 font-semibold">Actions</div>
            <div className="flex-1 h-px bg-[#2a2a4a]" />
          </div>
          {sessions.length === 0 ? (
            /* Round 77: Broadcast and Send Task both require at least one
               registered agent. Surfacing the empty cards above an empty
               fleet is the same dead-control class as the Overview
               Dispatch button (r70). Replace with a single inline hint. */
            <div className="bg-[#111128] border border-[#2a2a4a] rounded-xl px-5 py-4 text-sm text-gray-500">
              Broadcast and Send Task become available after the first agent registers.
            </div>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Broadcast */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Broadcast</h2>
          <textarea
            value={broadcastMsg}
            onChange={e => setBroadcastMsg(e.target.value)}
            placeholder="Message to all online nodes..."
            rows={3}
            className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none resize-none"
          />
          <div className="flex justify-between items-center mt-3">
            <span className="text-xs text-gray-600">{broadcastMsg.length}/500</span>
            <button
              onClick={sendBroadcast}
              disabled={!broadcastMsg.trim()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              Broadcast
            </button>
          </div>
          {broadcastResult && <div className={`mt-2 text-xs ${broadcastResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{broadcastResult}</div>}
        </section>

        {/* Send Task */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Send Task</h2>
          <select
            value={taskTarget}
            onChange={e => setTaskTarget(e.target.value)}
            className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:border-cyan-500/50 focus:outline-none mb-3"
          >
            <option value="">Select target node...</option>
            {onlineNodes.map(s => (
              <option key={s.alias} value={s.alias}>{s.alias} ({s.status})</option>
            ))}
            <optgroup label="Offline">
              {offlineNodes.map(s => (
                <option key={s.alias} value={s.alias}>{s.alias} (offline)</option>
              ))}
            </optgroup>
          </select>
          <textarea
            value={taskContent}
            onChange={e => setTaskContent(e.target.value)}
            placeholder="Task content..."
            rows={3}
            className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none resize-none"
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={sendTask}
              disabled={!taskTarget || !taskContent.trim()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              Send Task
            </button>
          </div>
          {taskResult && <div className={`mt-2 text-xs ${taskResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{taskResult}</div>}
        </section>

          </div>
          )}
        </div>

        {/* ── Group: Users ──────────────────────────────────────── */}
        <div id="users" className="space-y-4 scroll-mt-6">
          <div className="flex items-center gap-2 px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-gray-400 font-semibold">Users</div>
            <div className="flex-1 h-px bg-[#2a2a4a]" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* User Management (V3 Auth) */}
        <section className="bg-[#111128] border border-[#2a2a4a] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Register User (V3)</h2>
          <div className="space-y-3">
            <input
              type="text"
              value={regUser}
              onChange={e => setRegUser(e.target.value)}
              placeholder="Username"
              className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
            />
            <input
              type="password"
              value={regPass}
              onChange={e => setRegPass(e.target.value)}
              placeholder="Password"
              className="w-full bg-[#0a0a15] border border-[#2a2a4a] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none"
            />
            <button
              onClick={registerUser}
              disabled={!regUser.trim() || !regPass.trim()}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              Register
            </button>
          </div>
          {regResult && <div className={`mt-2 text-xs ${regResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>{regResult}</div>}
        </section>

          </div>
        </div>

      </div>
    </div>
  );
}
