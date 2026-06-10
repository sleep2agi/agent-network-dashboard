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
      onClick={e => {
        // #217 M2 (Vincent tg 646 "为什么还要留一个 chat 按钮，直接点击
        // 不就行了"): tapping a reachable agent's card opens chat
        // directly — the Chat button is gone. Offline/unreachable cards
        // keep navigating to /node detail, and detail for reachable
        // agents stays available via the Agents tab.
        if (onChat && hasSse) {
          e.preventDefault();
          onChat(s.alias);
        }
      }}
      className={`anet-agent-card group relative block rounded-xl border p-3 sm:p-4 transition-all duration-300 cursor-pointer hover:-translate-y-0.5 ${
        hasSse
          ? `bg-[#161618] border-[#26262b] hover:border-cyan-500/30 hover:shadow-lg ${cfg.glow}`
          : 'bg-[#111113] border-[#1c1c1f] opacity-40'
      }`}
    >
      {/* Header: avatar + name + status. Avatar carries the alias→hue map
          shared with Messages/Nodes/Tasks/Overview; the live status dot
          stays as a small pulse-capable indicator. R5 of #190 mobile
          polish: trim mb-3 → mb-2 sm:mb-3 so the card's vertical rhythm
          tightens on narrow viewports. */}
      <div className="flex items-center justify-between mb-2 sm:mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <AliasAvatar alias={s.alias} size={22} />
          <span className="font-semibold text-white truncate text-sm" title={s.alias}>{s.alias}</span>
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot} ${hasSse && s.status === 'working' ? 'animate-pulse' : ''}`} />
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-md border shrink-0 ${cfg.bg} ${cfg.text}`}>
          {hasSse ? s.status : 'offline'}
        </span>
      </div>

      {/* Agent type badge — hidden below sm because the runtime
          (`claude-code` / `codex`) repeats across nearly every card and
          chews ~28px per card × 99 sessions on Overview mobile. The
          agent type stays one tap away on /node detail. */}
      <div className="hidden sm:flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-600 bg-[#0e0e10] px-2 py-0.5 rounded border border-[#1c1c1f]">
          {s.agent || 'unknown'}
        </span>
        {hasSse && (
          <span className="text-[10px] text-green-500">SSE:{sseCount}</span>
        )}
      </div>

      {/* Task. Mobile: line-clamp-1 (one-liner) instead of two, and a
          single-line padding (px-2 py-1) so the task strip is ~28px
          rather than ~56px. The full task is still in the title
          tooltip and on /node detail. */}
      {/* #217 M3: the "No active task" italic placeholder is gone — the
          idle status chip in the header already says it, and the line
          cost ~30px on every idle card across a 150-node fleet. The
          task strip renders only when there is a task. */}
      {s.task && (
        <div className="text-xs text-gray-400 bg-[#0e0e10] rounded-lg px-2 sm:px-3 py-1 sm:py-2 border border-[#1c1c1f] line-clamp-1 sm:line-clamp-2" title={s.task}>
          {s.task}
        </div>
      )}

      {/* Progress bar — hidden below sm so an empty 0% bar doesn't
          occupy 20px on every idle card. Visible from sm up where space
          is no longer the constraint. */}
      {s.progress > 0 && (
        <div className="hidden sm:block mt-3">
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
          slides right ~2px for a "drill in" hint.
          #209 R40: two small mobile tweaks —
            (1) the hover chevron is `hidden sm:inline-block` because
                touch devices never trigger the :hover state, and the
                12 px wide reserved slot was just an empty void on
                mobile — but flex with opacity-0 was still spending
                12 + 8 (gap) = 20 px on the right side of every card.
            (2) mt-3 → mt-2 sm:mt-3 mirrors the same density pattern
                R28 / R39 brought to the rest of the page. */}
      <div className="mt-2 sm:mt-3 flex justify-between items-center text-[10px] text-gray-600">
        {/* #217 D5 (Vincent: 乱七八糟的元素都可以删掉): the raw server
            hostname (cloud instance IDs like iZrj93…) is noise on a
            phone card — desktop keeps it, /node detail always has it. */}
        <span className="hidden sm:inline truncate" title={s.server || ''}>{s.server || '--'}</span>
        <div className="flex items-center gap-2 ml-auto">
          <span>{timeAgo(s.updated_at)}</span>
          <svg
            aria-hidden
            className="hidden sm:inline-block w-3 h-3 text-gray-700 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
