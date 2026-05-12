'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

interface LogLine {
  ts: string;
  level: 'log' | 'info' | 'warn' | 'error';
  line: string;
}

const LEVEL_COLOR: Record<LogLine['level'], string> = {
  log: 'text-gray-300',
  info: 'text-cyan-300',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const LEVEL_BADGE: Record<LogLine['level'], string> = {
  log: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/10 text-red-300 border-red-500/30',
};

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
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-baseline justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-white">Server Logs</h1>
          <span className="text-xs text-gray-500">CommHub stdout/stderr · 最新在上</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setPaused(p => !p)}
            className={`px-3 py-1 rounded border ${paused ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'}`}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <label className="flex items-center gap-1 text-gray-400 select-none">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="accent-cyan-500" />
            auto-refresh
          </label>
          <button onClick={() => fetchLogs(true)} className="px-3 py-1 rounded border bg-gray-500/10 text-gray-300 border-gray-500/20 hover:bg-gray-500/20">
            ↻ Reload
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1 text-xs">
          {(['all', 'log', 'info', 'warn', 'error'] as const).map(lv => (
            <button
              key={lv}
              onClick={() => setFilterLevel(lv)}
              className={`px-2.5 py-1 rounded border ${
                filterLevel === lv
                  ? 'bg-cyan-500/15 text-cyan-200 border-cyan-500/40'
                  : 'bg-[#11111c] text-gray-400 border-[#2a2a4a] hover:bg-[#1a1a2a]'
              }`}
            >
              {lv}{lv !== 'all' && counts[lv as LogLine['level']] > 0 ? ` (${counts[lv as LogLine['level']]})` : ''}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索关键字 (alias / task_id / error message)"
          className="flex-1 px-3 py-1.5 text-xs bg-[#11111c] border border-[#2a2a4a] rounded text-gray-200 focus:outline-none focus:border-cyan-500/40"
        />
        <span className="text-[10px] text-gray-600">
          {filtered.length} / {logs.length}
        </span>
      </div>

      {error && (() => {
        // Translate server error to user-friendly copy + actionable recovery.
        // Raw error stays in title tooltip for debugging.
        const isAuth = /401|unauthor|forbidden|403|admin/i.test(error);
        return (
          <div className="anet-error-chip mb-3 p-3 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-sm flex items-start gap-3" role="alert">
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

      <div className="rounded border border-[#1a1a2a] bg-[#050510] font-mono text-[11px] leading-relaxed overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-600">
            {error ? '加载失败' : logs.length === 0 ? '加载中...' : '没有匹配的日志'}
          </div>
        ) : (
          <div className="divide-y divide-[#0d0d18] max-h-[calc(100vh-260px)] overflow-y-auto">
            {filtered.map((l, i) => (
              <div key={`${l.ts}-${i}`} className="px-3 py-1 hover:bg-[#0a0a14] flex gap-3">
                <span className="text-gray-600 shrink-0 w-[110px] text-[10px]">{shortTime(l.ts)}</span>
                <span className={`shrink-0 px-1.5 rounded border text-[9px] uppercase ${LEVEL_BADGE[l.level]}`}>
                  {l.level}
                </span>
                <span className={`break-all whitespace-pre-wrap ${LEVEL_COLOR[l.level]}`}>{l.line}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
