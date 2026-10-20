'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Model × server reachability matrix (RFC-028 P2, aligned to real #308 schema).
 * probe_provider_model is ASYNC: we DISPATCH a probe per (model × server) with
 * bounded concurrency (~6), then POLL get_probe_results until every cell
 * resolves (or times out). Cells: ok (green ✓ + latency) · auth_fail (amber) ·
 * unreachable (red ✕) · incompatible (gray —) · pending (spinner).
 * Rendered as a real <table> for screen-reader columns.
 */

interface Server { daemon_node_id: string; hostname: string }
type CellStatus = 'pending' | 'ok' | 'auth_fail' | 'unreachable' | 'incompatible' | 'error';
interface Cell { status: CellStatus; latency_ms?: number; reason?: string }

// `tag` is the short inline label shown in the cell (visible without hover, so
// a screenshot/glance reads cleanly); `label` is the longer a11y/tooltip term.
const CELL_UI: Record<Exclude<CellStatus, 'pending'>, { glyph: string; cls: string; label: string; tag: string }> = {
  ok:           { glyph: '✓', cls: 'text-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)]', label: 'ok', tag: 'ok' },
  auth_fail:    { glyph: '⚷', cls: 'text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_12%,transparent)]', label: 'auth', tag: '401' },
  unreachable:  { glyph: '✕', cls: 'text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]', label: 'unreachable', tag: 'down' },
  incompatible: { glyph: '—', cls: 'text-[var(--fg-dim)] bg-[var(--bg)]', label: 'incompatible', tag: 'n/a' },
  error:        { glyph: '!', cls: 'text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]', label: 'error', tag: 'err' },
};

// Legend entries shown under the matrix so cell glyphs are self-explanatory.
const LEGEND: Array<Exclude<CellStatus, 'pending'>> = ['ok', 'auth_fail', 'unreachable', 'incompatible'];

const CONCURRENCY = 6;
const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 24000;

async function pool<T>(items: T[], worker: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx]); }
  }));
}

const norm = (s: string): CellStatus => {
  if (s === 'ok' || s === 'auth_fail' || s === 'unreachable' || s === 'incompatible' || s === 'pending') return s;
  if (s === 'timeout' || s === 'dns_fail' || s === 'conn_fail') return 'unreachable';
  return 'error';
};

export function ReachabilityMatrix({ providerId, models }: { providerId?: string; models: string[] }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const key = (m: string, s: string) => `${m}@@${s}`;

  const run = useCallback(async (srv: Server[]) => {
    if (!models.length || !srv.length || !providerId) return;
    setRunning(true); setUnconfirmed(null);
    const pairs = models.flatMap(m => srv.map(s => ({ m, s })));
    setCells(Object.fromEntries(pairs.map(({ m, s }) => [key(m, s.daemon_node_id), { status: 'pending' as CellStatus }])));

    // 1) dispatch all probes (async — backend mints pending rows + doorbells daemons)
    await pool(pairs, async ({ m, s }) => {
      try {
        const r = await fetch('/api/anet/providers/probe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_id: providerId, model_name: m, daemon_node_id: s.daemon_node_id }),
        });
        const d = await r.json().catch(() => ({}));
        if (d?.unconfirmed && aliveRef.current) setUnconfirmed(d?.error || 'backend not available');
      } catch { /* dispatch best-effort; poll surfaces the outcome */ }
    });

    // 2) poll get_probe_results until every cell resolves or we time out
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const want = new Set(pairs.map(({ m, s }) => key(m, s.daemon_node_id)));
    while (aliveRef.current && Date.now() < deadline) {
      await new Promise(res => setTimeout(res, POLL_MS));
      if (!aliveRef.current) break;
      try {
        const r = await fetch(`/api/anet/providers/probe-results?provider_id=${encodeURIComponent(providerId)}`, { cache: 'no-store' });
        const d = await r.json().catch(() => ({}));
        if (d?.unconfirmed) { if (aliveRef.current) setUnconfirmed(d?.error || 'backend not available'); break; }
        const rows = Array.isArray(d?.results) ? d.results : [];
        // latest row per (model,daemon)
        const latest = new Map<string, { status: string; latency_ms?: number; error_label?: string; probed_at?: number }>();
        for (const row of rows) {
          const k = key(String(row.model_name), String(row.daemon_node_id));
          if (!want.has(k)) continue;
          const prev = latest.get(k);
          if (!prev || (row.probed_at || 0) >= (prev.probed_at || 0)) latest.set(k, row);
        }
        if (aliveRef.current) {
          setCells(prev => {
            const next = { ...prev };
            for (const [k, row] of latest) next[k] = { status: norm(String(row.status)), latency_ms: row.latency_ms, reason: row.error_label };
            return next;
          });
        }
        // done when no cell is still pending
        const allResolved = [...want].every(k => latest.get(k) && latest.get(k)!.status !== 'pending');
        if (allResolved) break;
      } catch { /* transient — keep polling */ }
    }
    if (aliveRef.current) setRunning(false);
  }, [models, providerId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/anet/providers/probe', { cache: 'no-store' });
        const d = await r.json().catch(() => ({}));
        const srv: Server[] = Array.isArray(d?.servers) ? d.servers : [];
        if (!alive) return;
        setServers(srv); setLoading(false);
        if (srv.length) run(srv);
      } catch { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [run]);

  const total = models.length * servers.length;
  const okCount = Object.values(cells).filter(c => c.status === 'ok').length;

  if (loading) return <div className="px-3 py-3 text-[11px] text-[var(--fg-dim)]">解析服务器集合…</div>;
  if (unconfirmed) {
    return <div className="mx-3 my-2 rounded-md bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-3 py-2 text-[11px] text-[var(--warning)]">
      连通性 probe 后端尚未就绪：{unconfirmed}。矩阵 UI 已就位，待 hub 升级到含 RFC-028 接真 probe。
    </div>;
  }
  if (!servers.length) return <div className="px-3 py-3 text-[11px] text-[var(--fg-dim)]">未发现可达的 host_supervisor 服务器（probe 目标集为空）。</div>;

  return (
    <div className="border-t border-[var(--border)] px-3 py-3" data-reachability-matrix>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-[var(--fg-muted)]" title={`可达矩阵 · ${okCount}/${total} reachable`}>
          可达矩阵 · <span className="tabular-nums text-[var(--fg)]">{okCount}/{total}</span> reachable
          {running && <span className="ml-2 text-[var(--fg-dim)]">probing…</span>}
        </span>
        <button type="button" onClick={() => run(servers)} disabled={running}
          className="shrink-0 rounded-[10px] bg-[var(--bg)] px-2 py-0.5 text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg)] disabled:opacity-50">重新测试</button>
      </div>
      <div className="overflow-x-auto">
        <table className="anet-stack w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-medium text-[var(--fg-dim)]">model \\ server</th>
              {servers.map(s => <th key={s.daemon_node_id} className="px-2 py-1 text-center font-mono font-normal text-[var(--fg-muted)]" title={s.daemon_node_id}>{s.hostname}</th>)}
            </tr>
          </thead>
          <tbody>
            {models.map(m => (
              <tr key={m}>
                <td className="whitespace-nowrap px-2 py-1 font-mono text-[var(--fg)]" data-label="model" title={m}>{m}</td>
                {servers.map(s => {
                  const c = cells[key(m, s.daemon_node_id)];
                  if (!c || c.status === 'pending') return <td key={s.daemon_node_id} data-label={s.hostname} className="px-2 py-1 text-center">
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--fg-dim)] border-t-transparent" aria-label="probing" />
                  </td>;
                  const ui = CELL_UI[c.status as Exclude<CellStatus, 'pending'>] || CELL_UI.error;
                  return (
                    <td key={s.daemon_node_id} data-label={s.hostname} className="px-2 py-1 text-center">
                      <span className={`inline-flex min-w-[2.75rem] items-center justify-center gap-1 rounded border px-1.5 py-0.5 ${ui.cls}`}
                        title={c.reason ? `${ui.label}: ${c.reason}` : ui.label} data-cell-status={c.status}>
                        <span aria-hidden>{ui.glyph}</span>
                        {c.status === 'ok'
                          ? (c.latency_ms != null && <span className="tabular-nums text-[11px] opacity-80">{c.latency_ms}ms</span>)
                          : <span className="text-[11px] opacity-80">{ui.tag}</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--fg-dim)]">
        {LEGEND.map(s => {
          const ui = CELL_UI[s];
          return (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border ${ui.cls}`} aria-hidden>{ui.glyph}</span>
              {ui.label}
            </span>
          );
        })}
        <span className="text-[var(--fg-dim)]">· 实时探测（模型→服务器真实请求往返）</span>
      </div>
    </div>
  );
}
