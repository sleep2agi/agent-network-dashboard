'use client';

import { useEffect, useState } from 'react';

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
    group: 'Command palette',
    items: [
      { keys: ['↑', '↓'], label: 'Move selection' },
      { keys: ['↵'], label: 'Activate selected command' },
      { keys: ['type'], label: 'Filter — searches commands, agents, tasks' },
    ],
  },
  {
    group: 'Pages',
    items: [
      { keys: ['click', 'sidebar logo'], label: 'Back to Overview' },
      { keys: ['Cmd+K', 'Go to agent X'], label: 'Jump straight to a node' },
    ],
  },
];

export function HelpOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `?` toggles — Shift+/ on US layout. Only when no input is focused.
      if (e.key === '?' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
