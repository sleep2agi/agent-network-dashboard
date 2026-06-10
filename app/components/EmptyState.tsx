'use client';

import { useState } from 'react';
import Link from 'next/link';

export type EmptyVariant = 'nodes' | 'tasks' | 'messages' | 'logs' | 'tokens' | 'networks' | 'generic';

interface EmptyStateProps {
  /** Picks the icon glyph and default copy if title/sub omitted. */
  variant?: EmptyVariant;
  /** Optional override headline. */
  title?: string;
  /** Optional override sub-copy. */
  sub?: string;
  /** Optional CTA: text + href (internal) or onClick. */
  cta?: { label: string; href?: string; onClick?: () => void };
  /** Compact mode for in-card empty states (smaller padding). */
  compact?: boolean;
}

const DEFAULTS: Record<EmptyVariant, { title: string; sub: string }> = {
  nodes:    { title: 'No agents in this network',   sub: 'Agent sessions will appear here once they connect to the CommHub.' },
  tasks:    { title: 'No tasks yet',                sub: 'Tasks will appear here when agents send them via CommHub.' },
  messages: { title: 'No messages',                 sub: 'Messages between agents will appear here.' },
  logs:     { title: 'No audit logs',               sub: 'Events will appear here when users register, login, or perform actions.' },
  tokens:   { title: 'No API tokens',               sub: 'Create one to authenticate CLI tools and external integrations.' },
  networks: { title: 'No networks found',           sub: 'Create one or sign in with V3 auth to see your networks.' },
  generic:  { title: 'Nothing here yet',            sub: 'Data will appear here once available.' },
};

/**
 * Minimal monochrome SVG glyphs per variant. No filled shapes, no gradients,
 * no AI-decoration — just thin-stroke line art that fades into the page.
 * 64×64 viewBox; rendered at 56×56 (compact 40×40).
 */
function Glyph({ variant, size }: { variant: EmptyVariant; size: number }) {
  const s = { width: size, height: size };
  const baseProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.25,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (variant) {
    case 'nodes':
      // Mesh with dashed edges = "nodes will land here"
      return (
        <svg viewBox="0 0 64 64" {...s}>
          <g {...baseProps}>
            <circle cx="32" cy="14" r="4" />
            <circle cx="14" cy="44" r="4" />
            <circle cx="50" cy="44" r="4" />
            <line x1="32" y1="18" x2="14" y2="40" strokeDasharray="3 3" opacity="0.6" />
            <line x1="32" y1="18" x2="50" y2="40" strokeDasharray="3 3" opacity="0.6" />
            <line x1="18" y1="44" x2="46" y2="44" strokeDasharray="3 3" opacity="0.6" />
          </g>
        </svg>
      );
    case 'tasks':
      // Empty checkbox list
      return (
        <svg viewBox="0 0 64 64" {...s}>
          <g {...baseProps}>
            <rect x="14" y="14" width="36" height="6" rx="1.5" />
            <rect x="14" y="26" width="36" height="6" rx="1.5" opacity="0.6" />
            <rect x="14" y="38" width="36" height="6" rx="1.5" opacity="0.35" />
          </g>
        </svg>
      );
    case 'messages':
      // Speech bubble outline
      return (
        <svg viewBox="0 0 64 64" {...s}>
          <g {...baseProps}>
            <path d="M14 18 h36 a3 3 0 0 1 3 3 v18 a3 3 0 0 1 -3 3 h-18 l-8 6 v-6 h-10 a3 3 0 0 1 -3 -3 v-18 a3 3 0 0 1 3 -3 z" />
            <line x1="22" y1="28" x2="42" y2="28" opacity="0.5" />
            <line x1="22" y1="34" x2="36" y2="34" opacity="0.5" />
          </g>
        </svg>
      );
    case 'logs':
      // Document with lines
      return (
        <svg viewBox="0 0 64 64" {...s}>
          <g {...baseProps}>
            <path d="M18 12 h22 l8 8 v32 a2 2 0 0 1 -2 2 h-28 a2 2 0 0 1 -2 -2 v-38 a2 2 0 0 1 2 -2 z" />
            <path d="M40 12 v8 h8" opacity="0.6" />
            <line x1="24" y1="32" x2="40" y2="32" opacity="0.55" />
            <line x1="24" y1="38" x2="40" y2="38" opacity="0.4" />
            <line x1="24" y1="44" x2="34" y2="44" opacity="0.25" />
          </g>
        </svg>
      );
    case 'tokens':
      // Key outline
      return (
        <svg viewBox="0 0 64 64" {...s}>
          <g {...baseProps}>
            <circle cx="22" cy="32" r="8" />
            <line x1="30" y1="32" x2="54" y2="32" />
            <line x1="44" y1="32" x2="44" y2="38" />
            <line x1="50" y1="32" x2="50" y2="40" />
          </g>
        </svg>
      );
    case 'networks':
      // Globe-ish concentric ovals
      return (
        <svg viewBox="0 0 64 64" {...s}>
          <g {...baseProps}>
            <circle cx="32" cy="32" r="18" />
            <ellipse cx="32" cy="32" rx="18" ry="9" opacity="0.55" />
            <line x1="14" y1="32" x2="50" y2="32" opacity="0.55" />
            <line x1="32" y1="14" x2="32" y2="50" opacity="0.55" />
          </g>
        </svg>
      );
    case 'generic':
    default:
      // Soft sparkle outline
      return (
        <svg viewBox="0 0 64 64" {...s}>
          <g {...baseProps}>
            <circle cx="32" cy="32" r="14" strokeDasharray="3 3" opacity="0.6" />
            <circle cx="32" cy="32" r="3" />
          </g>
        </svg>
      );
  }
}

export function EmptyState({ variant = 'generic', title, sub, cta, compact = false }: EmptyStateProps) {
  const d = DEFAULTS[variant];
  const headline = title ?? d.title;
  const subcopy = sub ?? d.sub;
  const iconSize = compact ? 40 : 56;

  return (
    <div className={`text-center ${compact ? 'py-8' : 'py-16'} px-4`} role="status">
      <div className="anet-empty-glyph inline-flex items-center justify-center mb-4 text-gray-500" aria-hidden>
        <Glyph variant={variant} size={iconSize} />
      </div>
      <h3 className={`font-medium text-gray-300 ${compact ? 'text-sm' : 'text-base'}`}>{headline}</h3>
      {subcopy && (
        <p className={`text-gray-500 ${compact ? 'text-xs mt-1.5' : 'text-sm mt-2'} max-w-md mx-auto leading-relaxed`}>
          {subcopy}
        </p>
      )}
      {cta && (
        <div className="mt-4">
          {cta.href ? (
            <Link href={cta.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-400 hover:text-cyan-300">
              {cta.label}
              <span aria-hidden>→</span>
            </Link>
          ) : (
            <button onClick={cta.onClick} className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-400 hover:text-cyan-300">
              {cta.label}
              <span aria-hidden>→</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Round 105 (issue #90): centered card shell so the Overview empty state
 *  reads as an intentional, layout-aligned card instead of bare text
 *  floating in the content column. */
function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto rounded-xl border border-[#26262b] bg-[#161618] shadow-lg shadow-black/20">
      {children}
    </div>
  );
}

/**
 * Overview-specific variant. Three cases:
 *   1. network-mismatch — agents exist globally, none in this network
 *   2. agents-offline   — 0 registered now BUT task history exists, so this
 *      is NOT a first run (round 105 / issue #90: showing "Spin up your
 *      first agent" next to "acked: 499" was misleading)
 *   3. true first-run   — 0 agents, 0 history → quickstart command
 */
export function NodesEmptyState({
  hint,
  taskHistoryCount = 0,
}: {
  hint?: { global_count?: number; filtered_network?: string };
  taskHistoryCount?: number;
}) {
  if (hint?.global_count) {
    return (
      <EmptyCard>
        <EmptyState
          variant="nodes"
          title="No agents in this network"
          sub={`Server has ${hint.global_count} nodes globally, but none are registered to the current network. Switch network or contact admin.`}
        />
      </EmptyCard>
    );
  }

  // Round 105 (issue #90): there's task history but no agents online right
  // now — they finished or disconnected. Don't pitch a first-run setup;
  // point at the history instead.
  if (taskHistoryCount > 0) {
    return (
      <EmptyCard>
        <EmptyState
          variant="nodes"
          title="No agents online"
          sub={`Every agent in this network is currently offline. ${taskHistoryCount.toLocaleString()} task${taskHistoryCount === 1 ? '' : 's'} in history — they may have finished their work or disconnected.`}
          cta={{ label: 'View task history', href: '/tasks' }}
        />
      </EmptyCard>
    );
  }

  // Round 52: true empty state (zero agents anywhere) — show the
  // quickstart command inline so users don't have to leave the dashboard
  // to figure out how to spin up their first agent.
  return (
    <EmptyCard>
      <div className="text-center py-16 px-4" role="status">
        <div className="anet-empty-glyph inline-flex items-center justify-center mb-4 text-gray-500" aria-hidden>
          <svg viewBox="0 0 64 64" width={56} height={56}>
            <g stroke="currentColor" strokeWidth="1.5" fill="none">
              <rect x="10" y="20" width="44" height="28" rx="2" />
              <rect x="20" y="32" width="6" height="8" opacity="0.5" />
              <rect x="32" y="32" width="6" height="8" opacity="0.5" />
              <rect x="44" y="32" width="4" height="8" opacity="0.5" />
              <line x1="10" y1="26" x2="54" y2="26" opacity="0.4" />
              <circle cx="14" cy="23" r="0.8" fill="currentColor" />
            </g>
          </svg>
        </div>
        <h3 className="font-medium text-gray-300 text-base">Spin up your first agent</h3>
        <p className="text-gray-500 text-sm mt-2 max-w-md mx-auto leading-relaxed">
          Run this in a fresh terminal to register an agent with this CommHub:
        </p>
        <div className="mt-4 inline-block">
          <QuickstartCommand cmd="npx --yes @sleep2agi/agent-network init" />
        </div>
        <div className="mt-3">
          <a
            href="https://anet.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-cyan-300"
          >
            Full quickstart guide
            <span aria-hidden>→</span>
          </a>
        </div>
      </div>
    </EmptyCard>
  );
}

/** Code block + inline copy button used by the empty-Overview first-run
 *  CTA. State lives here so the parent stays stateless. */
function QuickstartCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  return (
    <div className="anet-empty-cmd flex items-start sm:items-center gap-2 bg-[#0e0e10] border border-[#26262b] rounded-lg pl-4 pr-1.5 py-1.5 text-xs sm:text-sm">
      {/* #209 R44: long quickstart commands (e.g. the `npm install -g …`
          variant) overflowed the empty-state card horizontally on phones
          because <code> defaults to white-space:pre. break-all on mobile
          lets them wrap inside the box; sm: up restores normal wrapping
          so desktop monospace lines stay clean. items-start on phones
          aligns the Copy button to the top so a wrapped 2-line command
          doesn't bottom-anchor the button. */}
      <code className="text-cyan-300 font-mono select-all min-w-0 break-all sm:break-normal">{cmd}</code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy command'}
        className="shrink-0 rounded-md px-2 py-1.5 text-[11px] text-gray-500 hover:text-gray-200 hover:bg-[#1c1c1f] transition-colors"
      >
        {copied ? (
          <span className="flex items-center gap-1 text-green-400">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Copied
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy
          </span>
        )}
      </button>
    </div>
  );
}
