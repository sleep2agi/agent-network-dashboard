'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Session } from './types';
import { AliasAvatar } from './AliasAvatar';

/**
 * Per-node settings panel (issue #260 → v0.11 flagship #262, Vincent tg
 * 2026-06-24, "must actually work").
 *
 * STATUS (F1/F2/F3, 通信龙 review round 2):
 *  - **Wired (real)**: B Runtime·模型 model select + C 运行模式 flags
 *    (permissionMode / dangerouslySkipPermissions / teammateMode / maxTurns /
 *    budget / timeout). Controlled form state, loaded on mount from
 *    `GET /api/anet/node-config` and persisted via `POST`. The six flags +
 *    model are the editable contract 通信龙 specified.
 *  - **F3 apply lifecycle**: after Save the panel runs a take-effect state
 *    machine — saving → applying (node restarting) → applied | rejected |
 *    timeout — polling `GET ?apply_id` for real backends and showing a colored
 *    status strip ("toast") for the outcome.
 *  - **Still P2 stub (disabled)**: A 接入 Channel (display-only) and D 运维
 *    ops buttons (no-op), each with its own local "暂未接后端" note.
 *
 * ⚠️ The hub-side tool is not deployed yet (工程马 WIP): the route mock-falls
 * back with `mock: true` + `status: pending`, so the lifecycle is *simulated*
 * on local timers and the UI says so ("模拟 · 后端未接入") rather than claiming a
 * node actually restarted. Runtime + imageCapable stay read-only (auto-derived).
 * Field names mirror anet's real config.json.
 */

// B. Runtime → selectable model presets (from anet VENDORS, bin/cli.ts).
// Runtime itself is read-only this round; only the model is editable.
const RUNTIME_MODELS: Record<string, string[]> = {
  'claude-agent-sdk': ['deepseek-v4-pro', 'MiniMax-M3', 'MiniMax-M2.7', 'claude-sonnet-4-6', 'claude-opus-4-x', 'intern', 'mimo'],
  'claude-code-cli': ['（由 CLI 管理）'],
  'codex-sdk': ['gpt-5.5'],
  'grok-build-acp': ['grok-build'],
};

// C. config.flags contract (per 通信龙). permissionMode is a select; two
// booleans; three numeric bounds. These six are the entire editable flag set.
const PERMISSION_MODES = ['auto', 'default', 'bypassPermissions'];

// A. Channel display (P2 — read-only this round). `roadmap` = greyed "即将支持".
const CHANNELS: { key: string; label: string; roadmap?: boolean; fields: { label: string; value?: string }[] }[] = [
  {
    key: 'telegram', label: 'Telegram',
    fields: [
      { label: 'Bot Token', value: '••••••••••••' },
      { label: '允许的 chat id (allowFrom)', value: '—' },
      { label: '状态目录', value: '~/.anet/channels/telegram' },
    ],
  },
  {
    key: 'feishu', label: '飞书 Feishu',
    fields: [
      { label: 'App ID', value: 'cli_••••••' },
      { label: 'App Secret', value: '••••••••••••' },
      { label: '允许的 open_id (allowFrom)', value: '—' },
      { label: '允许的群 chat_id (allowChats)', value: '—' },
      { label: '群触发策略', value: 'mention' },
    ],
  },
  {
    key: 'commhub', label: 'CommHub',
    fields: [
      { label: 'Hub 地址', value: '<hub-address>' },
      { label: '节点 token（自动）', value: '••••••••' },
    ],
  },
  { key: 'wechat', label: 'WeChat', roadmap: true, fields: [] },
];

// D. Node ops — still P2 no-op stubs this round. `danger` = destructive styling.

// Editable flag form shape. Numeric fields are kept as strings for controlled
// inputs and coerced (or dropped when blank) at save time.
type FlagsForm = {
  permissionMode: string;
  dangerouslySkipPermissions: boolean;
  teammateMode: boolean;
  maxTurns: string;
  budget: string;
  timeout: string;
};

const DEFAULT_FLAGS: FlagsForm = {
  permissionMode: 'default',
  dangerouslySkipPermissions: false,
  teammateMode: false,
  maxTurns: '',
  budget: '',
  timeout: '',
};

// F3 apply lifecycle. A save flows:
//   idle → saving (POST in flight) → applying (config dispatched, node
//   restarting / taking effect) → applied | rejected | timeout.
// `error` = the save POST itself failed. The `mock` flag flavours the terminal
// copy when the hub tool isn't deployed (the lifecycle is then simulated on
// local timers rather than polled).
type ApplyPhase = 'idle' | 'saving' | 'applying' | 'applied' | 'rejected' | 'timeout' | 'error';

// Real-backend apply-status poll cadence + ceiling. The mock path uses its own
// short timers instead of polling (the route would only ever return pending).
const APPLY_POLL_MS = 1500;
const APPLY_TIMEOUT_MS = 30000;
// Simulated mock progression delay (dispatched → applied).
const MOCK_APPLY_MS = 1400;
// Auto-dismiss the success strip after this long.
const SUCCESS_DISMISS_MS = 4000;
// Per-request ceiling so a hung hub proxy can't freeze the lifecycle — every
// POST/poll fetch is aborted past this (通信牛 review #11 blocker 2).
const FETCH_TIMEOUT_MS = 8000;

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** fetch + json with a hard AbortController timeout. Rejects (AbortError) if it
 *  doesn't resolve in `timeoutMs` — callers treat that as transient/abort. */
async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ res: Response; data: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, data };
  } finally {
    clearTimeout(to);
  }
}

function channelSet(channels: Session['channels']): Set<string> {
  if (!channels) return new Set();
  const list = Array.isArray(channels) ? channels : String(channels).split(/[,\s]+/);
  return new Set(list.map(c => c.trim().toLowerCase()).filter(Boolean));
}

/** Coerce a snapshot flag value into the string form fields expect. */
function numStr(v: unknown): string {
  return v === undefined || v === null || v === '' ? '' : String(v);
}

/** Section heading. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-2">{children}</h3>;
}

/** Read-only label/value row. */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12px]">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-300 truncate font-mono text-[11px]" title={value}>{value}</span>
    </div>
  );
}

/** Disabled text field (P2 channel display). */
function StubField({ label, value }: { label: string; value?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500">{label}</span>
      <input
        type="text" disabled readOnly value={value ?? ''} placeholder="未配置"
        className="mt-0.5 w-full rounded-md border border-[#26262b] bg-[#0e0e10] px-2.5 py-1.5 text-[12px] text-gray-300 cursor-not-allowed disabled:opacity-100"
      />
    </label>
  );
}

/** Live controlled toggle. */
function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between rounded-lg border border-[#26262b] bg-[#161618] px-3 py-2 text-sm text-gray-300 transition-colors ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-[#1c1c1f]'}`}
    >
      <span className="text-left pr-3">{label}</span>
      <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-cyan-600' : 'bg-[#2a2a30]'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

/** Live controlled select. */
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 w-full appearance-none rounded-md border border-[#26262b] bg-[#161618] px-2.5 py-1.5 text-[12px] text-gray-200 hover:border-[#3a3a42] focus:border-cyan-600 focus:outline-none"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/** Live controlled numeric field (kept as string; coerced at save). */
function NumberField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        placeholder={placeholder ?? '默认'}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-md border border-[#26262b] bg-[#0e0e10] px-2.5 py-1.5 text-[12px] text-gray-200 focus:border-cyan-600 focus:outline-none"
      />
    </label>
  );
}

export function NodeSettingsPanel({ session: s, onClose }: { session: Session; onClose: () => void }) {
  const active = channelSet(s.channels);
  const runtime = s.runtime || '—';
  const initialModel = s.model || s.agent || '';
  // imageCapable: read-only, auto from model (MiniMax-M3 / Claude = yes).
  const imageCapable = /minimax-m3|claude/i.test(initialModel);
  // Model options for this runtime; always include the current value so a
  // server-set model outside the preset list stays selectable.
  const presetModels = RUNTIME_MODELS[runtime] || [];
  const modelOptions = Array.from(new Set([initialModel, ...presetModels].filter(Boolean)));

  const nodeKey = s.node_id || s.alias;

  // ---- Editable form state (B model + C flags) ----
  const [model, setModel] = useState(initialModel);
  const [flags, setFlags] = useState<FlagsForm>(DEFAULT_FLAGS);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  // ---- F3 apply lifecycle ----
  const [phase, setPhase] = useState<ApplyPhase>('idle');
  const [phaseMsg, setPhaseMsg] = useState('');
  const [phaseMock, setPhaseMock] = useState(false);
  // ---- M1 node lifecycle actions (restart wired to RFC-024 restart_node;
  // rename/stop/delete gated on backend → shown as 即将支持). Self-contained,
  // independent of the config apply lifecycle above.
  const [lcBusy, setLcBusy] = useState(false);
  const [lcResult, setLcResult] = useState<{ tone: 'info' | 'ok' | 'warn' | 'err'; text: string } | null>(null);
  // Outstanding lifecycle timers (mock progression, real poll, auto-dismiss);
  // cleared on unmount and at the start of each new save so a stale timer can't
  // overwrite a fresh result.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);
  const after = useCallback((ms: number, fn: () => void) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);
  // Avoid setState after unmount (panel closes mid-request).
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; clearTimers(); }, [clearTimers]);

  // Monotonic run id, bumped on every save. Each async lifecycle callback
  // captures the run id it belongs to and bails if a newer save superseded it —
  // this guards the callback that has ALREADY passed `await fetch` and so can't
  // be cancelled by clearTimers() (通信牛 review #11 blocker 1: stale poll
  // overwriting a fresh save).
  const applySeqRef = useRef(0);
  // "First terminal wins" within a run: once applied/rejected/timeout is set, a
  // late result can't overwrite it — this makes the 30s ceiling truly hard
  // (通信牛 review #11 blocker 2).
  const settledRef = useRef(false);
  const isCurrent = useCallback((runId: number) => mounted.current && runId === applySeqRef.current, []);
  const settle = useCallback((runId: number, apply: () => void) => {
    if (!isCurrent(runId) || settledRef.current) return;
    settledRef.current = true;
    apply();
  }, [isCurrent]);

  const setFlag = useCallback(<K extends keyof FlagsForm>(key: K, v: FlagsForm[K]) => {
    setFlags(f => ({ ...f, [key]: v }));
    setDirty(true);
  }, []);

  // Load current config on mount. Falls back to session-derived defaults when
  // the hub tool isn't deployed (route returns mock with empty flags).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/anet/node-config?node_id=${encodeURIComponent(nodeKey)}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !mounted.current) return;
        if (data?.model) setModel(String(data.model));
        const f = data?.flags && typeof data.flags === 'object' ? data.flags : {};
        setFlags({
          permissionMode: typeof f.permissionMode === 'string' && PERMISSION_MODES.includes(f.permissionMode) ? f.permissionMode : DEFAULT_FLAGS.permissionMode,
          dangerouslySkipPermissions: !!f.dangerouslySkipPermissions,
          teammateMode: !!f.teammateMode,
          maxTurns: numStr(f.maxTurns),
          budget: numStr(f.budget),
          timeout: numStr(f.timeout),
        });
      } catch {
        // keep defaults — Save still works (mock path) so the UI is reviewable
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nodeKey]);

  // Terminal "applied" state + auto-dismiss of the success strip.
  const finishApplied = useCallback((mock: boolean, runId: number) => {
    settle(runId, () => {
      setPhase('applied');
      setPhaseMock(mock);
      setPhaseMsg(mock ? '已应用（模拟 · 后端未接入，未真正下发）' : '配置已生效');
      after(SUCCESS_DISMISS_MS, () => {
        if (isCurrent(runId)) setPhase(p => (p === 'applied' ? 'idle' : p));
      });
    });
  }, [after, isCurrent, settle]);

  const markTimeout = useCallback((runId: number) => {
    settle(runId, () => {
      setPhase('timeout');
      setPhaseMsg('应用超时未确认，请稍后在节点详情核对');
    });
  }, [settle]);

  // Poll the real apply-status endpoint until terminal or timeout. `runId` ties
  // every callback to the save that started it; a newer save (or a settled
  // result) makes it bail before touching state.
  const pollApply = useCallback((applyId: string, startedAt: number, runId: number) => {
    after(APPLY_POLL_MS, async () => {
      if (!isCurrent(runId) || settledRef.current) return;
      let status: string | undefined;
      let detail: string | undefined;
      try {
        const { data } = await fetchJson(`/api/anet/node-config?apply_id=${encodeURIComponent(applyId)}`, { cache: 'no-store' }, FETCH_TIMEOUT_MS);
        status = data?.status as string | undefined;
        detail = data?.detail as string | undefined;
      } catch { /* transient / aborted — fall through to retry or timeout */ }
      // Re-check AFTER the await: a newer save may have superseded this poll.
      if (!isCurrent(runId) || settledRef.current) return;
      if (status === 'applied') { finishApplied(false, runId); return; }
      if (status === 'rejected') {
        settle(runId, () => {
          setPhase('rejected');
          setPhaseMsg(detail ? `应用被拒绝：${detail}` : '应用被拒绝');
        });
        return;
      }
      if (Date.now() - startedAt >= APPLY_TIMEOUT_MS) { markTimeout(runId); return; }
      pollApply(applyId, startedAt, runId); // still pending → keep polling
    });
  }, [after, finishApplied, isCurrent, markTimeout, settle]);

  async function handleSave() {
    clearTimers();                          // cancel any pending timers from a prior run
    const runId = ++applySeqRef.current;    // supersede any in-flight (post-await) callback
    settledRef.current = false;
    setPhase('saving');
    setPhaseMsg('');
    setPhaseMock(false);
    // Coerce numeric strings → numbers; drop blanks so unset fields aren't
    // forced to 0 on the backend.
    const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const payload = {
      node_id: nodeKey,
      model,
      flags: {
        permissionMode: flags.permissionMode,
        dangerouslySkipPermissions: flags.dangerouslySkipPermissions,
        teammateMode: flags.teammateMode,
        maxTurns: numOrUndef(flags.maxTurns),
        budget: numOrUndef(flags.budget),
        timeout: numOrUndef(flags.timeout),
      },
    };
    let data: { ok?: boolean; error?: string; mock?: boolean; applied?: boolean; status?: string; applyId?: string } = {};
    try {
      const r = await fetchJson('/api/anet/node-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, FETCH_TIMEOUT_MS);
      if (!isCurrent(runId)) return;        // a newer save started while this POST was in flight
      data = r.data as typeof data;
      if (!r.res.ok || data?.ok === false) {
        settledRef.current = true;
        setPhase('error');
        setPhaseMsg(data?.error ? `保存失败：${data.error}` : '保存失败');
        return;
      }
    } catch (e) {
      if (!isCurrent(runId)) return;
      settledRef.current = true;
      setPhase('error');
      setPhaseMsg(isAbort(e) ? '保存超时，请重试' : e instanceof Error ? `保存失败：${e.message}` : '保存失败');
      return;
    }

    // Save accepted — now drive the take-effect lifecycle.
    setDirty(false);
    const mock = !!(data.mock || data.applied === false);
    if (data.status === 'applied') { finishApplied(mock, runId); return; }
    if (data.status === 'rejected') { settle(runId, () => { setPhase('rejected'); setPhaseMsg('应用被拒绝'); }); return; }

    // Optimistic "applying" — node is restarting / taking the new config.
    setPhase('applying');
    setPhaseMock(mock);
    if (mock) {
      // Backend not live: simulate the apply so the lifecycle UI is reviewable.
      after(MOCK_APPLY_MS, () => finishApplied(true, runId));
    } else if (data.applyId) {
      // Hard 30s ceiling that fires regardless of whether a poll is in flight
      // or the hub proxy is hanging — `settle` makes the first terminal win, so
      // a late poll result can't reopen it (通信牛 review #11 blocker 2).
      after(APPLY_TIMEOUT_MS, () => markTimeout(runId));
      pollApply(data.applyId, Date.now(), runId);
    } else {
      // Real success with no applyId to poll → treat as applied.
      finishApplied(false, runId);
    }
  }

  async function handleRestart() {
    if (lcBusy) return;
    if (typeof window !== 'undefined' && !window.confirm(`重启节点「${s.alias}」？当前会话会中断，节点将以现有配置重新启动。`)) return;
    setLcBusy(true);
    setLcResult({ tone: 'info', text: '重启指令下发中…' });
    try {
      const r = await fetch('/api/anet/node-lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Pass the node's own network so multi-network users (whose default
        // network may differ from this node's) restart the right node.
        body: JSON.stringify({ node_id: nodeKey, action: 'restart', ...(s.network_id ? { network_id: s.network_id } : {}) }),
      });
      const data = await r.json().catch(() => ({}));
      if (!mounted.current) return;
      if (r.ok && data?.ok) {
        setLcResult({ tone: 'ok', text: '重启已下发，节点正在重启生效中…' });
      } else if (data?.unconfirmed) {
        setLcResult({ tone: 'warn', text: `后端工具未上线：${data?.error || 'restart_node 不可用'}` });
      } else {
        setLcResult({ tone: 'err', text: data?.error ? `重启失败：${data.error}` : '重启失败' });
      }
    } catch (e) {
      if (mounted.current) setLcResult({ tone: 'err', text: `重启失败：${e instanceof Error ? e.message : '网络错误'}` });
    } finally {
      if (mounted.current) setLcBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-label={`${s.alias} 节点设置`}
        className="fixed top-0 right-0 h-[100dvh] w-full sm:w-[440px] bg-[#0f0f11] border-l border-[#26262b] z-50 flex flex-col shadow-2xl shadow-black/60 animate-slide-in"
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#26262b]">
          <AliasAvatar alias={s.alias} size={26} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate" title={s.alias}>{s.alias}</div>
            <div className="text-[11px] text-gray-500">节点设置</div>
          </div>
          <button onClick={onClose} aria-label="关闭设置" className="inline-flex h-9 w-9 items-center justify-center text-gray-500 hover:text-white rounded-md hover:bg-white/5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* E. 基础信息（只读） */}
          <section>
            <SectionTitle>基础信息</SectionTitle>
            <div className="rounded-lg border border-[#26262b] bg-[#161618] divide-y divide-[#1c1c1f]">
              <InfoRow label="别名" value={s.alias} />
              <InfoRow label="node_id" value={s.node_id || '—'} />
              <InfoRow label="所属 network" value={s.network_id || '—'} />
              <InfoRow label="当前 session" value={s.session_id || '—'} />
              <InfoRow label="在线状态" value={s.status || '—'} />
            </div>
          </section>

          {/* B. Runtime + 模型 (model editable) */}
          <section>
            <SectionTitle>Runtime · 模型</SectionTitle>
            <div className="space-y-2.5">
              <div>
                <span className="text-[11px] text-gray-500">Runtime（只读）</span>
                <div className="mt-0.5 rounded-md border border-[#26262b] bg-[#0e0e10] px-2.5 py-1.5 text-[12px] text-gray-400 font-mono">{runtime}</div>
              </div>
              {modelOptions.length > 1 ? (
                <Select label="模型 / Preset" value={model} options={modelOptions} onChange={v => { setModel(v); setDirty(true); }} />
              ) : (
                <label className="block">
                  <span className="text-[11px] text-gray-500">模型 / Preset</span>
                  <input
                    type="text" value={model} onChange={e => { setModel(e.target.value); setDirty(true); }}
                    placeholder="未配置"
                    className="mt-0.5 w-full rounded-md border border-[#26262b] bg-[#0e0e10] px-2.5 py-1.5 text-[12px] text-gray-200 focus:border-cyan-600 focus:outline-none"
                  />
                </label>
              )}
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <span>图片能力 (imageCapable)</span>
                <span className={`px-1.5 py-0.5 rounded ${imageCapable ? 'bg-green-900/30 text-green-300' : 'bg-[#2a2a30] text-gray-400'}`}>
                  {imageCapable ? '支持' : '不支持'} · 只读
                </span>
              </div>
            </div>
          </section>

          {/* C. 运行模式 / flags (editable) */}
          <section>
            <SectionTitle>运行模式 · flags</SectionTitle>
            <div className="space-y-2">
              <Select
                label="权限模式 permissionMode"
                value={flags.permissionMode}
                options={PERMISSION_MODES}
                onChange={v => setFlag('permissionMode', v)}
              />
              <Toggle
                label="跳过权限确认 dangerouslySkipPermissions"
                checked={flags.dangerouslySkipPermissions}
                onChange={v => setFlag('dangerouslySkipPermissions', v)}
              />
              <Toggle
                label="团队模式 teammateMode"
                checked={flags.teammateMode}
                onChange={v => setFlag('teammateMode', v)}
              />
              <div className="grid grid-cols-3 gap-2 pt-0.5">
                <NumberField label="maxTurns" value={flags.maxTurns} onChange={v => setFlag('maxTurns', v)} />
                <NumberField label="budget" value={flags.budget} onChange={v => setFlag('budget', v)} />
                <NumberField label="timeout(s)" value={flags.timeout} onChange={v => setFlag('timeout', v)} />
              </div>
            </div>
          </section>

          {/* Save bar + F3 apply lifecycle (optimistic → restarting → ack) */}
          <section>
            {(() => {
              const busy = phase === 'saving' || phase === 'applying';
              const btnDisabled = loading || busy || !dirty;
              const btnLabel = phase === 'saving' ? '保存中…'
                : phase === 'applying' ? '应用中…'
                : loading ? '加载中…'
                : dirty ? '保存模型 / flags'
                : '无改动';
              return (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={btnDisabled}
                  className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    btnDisabled ? 'bg-[#1c1c1f] text-gray-600 cursor-not-allowed' : 'bg-cyan-600 text-white hover:bg-cyan-500'
                  }`}
                >
                  {busy && (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  )}
                  {btnLabel}
                </button>
              );
            })()}

            {/* Lifecycle status strip — the "toast" for the apply outcome. */}
            {phase !== 'idle' && (() => {
              const map: Record<Exclude<ApplyPhase, 'idle'>, { tone: string; icon: string; text: string }> = {
                saving:   { tone: 'border-[#26262b] bg-[#161618] text-gray-300', icon: '·', text: '正在提交配置…' },
                applying: { tone: 'border-cyan-800/50 bg-cyan-900/15 text-cyan-300', icon: '↻', text: '已下发，正在应用（节点重启生效中）…' },
                applied:  { tone: 'border-green-800/50 bg-green-900/15 text-green-300', icon: '✓', text: phaseMsg || '配置已生效' },
                rejected: { tone: 'border-red-800/50 bg-red-900/15 text-red-300', icon: '✗', text: phaseMsg || '应用被拒绝' },
                timeout:  { tone: 'border-amber-700/50 bg-amber-900/15 text-amber-300', icon: '⚠', text: phaseMsg || '应用超时未确认' },
                error:    { tone: 'border-red-800/50 bg-red-900/15 text-red-300', icon: '✗', text: phaseMsg || '保存失败' },
              };
              const v = map[phase];
              return (
                <div role="status" aria-live="polite" className={`mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] ${v.tone}`}>
                  <span className={`shrink-0 leading-5 ${phase === 'applying' ? 'inline-block animate-spin' : ''}`} aria-hidden>{v.icon}</span>
                  <span>{v.text}</span>
                </div>
              );
            })()}
            {phaseMock && (phase === 'applying' || phase === 'applied') && (
              <p className="mt-1 text-[10px] text-gray-600">后端工具未上线，应用流程为模拟演示（不会真正下发到节点）</p>
            )}
          </section>

          {/* A. 接入 Channel (P2 — display only) */}
          <section>
            <SectionTitle>接入 Channel</SectionTitle>
            <div className="space-y-2">
              {CHANNELS.map(ch => (
                <div key={ch.key} className={`rounded-lg border border-[#26262b] bg-[#161618] ${ch.roadmap ? 'opacity-50' : ''}`}>
                  <label className="flex items-center justify-between px-3 py-2 text-sm text-gray-300 cursor-not-allowed">
                    <span className="flex items-center gap-2">
                      {ch.label}
                      {ch.roadmap && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a30] text-gray-400">即将支持</span>}
                    </span>
                    <input type="checkbox" checked={!ch.roadmap && active.has(ch.key)} disabled readOnly className="h-4 w-4 accent-cyan-500 cursor-not-allowed" />
                  </label>
                  {!ch.roadmap && active.has(ch.key) && ch.fields.length > 0 && (
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-[#1c1c1f]">
                      {ch.fields.map(f => <StubField key={f.label} label={f.label} value={f.value} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-600">Channel 绑定为下一阶段（P2）· 当前仅展示，暂未接后端</p>
          </section>

          {/* D. 节点操作 (M1 lifecycle — restart wired to RFC-024 restart_node;
              rename/stop/delete gated on backend, shown as 即将支持). */}
          <section>
            <SectionTitle>节点操作</SectionTitle>
            <button
              type="button"
              onClick={handleRestart}
              disabled={lcBusy}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                lcBusy
                  ? 'border-[#26262b] bg-[#1c1c1f] text-gray-600 cursor-not-allowed'
                  : 'border-amber-700/50 bg-amber-900/15 text-amber-300 hover:bg-amber-900/25'
              }`}
            >
              {lcBusy && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              重启节点
            </button>
            {lcResult && (() => {
              const tone = lcResult.tone === 'ok' ? 'border-green-800/50 bg-green-900/15 text-green-300'
                : lcResult.tone === 'warn' ? 'border-amber-700/50 bg-amber-900/15 text-amber-300'
                : lcResult.tone === 'err' ? 'border-red-800/50 bg-red-900/15 text-red-300'
                : 'border-[#26262b] bg-[#161618] text-gray-300';
              return (
                <div role="status" aria-live="polite" className={`mt-2 rounded-lg border px-3 py-2 text-[12px] ${tone}`}>
                  {lcResult.text}
                </div>
              );
            })()}
            {/* Gated actions — backend not yet available (RFC-024 rename / RFC-027 stop+delete). */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[{ label: '重命名' }, { label: '停止' }, { label: '删除', danger: true }].map(op => (
                <div
                  key={op.label}
                  aria-disabled="true"
                  title="后端待上线"
                  className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[12px] cursor-not-allowed ${
                    op.danger ? 'border-red-900/30 bg-red-900/[0.06] text-red-300/55' : 'border-[#26262b] bg-[#161618] text-gray-500'
                  }`}
                >
                  {op.label}
                  <span className="text-[9px] px-1 py-0.5 rounded bg-[#2a2a30] text-gray-400">即将支持</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-600">重启已接入后端；重命名 / 停止 / 删除待后端（RFC-024 改名 · RFC-027 停止/删除）上线。</p>
          </section>
        </div>
      </div>

      <style jsx global>{`
        @keyframes node-settings-slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in { animation: node-settings-slide-in 0.2s ease-out; }
      `}</style>
    </>
  );
}
