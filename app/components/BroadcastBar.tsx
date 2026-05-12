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
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm rounded-lg transition-all font-medium cursor-pointer disabled:cursor-not-allowed"
        >
          {broadcasting ? 'Sending...' : 'Broadcast'}
        </button>
      </div>
      {broadcastMsg.length > 0 && (
        <div className="text-right text-xs text-gray-600 mt-1">{broadcastMsg.length}/500</div>
      )}
      {broadcastResult && (
        <div className={`mt-3 text-sm text-center ${broadcastResult.startsWith('Failed') ? 'text-red-400' : 'text-green-400/80'} animate-fade-in`}>
          {broadcastResult}
        </div>
      )}
    </div>
  );
}
