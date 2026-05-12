'use client';

import Link from 'next/link';
import { Session } from './types';
import { timeAgo } from './utils';
import { AliasAvatar } from './AliasAvatar';

interface AgentCardProps {
  session: Session;
  hasSse: boolean;
  sseCount: number;
  onChat?: (alias: string) => void;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; glow: string }> = {
  working: { bg: 'bg-green-900/30 border-green-800/30', text: 'text-green-300', dot: 'bg-green-500', glow: 'shadow-green-500/10' },
  idle: { bg: 'bg-cyan-900/30 border-cyan-800/30', text: 'text-cyan-300', dot: 'bg-cyan-400', glow: 'shadow-cyan-500/5' },
  blocked: { bg: 'bg-yellow-900/30 border-yellow-800/30', text: 'text-yellow-300', dot: 'bg-yellow-500', glow: '' },
  error: { bg: 'bg-red-900/30 border-red-800/30', text: 'text-red-300', dot: 'bg-red-500', glow: '' },
};

const DEFAULT_STATUS = { bg: 'bg-gray-800/50 border-gray-700/30', text: 'text-gray-500', dot: 'bg-gray-500', glow: '' };

export function AgentCard({ session: s, hasSse, sseCount, onChat }: AgentCardProps) {
  const cfg = hasSse ? (STATUS_CONFIG[s.status] || DEFAULT_STATUS) : DEFAULT_STATUS;

  return (
    <Link
      href={`/node?alias=${encodeURIComponent(s.alias)}`}
      prefetch={false}
      className={`anet-agent-card group relative block rounded-xl border p-4 transition-all duration-300 cursor-pointer hover:-translate-y-0.5 ${
        hasSse
          ? `bg-[#111128] border-[#2a2a4a] hover:border-cyan-500/30 hover:shadow-lg ${cfg.glow}`
          : 'bg-[#0d0d1a] border-[#1a1a2a] opacity-40'
      }`}
    >
      {/* Header: avatar + name + status. Avatar carries the alias→hue map
          shared with Messages/Nodes/Tasks/Overview; the live status dot
          stays as a small pulse-capable indicator. */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <AliasAvatar alias={s.alias} size={22} />
          <span className="font-semibold text-white truncate text-sm" title={s.alias}>{s.alias}</span>
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot} ${hasSse && s.status === 'working' ? 'animate-pulse' : ''}`} />
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-md border shrink-0 ${cfg.bg} ${cfg.text}`}>
          {hasSse ? s.status : 'offline'}
        </span>
      </div>

      {/* Agent type badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-600 bg-[#0a0a15] px-2 py-0.5 rounded border border-[#1a1a2a]">
          {s.agent || 'unknown'}
        </span>
        {hasSse && (
          <span className="text-[10px] text-green-500">SSE:{sseCount}</span>
        )}
      </div>

      {/* Task */}
      {s.task ? (
        <div className="text-xs text-gray-400 bg-[#0a0a15] rounded-lg px-3 py-2 border border-[#1a1a2a] line-clamp-2" title={s.task}>
          {s.task}
        </div>
      ) : (
        <div className="text-xs text-gray-700 italic">No active task</div>
      )}

      {/* Progress bar */}
      {s.progress > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-gray-600">Progress</span>
            <span className={cfg.text}>{s.progress}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-1.5 rounded-full transition-all duration-700 ${s.status === 'working' ? 'bg-green-500' : 'bg-cyan-500'}`}
              style={{ width: `${Math.min(s.progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: time + chat + hover chevron affordance (round 44).
          The card is a <Link> so it's clickable everywhere, but with no
          visible cue users may not realise. Chevron appears on hover and
          slides right ~2px for a "drill in" hint. */}
      <div className="mt-3 flex justify-between items-center text-[10px] text-gray-600">
        <span className="truncate" title={s.server || ''}>{s.server || '--'}</span>
        <div className="flex items-center gap-2">
          {onChat && hasSse && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onChat(s.alias); }}
              className="text-cyan-400 hover:text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/20 hover:bg-cyan-500/10 transition-colors"
            >
              Chat
            </button>
          )}
          <span>{timeAgo(s.updated_at)}</span>
          <svg
            aria-hidden
            className="w-3 h-3 text-gray-700 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
