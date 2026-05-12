'use client';

import { useState } from 'react';

export function BroadcastBar() {
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState('');

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBroadcasting(true);
    setBroadcastResult('');
    try {
      const res = await fetch('/api/hub/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: broadcastMsg }),
      });
      const data = await res.json();
      if (data.ok) {
        setBroadcastResult(`Broadcast sent to ${data.recipients} node(s)`);
        setBroadcastMsg('');
      } else {
        setBroadcastResult(`Failed: ${data.error || 'Send error'}`);
      }
    } catch (e: unknown) {
      setBroadcastResult(`Failed: ${e instanceof Error ? e.message : 'Send error'}`);
    }
    setBroadcasting(false);
    setTimeout(() => setBroadcastResult(''), 5000);
  };

  return (
    <div className="mb-6">
      <div className="flex gap-2">
        <input
          type="text"
          value={broadcastMsg}
          onChange={e => setBroadcastMsg(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendBroadcast()}
          placeholder="Broadcast message to all online agents..."
          maxLength={500}
          aria-label="Broadcast message"
          className="flex-1 bg-[#111128] border border-[#2a2a4a] rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 focus:outline-none transition-colors"
        />
        <button
          onClick={sendBroadcast}
          disabled={broadcasting || !broadcastMsg.trim()}
          aria-label="Send broadcast"
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm rounded-lg transition-all font-medium cursor-pointer disabled:cursor-not-allowed"
        >
          {broadcasting ? (
            <>
              <svg aria-hidden className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span>Sending…</span>
            </>
          ) : (
            <>
              {/* Megaphone icon — "broadcast to all" affordance */}
              <svg aria-hidden className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 11v3a1 1 0 0 0 1 1h2l3.29 3.29a1 1 0 0 0 1.71-.71V7.42a1 1 0 0 0-1.71-.71L6 10H4a1 1 0 0 0-1 1Z" />
                <path d="M16 8a5 5 0 0 1 0 6" opacity="0.7" />
                <path d="M19 5a9 9 0 0 1 0 12" opacity="0.45" />
              </svg>
              <span>Broadcast</span>
            </>
          )}
        </button>
      </div>
      {broadcastMsg.length > 0 && (
        <div className="text-right text-xs text-gray-600 mt-1 tabular-nums">{broadcastMsg.length}/500</div>
      )}
      {broadcastResult && (
        <div className={`mt-3 text-sm text-center anet-fade-in ${broadcastResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400/80'}`}>
          {broadcastResult}
        </div>
      )}
    </div>
  );
}
