'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';

/** Command palette — ⌘K / Ctrl+K / `/` opens; Esc closes;
 *  ↑↓ navigates results; Enter activates.
 *
 *  This is round 14 (scaffold) of the polish loop:
 *  - Modal shell, search input, keyboard shortcuts
 *  - Static command list: page navigation across the dashboard
 *
 *  Future rounds will extend `commands` with actions (open Dispatch,
 *  toggle theme, sign out) and per-page surfaces (jump to task by alias,
 *  jump to node by name).
 */

interface Command {
  id: string;
  title: string;
  hint?: string;
  group: 'Recents' | 'Agents' | 'Tasks' | 'Actions' | 'Navigate';
  icon: React.ReactNode;
  perform: (router: ReturnType<typeof useRouter>) => void;
  /** Matched char indices (set by fuzzy filter for highlight render). */
  _titleHi?: number[];
  _hintHi?: number[];
}

interface SessionRow { alias?: string; status?: string; agent?: string }
interface TaskRow    { task_id?: string; from_name?: string; to_name?: string; content?: string; status?: string }

const RECENTS_KEY = 'anet-cmdk-recents';
const RECENTS_MAX = 4;

function readRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function pushRecent(id: string) {
  try {
    const list = readRecents().filter(x => x !== id);
    list.unshift(id);
    sessionStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {}
}

/** Fuzzy match: returns score + matched char positions in `hay`. -1 score
 *  means no match. Round 18 introduced fuzzy; round 20 returns indices so
 *  the UI can highlight matched chars (Linear / Raycast style). */
interface FuzzyResult { score: number; indices: number[]; }
function fuzzyMatch(hay: string, needle: string): FuzzyResult {
  if (!needle) return { score: 0, indices: [] };
  const H = hay.toLowerCase();
  const N = needle.toLowerCase();
  let hi = 0, ni = 0, score = 0, streak = 0;
  const indices: number[] = [];
  while (hi < H.length && ni < N.length) {
    if (H[hi] === N[ni]) {
      score += 2 + streak;
      streak++;
      indices.push(hi);
      if (hi === 0 || /[\s·:_/-]/.test(H[hi - 1])) score += 4;
      ni++;
    } else {
      streak = 0;
    }
    hi++;
  }
  if (ni < N.length) return { score: -1, indices: [] };
  return { score: score - Math.max(0, H.length - N.length) * 0.05, indices };
}

/** Renders `text` with the chars at `indices` wrapped in <mark>. Handles
 *  unicode (Chinese aliases, emoji) by iterating code points via Array.from. */
function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  const chars = Array.from(text);
  return (
    <>
      {chars.map((ch, i) =>
        set.has(i)
          ? <mark key={i} className="anet-cmdk-mark">{ch}</mark>
          : <span key={i}>{ch}</span>
      )}
    </>
  );
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const COMMANDS: Command[] = [
  { id: 'go-overview', title: 'Go to Overview', hint: 'Fleet at a glance', group: 'Navigate',
    icon: <NavIcon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3" />,
    perform: r => r.push('/') },
  { id: 'go-tasks', title: 'Go to Tasks', hint: 'All task statuses', group: 'Navigate',
    icon: <NavIcon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
    perform: r => r.push('/tasks') },
  { id: 'go-tasks-failed', title: 'Go to Failed tasks', hint: 'Filter status=failed', group: 'Navigate',
    icon: <NavIcon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />,
    perform: r => r.push('/tasks?status=failed') },
  { id: 'go-nodes', title: 'Go to Nodes', hint: 'Agent fleet', group: 'Navigate',
    icon: <NavIcon d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />,
    perform: r => r.push('/nodes') },
  { id: 'go-messages', title: 'Go to Messages', hint: 'Inter-agent chat', group: 'Navigate',
    icon: <NavIcon d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />,
    perform: r => r.push('/messages') },
  { id: 'go-networks', title: 'Go to Networks', hint: 'Manage networks', group: 'Navigate',
    icon: <NavIcon d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />,
    perform: r => r.push('/settings/networks') },
  { id: 'go-logs', title: 'Go to Audit Log', hint: 'Register / login / actions', group: 'Navigate',
    icon: <NavIcon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    perform: r => r.push('/logs') },
  { id: 'go-server-logs', title: 'Go to Server Logs', hint: 'CommHub stdout/stderr', group: 'Navigate',
    icon: <NavIcon d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
    perform: r => r.push('/server-logs') },
  { id: 'go-admin', title: 'Go to Admin', hint: 'Server overview + broadcast', group: 'Navigate',
    icon: <NavIcon d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />,
    perform: r => r.push('/admin') },
  { id: 'go-settings', title: 'Go to Settings', hint: 'Connection / Account / Resources', group: 'Navigate',
    icon: <NavIcon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
    perform: r => r.push('/settings') },

  // ── Actions group (round 15) ─────────────────────────────────
  { id: 'act-toggle-theme', title: 'Toggle theme', hint: 'cyber ↔ light', group: 'Actions',
    icon: <NavIcon d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />,
    perform: () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'cyber';
      const next = (cur === 'light' || cur === 'mint') ? 'cyber' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('anet-theme', next); } catch {}
    } },
  { id: 'act-copy-url', title: 'Copy current URL', hint: 'page link to clipboard', group: 'Actions',
    icon: <NavIcon d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />,
    perform: () => {
      try { navigator.clipboard.writeText(window.location.href); } catch {}
    } },
  { id: 'act-sign-out', title: 'Sign out', hint: 'clear session', group: 'Actions',
    icon: <NavIcon d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />,
    perform: () => {
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      try { sessionStorage.removeItem('anet_v3_auth'); } catch {}
      window.location.assign('/login');
    } },
  { id: 'act-help', title: 'Show keyboard shortcuts', hint: 'press ? — works on mobile too', group: 'Actions',
    icon: <NavIcon d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
    perform: () => {
      // Dispatch synthetic `?` keydown so HelpOverlay's global listener opens
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    } },

  // ── Round 69 / Loop: topology filter actions ────────────────
  // Write the pin directly into sessionStorage (the same key R66
  // hydrates from) and broadcast a `storage`-like custom event
  // so TopoGraph picks it up without a reload. Keyboard-accessible
  // filter trigger from anywhere on the dashboard.
  { id: 'act-pin-working', title: 'Pin topology filter: working', hint: 'highlight working nodes only', group: 'Actions',
    icon: <NavIcon d="M4 6h16M4 12h8m-8 6h16" />,
    perform: () => {
      try { sessionStorage.setItem('anet-topo-pinned-status', 'working'); } catch {}
      window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'working' } }));
    } },
  { id: 'act-pin-idle', title: 'Pin topology filter: idle', hint: 'highlight idle (online) nodes only', group: 'Actions',
    icon: <NavIcon d="M4 6h16M4 12h8m-8 6h16" />,
    perform: () => {
      try { sessionStorage.setItem('anet-topo-pinned-status', 'idle'); } catch {}
      window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'idle' } }));
    } },
  { id: 'act-pin-offline', title: 'Pin topology filter: offline', hint: 'highlight offline / no-SSE nodes', group: 'Actions',
    icon: <NavIcon d="M4 6h16M4 12h8m-8 6h16" />,
    perform: () => {
      try { sessionStorage.setItem('anet-topo-pinned-status', 'offline'); } catch {}
      window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'offline' } }));
    } },
  { id: 'act-clear-topo-pins', title: 'Clear topology filters', hint: 'release pinned status + group', group: 'Actions',
    icon: <NavIcon d="M6 18L18 6M6 6l12 12" />,
    perform: () => {
      try {
        sessionStorage.removeItem('anet-topo-pinned-status');
        sessionStorage.removeItem('anet-topo-pinned-group');
      } catch {}
      window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'clear' } }));
    } },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Global hotkey ⌘K / Ctrl+K / `/`
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
        return;
      }
      // `/` opens only when no input is currently focused
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && !open) {
        e.preventDefault();
        setOpen(true);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset state on open + auto-focus input
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Read recents on open
  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => { if (open) setRecentIds(readRecents()); }, [open]);

  // Round 16: per-page surfaces. Pull agents + tasks on palette open so the
  // user can type an alias / task content and jump directly to it. Both
  // endpoints are already cached by SWR elsewhere, so this is cheap.
  const [dynamic, setDynamic] = useState<Command[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          fetch('/api/hub/status').then(r => r.ok ? r.json() : { sessions: [] }),
          fetch('/api/hub/tasks?limit=20').then(r => r.ok ? r.json() : { tasks: [] }),
        ]);
        if (cancelled) return;
        const agentCmds: Command[] = (sRes.sessions as SessionRow[] || [])
          .filter(s => s.alias)
          .slice(0, 20)
          .map(s => ({
            id: `agent-${s.alias}`,
            title: `Go to agent ${s.alias}`,
            hint: `${s.agent || 'agent'} · ${s.status || 'unknown'}`,
            group: 'Agents',
            icon: <NavIcon d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
            perform: (r) => r.push(`/node?alias=${encodeURIComponent(s.alias!)}`),
          }));
        const taskCmds: Command[] = (tRes.tasks as TaskRow[] || [])
          .filter(t => t.task_id)
          .slice(0, 15)
          .map(t => ({
            id: `task-${t.task_id}`,
            title: `Open task: ${(t.content || t.task_id || '').slice(0, 50)}`,
            hint: `${t.from_name || '?'} → ${t.to_name || '?'} · ${t.status || ''}`,
            group: 'Tasks',
            icon: <NavIcon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
            perform: (r) => r.push(`/tasks/${encodeURIComponent(t.task_id!)}`),
          }));
        setDynamic([...agentCmds, ...taskCmds]);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Filtered results — when no query, prepend recents as their own group
  const results = useMemo(() => {
    const pool = [...COMMANDS, ...dynamic];
    if (!query.trim()) {
      const recentCmds: Command[] = recentIds
        .map(id => pool.find(c => c.id === id))
        .filter((c): c is Command => Boolean(c))
        .map(c => ({ ...c, group: 'Recents' }));
      const restIds = new Set(recentIds);
      // Default view: Recents → Navigate → Actions (no dynamic agents/tasks
      // until user actually types — keeps the empty-search list short).
      return [...recentCmds, ...COMMANDS.filter(c => !restIds.has(c.id))];
    }
    // Fuzzy match — `stg` matches `Settings`, `taska` matches `Task all-time`.
    // Score against title (weight 1.0), hint (0.6), id (0.3). Drop unmatched.
    // Round 20: keep matched indices for title + hint so we can highlight.
    const scored = pool
      .map(c => {
        const mt = fuzzyMatch(c.title, query);
        const mh = c.hint ? fuzzyMatch(c.hint, query) : { score: -1, indices: [] };
        const mi = fuzzyMatch(c.id, query);
        const best = Math.max(
          mt.score >= 0 ? mt.score * 1.0 : -Infinity,
          mh.score >= 0 ? mh.score * 0.6 : -Infinity,
          mi.score >= 0 ? mi.score * 0.3 : -Infinity,
        );
        return {
          c,
          score: best,
          _titleHi: mt.score >= 0 ? mt.indices : [],
          _hintHi: mh.score >= 0 ? mh.indices : [],
        };
      })
      .filter(x => x.score > -Infinity);
    scored.sort((a, b) => b.score - a.score);
    return scored.map(x => ({ ...x.c, _titleHi: x._titleHi, _hintHi: x._hintHi }));
  }, [query, recentIds, dynamic]);

  // Clamp selected when results shrink
  useEffect(() => {
    if (selected >= results.length) setSelected(0);
  }, [results.length, selected]);

  // Keyboard inside modal
  const onModalKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = results[selected];
      if (c) { pushRecent(c.id); c.perform(router); setOpen(false); }
    }
  };

  if (!open) return null;

  // Group results by `group` field
  const grouped: Record<string, Command[]> = {};
  for (const c of results) {
    (grouped[c.group] ||= []).push(c);
  }
  // Index map so click handlers know which "selected" each item is
  let runningIdx = 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="anet-cmdk fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] sm:pt-[15vh] px-4"
      onClick={() => setOpen(false)}
      onKeyDown={onModalKey}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />
      <div
        className="relative w-full max-w-xl rounded-xl border border-[#2a2a4a] bg-[#0d0d1a] shadow-2xl shadow-black/40 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[#2a2a4a] px-3 py-2.5">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" className="text-gray-500 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-600 border border-[#2a2a4a] rounded px-1.5 py-0.5 font-mono">esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-600">
              No commands match "{query}"
            </div>
          ) : (
            Object.entries(grouped).map(([groupName, items]) => (
              <div key={groupName} className="mb-2 last:mb-0">
                <div className="text-[10px] uppercase tracking-[0.12em] text-gray-600 px-3 py-1">{groupName}</div>
                {items.map(c => {
                  const idx = runningIdx++;
                  const isActive = idx === selected;
                  return (
                    <button
                      key={c.id}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => { pushRecent(c.id); c.perform(router); setOpen(false); }}
                      className={`anet-cmdk-row w-full flex items-center gap-3 px-3 py-2 text-left text-sm ${
                        isActive ? 'bg-cyan-500/10 text-cyan-300' : 'text-gray-300 hover:bg-[#1a1a2a]/50'
                      }`}
                    >
                      <span className={isActive ? 'text-cyan-400' : 'text-gray-500'}>{c.icon}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">
                          <Highlight text={c.title} indices={c._titleHi || []} />
                        </span>
                        {c.hint && (
                          <span className="block text-[11px] text-gray-600 truncate">
                            <Highlight text={c.hint} indices={c._hintHi || []} />
                          </span>
                        )}
                      </span>
                      {isActive && <span className="text-[10px] text-gray-500">↵</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[#2a2a4a] px-3 py-1.5 flex items-center justify-between text-[10px] text-gray-600">
          <span className="flex items-center gap-3">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> select</span>
            <span><kbd className="font-mono">esc</kbd> close</span>
          </span>
          <span><kbd className="font-mono">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}
