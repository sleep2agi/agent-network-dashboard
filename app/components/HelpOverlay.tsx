'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

/** Help overlay — press `?` to see keyboard shortcuts.
 *  Restrained: no animation noise, single column, all global keys in one
 *  place. Closes on Esc or `?` again or click-outside.
 */

interface Shortcut {
  keys: string[];
  label: string;
}

const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: 'Global',
    items: [
      { keys: ['⌘', 'K'], label: 'Open command palette (also Ctrl+K)' },
      { keys: ['/'], label: 'Open command palette' },
      { keys: ['?'], label: 'Toggle this help overlay' },
      { keys: ['Esc'], label: 'Close any open modal' },
    ],
  },
  {
    group: 'Navigate (vim-style)',
    items: [
      { keys: ['g', 'o'], label: 'Go to Overview' },
      { keys: ['g', 't'], label: 'Go to Tasks' },
      { keys: ['g', 'n'], label: 'Go to Nodes' },
      { keys: ['g', 'm'], label: 'Go to Messages' },
      { keys: ['g', 'w'], label: 'Go to Networks' },
      { keys: ['g', 'a'], label: 'Go to Admin' },
      { keys: ['g', 'l'], label: 'Go to Audit Log' },
      { keys: ['g', 's'], label: 'Go to Settings' },
    ],
  },
  {
    group: 'Command palette',
    items: [
      { keys: ['↑', '↓'], label: 'Move selection' },
      { keys: ['↵'], label: 'Activate selected command' },
      { keys: ['type'], label: 'Filter — searches commands, agents, tasks' },
    ],
  },
  // Round 25 / Loop: TopoGraph keys + mouse gestures from rounds 21-23
  // were only surfaced in button titles. Consolidating here gives the
  // Help overlay (the canonical discovery surface) a single place to
  // learn the canvas controls.
  {
    group: 'Topology canvas',
    items: [
      { keys: ['+'], label: 'Zoom in (also =)' },
      { keys: ['−'], label: 'Zoom out' },
      { keys: ['0'], label: 'Reset zoom + pan' },
      { keys: ['⌘', 'wheel'], label: 'Zoom toward cursor (Ctrl on Windows/Linux)' },
      { keys: ['drag'], label: 'Pan the canvas (cursor → grabbing)' },
      { keys: ['dbl-click'], label: 'Reset zoom + pan' },
      { keys: ['click'], label: 'Open chat popover on a node (Esc to close)' },
    ],
  },
];

const GO_TARGETS: Record<string, string> = {
  o: '/',
  t: '/tasks',
  n: '/nodes',
  m: '/messages',
  w: '/settings/networks',
  a: '/admin',
  l: '/logs',
  s: '/settings',
};

export function HelpOverlay() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  /** Timestamp when `g` was last pressed. The next single letter within
   *  1500ms is interpreted as the target page. vim-style `g o`, `g t`, etc. */
  const gAtRef = useRef<number>(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement | null)?.isContentEditable;
      // `?` toggles — Shift+/ on US layout. Only when no input is focused.
      if (e.key === '?' && !inInput) {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
      // Vim-style `g + letter` route shortcuts (round 35). Skip when modifier
      // keys are held (g is a perfectly fine letter when ⌘ is involved) and
      // when typing into a field.
      if (inInput || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'g') {
        gAtRef.current = Date.now();
        return;
      }
      if (Date.now() - gAtRef.current < 1500) {
        const target = GO_TARGETS[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          gAtRef.current = 0;
          router.push(target);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, router]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="anet-help fixed inset-0 z-[101] flex items-center justify-center px-4"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
      <div
        className="relative w-full max-w-md rounded-xl border border-[#2a2a4a] bg-[#0d0d1a] shadow-2xl shadow-black/40 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#2a2a4a] px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Keyboard shortcuts
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close help"
            className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3 max-h-[70vh] overflow-y-auto">
          {SHORTCUTS.map(g => (
            <div key={g.group} className="mb-3 last:mb-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-gray-600 mb-1.5">{g.group}</div>
              <ul className="space-y-1.5">
                {g.items.map((s, i) => (
                  <li key={i} className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1">
                      {s.keys.map((k, ki) => (
                        <kbd key={ki} className="text-[10px] font-mono border border-[#2a2a4a] rounded px-1.5 py-0.5 text-gray-400 bg-[#1a1a2a]/40">
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span className="text-gray-400 flex-1">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-[#2a2a4a] px-4 py-1.5 text-[10px] text-gray-600 flex items-center justify-between">
          <span>Press <kbd className="font-mono">?</kbd> to toggle</span>
          <span>or <kbd className="font-mono">esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
