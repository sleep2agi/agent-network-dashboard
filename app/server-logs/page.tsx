'use client';

import { PageHeader } from '../components/requirement-chrome';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCollapsibleSearch } from '@/app/components/CollapsibleSearch';
import Link from 'next/link';

interface LogLine {
  ts: string;
  level: 'log' | 'info' | 'warn' | 'error';
  line: string;
}

const LEVEL_COLOR: Record<LogLine['level'], string> = {
  log: 'text-[var(--fg-muted)]',
  info: 'text-[var(--accent)]',
  warn: 'text-[var(--warning)]',
  error: 'text-[var(--danger)]',
};

const LEVEL_BADGE: Record<LogLine['level'], string> = {
  log: 'bg-[var(--bg-elevated)] text-[var(--fg-muted)]',
  info: 'bg-[var(--accent-tonal)] text-[var(--accent)]',
  warn: 'bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]',
  error: 'bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]',
};

/** Left-rail strip color per log level — gives the eye a vertical guide
 *  when scanning long log walls. Plain hex so Tailwind purge can't drop it. */
const LEVEL_STRIPE: Record<LogLine['level'], string> = {
  log: 'transparent',
  info: '#22d3ee',
  warn: '#f59e0b',
  error: '#ef4444',
};

/** Highlight search-matched substring inside a log line. Case-insensitive
 *  first-match wrap; mark inherits color so log-level coloring stays. */
function highlightSearch(line: string, q: string) {
  if (!q) return line;
  const idx = line.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return line;
  return (
    <>
      {line.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-yellow-100 rounded-sm px-0.5">{line.slice(idx, idx + q.length)}</mark>
      {line.slice(idx + q.length)}
    </>
  );
}

function shortTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return iso;
  }
}

export default function ServerLogsPage() {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [filterLevel, setFilterLevel] = useState<'all' | LogLine['level']>('all');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  // #209 R35: adopt the shared CollapsibleSearch hook (R34) so the
  // inline 全宽 search input collapses behind a magnifier circle in
  // the toolbar — same WeChat-style affordance as /nodes /messages.
  const searchCtl = useCollapsibleSearch({
    value: search,
    onChange: setSearch,
    placeholder: '搜索关键字 (alias / task_id / error message)',
    label: 'Search logs',
    enabled: true,
  });
  const lastTsRef = useRef<string>('');

  const fetchLogs = useCallback(async (initial = false) => {
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (!initial && lastTsRef.current) params.set('since', lastTsRef.current);
      const res = await fetch(`/api/hub/server-logs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setError(null);
      const newLogs: LogLine[] = data.logs || [];
      if (newLogs.length === 0) return;
      // server returns newest-first; track most recent ts for incremental fetches
      lastTsRef.current = newLogs[0].ts;
      if (initial) {
        setLogs(newLogs);
      } else {
        // merge: prepend new entries (which are newer than lastTs)
        setLogs(prev => {
          // de-dup by ts+line
          const seen = new Set(prev.map(l => l.ts + l.line));
          const fresh = newLogs.filter(l => !seen.has(l.ts + l.line));
          return [...fresh, ...prev].slice(0, 1000);
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    }
  }, []);

  useEffect(() => {
    // Initial fetch kick-off; state lands async after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs(true);
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh || paused) return;
    const interval = setInterval(() => fetchLogs(false), 2000);
    return () => clearInterval(interval);
  }, [autoRefresh, paused, fetchLogs]);

  const filtered = logs.filter(l => {
    if (filterLevel !== 'all' && l.level !== filterLevel) return false;
    if (search && !l.line.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = { log: 0, info: 0, warn: 0, error: 0 };
  for (const l of logs) counts[l.level]++;

  return (
    // #209 R35: p-6 → p-4 sm:p-6 mobile-tighten (matches /tasks, /nodes,
    // /messages, /overview convention). Saves 16 px of L/R padding on phones.
    <div className="anet-page max-w-[1600px] mx-auto">
      <PageHeader
        title="Server Logs"
        description="CommHub stdout/stderr"
        actions={
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setPaused(p => !p)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 ${paused ? 'bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]' : 'bg-[var(--accent-tonal)] text-[var(--accent)]'}`}
          >
            {paused ? (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
                Resume
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="5" width="4" height="14" rx="0.5" />
                  <rect x="14" y="5" width="4" height="14" rx="0.5" />
                </svg>
                Pause
              </>
            )}
          </button>
          <label className="flex items-center gap-1 text-[var(--fg-muted)] select-none">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-[var(--accent)]" />
            <span className="hidden sm:inline">auto-refresh</span>
          </label>
          <button type="button" onClick={() => fetchLogs(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[var(--bg-elevated)] px-3 text-[var(--fg)] hover:bg-[var(--hover-tint)]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            <span className="hidden sm:inline">Reload</span>
          </button>
          {/* #209 R35: magnifier-toggle search (WeChat-style, via the
              shared CollapsibleSearch hook). Lives at the tail of the
              toolbar so it sits at the right edge of the header. */}
          <searchCtl.Button />
        </div>
        }
      />

      {/* R35: collapsible search row — sits above the filter chip strip
          so toggling it doesn't shift the chip layout. */}
      <searchCtl.Row />

      {/* Round 95: flex-wrap + min-w-0 on the search wrapper so the
          search input drops below the chip strip on mobile instead of
          overflowing past the viewport. Desktop layout (single row)
          unchanged because the row has room. */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-1 text-xs flex-wrap">
          {/* Round 84: every chip shows its count (matches Tasks r56 +
              Audit Log r43); zero-count non-active chips are disabled
              + muted so the eye lands on the levels that actually have
              entries. */}
          {(['all', 'log', 'info', 'warn', 'error'] as const).map(lv => {
            const count = lv === 'all' ? logs.length : counts[lv as LogLine['level']];
            const isActive = filterLevel === lv;
            const isEmpty = lv !== 'all' && count === 0 && !isActive;
            return (
              <button
                key={lv}
                onClick={() => setFilterLevel(lv)}
                disabled={isEmpty}
                className={`flex min-h-8 items-center gap-1 rounded-md px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-30 ${
                  isActive
                    ? 'bg-[var(--accent-tonal)] text-[var(--accent)]'
                    : 'bg-[var(--bg-secondary)] text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]'
                }`}
              >
                <span>{lv}</span>
                <span className={`text-[11px] tabular-nums ${isActive ? 'opacity-80' : 'text-[var(--fg-dim)]'}`}>{count}</span>
              </button>
            );
          })}
        </div>
        {/* #217 D8 (same rule as the D6 /tasks chip): the counter only
            renders when it carries unique info — a filter or search is
            actually narrowing the list. "500 / 500" duplicated the
            `all 500` chip 20px to its left. */}
        {filtered.length < logs.length && (
          <span className="ml-auto text-[11px] tabular-nums text-[var(--fg-dim)]">
            {filtered.length} / {logs.length}
          </span>
        )}
      </div>

      {error && (() => {
        // Translate server error to user-friendly copy + actionable recovery.
        // Raw error stays in title tooltip for debugging.
        const isAuth = /401|unauthor|forbidden|403|admin/i.test(error);
        return (
          <div className="anet-error-chip mb-3 flex items-start gap-3 rounded-[10px] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] p-3 text-sm text-[var(--danger)]" role="alert">
            <span aria-hidden className="text-base leading-none">⛔</span>
            <div className="flex-1">
              {isAuth ? (
                <>
                  <div className="font-medium">需要 admin 角色才能查看服务器日志</div>
                  <div className="text-xs opacity-80 mt-0.5" title={error}>
                    服务器日志包含运行时 stdout/stderr，仅 admin 角色可读。
                  </div>
                  <Link href="/login" className="inline-block mt-2 text-xs font-medium underline underline-offset-4 hover:opacity-80">
                    切到 admin 账号 →
                  </Link>
                </>
              ) : (
                <>
                  <div className="font-medium">服务器日志暂时无法加载</div>
                  <div className="text-xs opacity-80 mt-0.5" title={error}>请检查 CommHub 是否在线，或稍后重试。</div>
                  <button onClick={() => window.location.reload()} className="inline-block mt-2 text-xs font-medium underline underline-offset-4 hover:opacity-80">
                    重新加载 →
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <div className="overflow-hidden rounded-[10px] bg-[var(--code-bg)] font-mono text-[11px] leading-relaxed shadow-[var(--ds-shadow-card)]">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[var(--fg-dim)]">
            {error ? '加载失败' : logs.length === 0 ? '加载中...' : '没有匹配的日志'}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-260px)] divide-y divide-[var(--border)] overflow-y-auto">
            {filtered.map((l, i) => (
              <div key={`${l.ts}-${i}`} className="relative flex min-h-8 gap-3 py-1.5 pl-3 pr-3 hover:bg-[var(--hover-tint)]">
                {/* Round 32: 2px left rail keyed to level. Makes warn/error
                    spike visible in a wall of `log` lines without users having
                    to read the level chip on every row. */}
                <span
                  aria-hidden
                  className="absolute left-0 top-0 bottom-0 w-0.5"
                  style={{ backgroundColor: LEVEL_STRIPE[l.level] }}
                />
                {/* R4 of #190 mobile polish: the 100px timestamp column +
                    32px LEVEL badge ate ~45% of a 375px row, squeezing log
                    content into a 3-line wrap. Drop the ts column to 60px
                    on mobile (HH:MM:SS still fits at 9px), restore 100px
                    at sm. The 2px left rail (LEVEL_STRIPE) already
                    encodes level visually for warn/error, so the LOG badge
                    is redundant on mobile — hide it below sm. */}
                <span className="w-[60px] shrink-0 text-[11px] tabular-nums text-[var(--fg-dim)] sm:w-[100px]">{shortTime(l.ts)}</span>
                <span className={`hidden shrink-0 rounded px-1.5 text-[11px] uppercase sm:inline ${LEVEL_BADGE[l.level]}`}>
                  {l.level}
                </span>
                {/* Round 85: CommHub stamps each log line with a `[HH:MM:SS]`
                    prefix, but the row already shows shortTime(l.ts) in its
                    own 100px column on the left. Strip the duplicate
                    prefix at display time so the message starts directly
                    with the alias / agent / action. */}
                <span className={`break-all whitespace-pre-wrap ${LEVEL_COLOR[l.level]}`}>
                  {highlightSearch(l.line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, ''), search)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
