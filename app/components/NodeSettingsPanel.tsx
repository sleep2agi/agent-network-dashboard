'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Session } from './types';
import { AliasAvatar } from './AliasAvatar';

/**
 * Per-node settings panel (issue #260 → v0.11 flagship #262, Vincent tg
 * 2026-06-24, "must actually work").
 *
 * STATUS (F2/F1, 通信龙 review round 2):
 *  - **Wired (real)**: B Runtime·模型 model select + C 运行模式 flags
 *    (permissionMode / dangerouslySkipPermissions / teammateMode / maxTurns /
 *    budget / timeout). These are controlled form state, loaded on mount from
 *    `GET /api/anet/node-config` and persisted via `POST` of the same. The six
 *    flags + model are the editable contract 通信龙 specified.
 *  - **Still P2 stub (disabled)**: A 接入 Channel (display-only) and D 运维
 *    ops buttons (no-op). These stay presentational until their backend lands;
 *    each carries its own local "暂未接后端" note so the removed top banner
 *    doesn't leave them looking live.
 *
 * ⚠️ The hub-side tool is not deployed yet (工程马 WIP): the route mock-falls
 * back with `mock: true`, and Save surfaces that honestly ("已保存（后端未接入·
 * 暂未真正下发）") rather than claiming a node restarted. Runtime + imageCapable
 * stay read-only (auto-derived). Field names mirror anet's real config.json.
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
const OPS: { label: string; danger?: boolean }[] = [
  { label: '重启节点', danger: true },
  { label: '停止节点' },
  { label: '查看日志' },
  { label: '重命名' },
  { label: '新开会话 (reset session)' },
  { label: '删除节点', danger: true },
];

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

type SaveState = 'idle' | 'saving' | 'saved' | 'mock' | 'error';

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
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  // Avoid setState after unmount (panel closes mid-request).
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

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

  async function handleSave() {
    setSaveState('saving');
    setSaveMsg('');
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
    try {
      const res = await fetch('/api/anet/node-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok || data?.ok === false) {
        setSaveState('error');
        setSaveMsg(data?.error ? `保存失败：${data.error}` : '保存失败');
        return;
      }
      setDirty(false);
      if (data?.mock || data?.applied === false) {
        // Honest: backend tool not live, so config wasn't actually pushed.
        setSaveState('mock');
        setSaveMsg('已保存（后端未接入 · 暂未真正下发到节点）');
      } else {
        setSaveState('saved');
        setSaveMsg('已保存，配置生效中…');
      }
    } catch (e) {
      if (!mounted.current) return;
      setSaveState('error');
      setSaveMsg(e instanceof Error ? `保存失败：${e.message}` : '保存失败');
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

          {/* Save bar (model + flags) */}
          <section>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saveState === 'saving' || !dirty}
              className={`w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                loading || saveState === 'saving' || !dirty
                  ? 'bg-[#1c1c1f] text-gray-600 cursor-not-allowed'
                  : 'bg-cyan-600 text-white hover:bg-cyan-500'
              }`}
            >
              {saveState === 'saving' ? '保存中…' : dirty ? '保存模型 / flags' : loading ? '加载中…' : '无改动'}
            </button>
            {saveMsg && (
              <p className={`mt-2 text-[11px] ${
                saveState === 'error' ? 'text-red-400' : saveState === 'mock' ? 'text-amber-300/90' : 'text-green-400'
              }`}>
                {saveMsg}
              </p>
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

          {/* D. 运维 (P2 — no-op) */}
          <section>
            <SectionTitle>运维</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {OPS.map(op => (
                <button
                  key={op.label}
                  type="button"
                  // RED LINE: ops stay no-ops until their backend lands (#260/#262 P2).
                  onClick={() => { /* UI stub — intentionally does nothing */ }}
                  className={`rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors ${
                    op.danger
                      ? 'border-red-800/50 bg-red-900/15 text-red-300 hover:bg-red-900/25'
                      : 'border-[#26262b] bg-[#161618] text-gray-300 hover:bg-[#1c1c1f]'
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-600">运维操作为下一阶段（P2）· 暂未接后端，点击不会执行任何操作</p>
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
