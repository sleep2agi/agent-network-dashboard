'use client';

import { useState } from 'react';
import type { Session } from './types';
import { AliasAvatar } from './AliasAvatar';

interface DispatchPanelProps {
  sessions: Session[];
  onClose: () => void;
}

interface SendResult {
  alias: string;
  ok: boolean;
  error?: string;
}

export function DispatchPanel({ sessions, onClose }: DispatchPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [priority, setPriority] = useState('normal');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);
  const [filter, setFilter] = useState('');

  const onlineNodes = sessions.filter(s => s.status !== 'offline');
  const filtered = onlineNodes.filter(s =>
    !filter || s.alias.toLowerCase().includes(filter.toLowerCase()) || (s.agent || '').toLowerCase().includes(filter.toLowerCase())
  );

  const toggleNode = (alias: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias); else next.add(alias);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(s => s.alias)));
    }
  };

  const dispatch = async () => {
    if (!prompt.trim() || selected.size === 0 || sending) return;
    setSending(true);
    setResults([]);

    const promises = [...selected].map(async alias => {
      try {
        const res = await fetch('/api/hub/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias, task: prompt, priority }),
        });
        const data = await res.json();
        return { alias, ok: !!data.ok, error: data.error };
      } catch (e) {
        return { alias, ok: false, error: 'send failed' };
      }
    });

    const res = await Promise.all(promises);
    setResults(res);
    setSending(false);
  };

  const successCount = results.filter(r => r.ok).length;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 anet-fade-in" onClick={onClose} />
      <div className="fixed inset-4 lg:inset-x-[15%] lg:inset-y-[5%] bg-[#0a0a1a] border border-[#2a2a4a] rounded-2xl z-50 flex flex-col shadow-2xl shadow-black/70 overflow-hidden anet-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a4a] bg-[#0d0d1a]">
          <div>
            <h2 className="text-lg font-bold text-white">Dispatch Task</h2>
            <p className="text-xs text-gray-500 mt-0.5">Send a task to one or more agents</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-[#1a1a2a]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Left: Node selection */}
          <div className="lg:w-[280px] border-b lg:border-b-0 lg:border-r border-[#2a2a4a] flex flex-col">
            <div className="px-4 py-3 border-b border-[#2a2a4a]">
              <input
                type="text" value={filter} onChange={e => setFilter(e.target.value)}
                placeholder="Filter agents..."
                className="w-full bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none"
              />
              <div className="flex items-center justify-between mt-2">
                <button onClick={selectAll} className="text-[10px] text-cyan-400 hover:text-cyan-300">
                  {selected.size === filtered.length ? 'Deselect all' : `Select all (${filtered.length})`}
                </button>
                <span className="text-[10px] text-gray-600">{selected.size} selected</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5 max-h-[200px] lg:max-h-none">
              {filtered.map(s => (
                <button key={s.alias} onClick={() => toggleNode(s.alias)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-left transition-colors ${
                    selected.has(s.alias) ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20' : 'text-gray-400 hover:bg-[#1a1a2a]'
                  }`}>
                  <AliasAvatar alias={s.alias} size={16} />
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.status === 'working' ? 'bg-green-400' : s.status === 'idle' ? 'bg-cyan-400' : 'bg-gray-500'}`} />
                  <span className="truncate flex-1">{s.alias}</span>
                  <span className="text-[9px] text-gray-600">{s.agent || '--'}</span>
                </button>
              ))}
              {filtered.length === 0 && <div className="text-center text-xs text-gray-600 py-4">No online agents</div>}
            </div>
          </div>

          {/* Right: Prompt + Send */}
          <div className="flex-1 flex flex-col">
            <div className="flex-1 px-6 py-4 flex flex-col">
              <label className="text-xs text-gray-500 uppercase mb-2">Task Prompt</label>
              <textarea
                value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder="Enter the task you want to dispatch..."
                className="flex-1 min-h-[120px] bg-[#111128] border border-[#2a2a4a] rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-cyan-500/40 focus:outline-none resize-none"
              />

              <div className="flex items-center gap-3 mt-4">
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="bg-[#111128] border border-[#2a2a4a] rounded-lg px-3 py-2 text-xs text-white focus:outline-none">
                  <option value="normal">Normal priority</option>
                  <option value="high">High priority</option>
                  <option value="low">Low priority</option>
                </select>

                <div className="flex-1" />

                <button onClick={dispatch} disabled={sending || !prompt.trim() || selected.size === 0}
                  className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-600 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-cyan-500/10 disabled:shadow-none active:scale-95">
                  {sending ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending...
                    </span>
                  ) : (
                    `Dispatch to ${selected.size} agent${selected.size > 1 ? 's' : ''}`
                  )}
                </button>
              </div>
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div className="px-6 py-3 border-t border-[#2a2a4a] bg-[#0d0d1a]">
                <div className="text-xs text-gray-500 mb-2">
                  {successCount}/{results.length} dispatched successfully
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {results.map(r => (
                    <span key={r.alias} className={`flex items-center gap-1.5 text-[10px] pl-1 pr-2 py-0.5 rounded-full border ${
                      r.ok ? 'text-green-300 border-green-500/20 bg-green-500/5' : 'text-red-300 border-red-500/20 bg-red-500/5'
                    }`}>
                      <AliasAvatar alias={r.alias} size={14} />
                      <span>{r.alias}</span>
                      <span aria-hidden>{r.ok ? '✓' : r.error || '✗'}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
