'use client';

import { Session } from './types';
import { AliasAvatar } from './AliasAvatar';

/**
 * Per-node settings panel (issue #260, Vincent tg 2026-06-24).
 *
 * ⚠️ UI-ONLY STUB — demo scaffolding, NOT wired to any backend. Every
 * control is `disabled` / presentational; nothing issues a network request
 * and every action button (restart / stop / delete / …) is a deliberate
 * no-op. Hard red line (通信龙 Tier-gate): until the backend lands this
 * panel must never trigger a real node / hub action. Read-only fields just
 * mirror data already on the Session — display, never write.
 *
 * Field names + structure follow anet's real config.json (spec'd by 通信龙
 * 2026-06-25): config.channels / config.runtime / config.model / config.flags.
 * Sections: E 基础信息 → A 接入 Channel → B Runtime+模型 → C 运行模式 → D 运维.
 * Items marked 路线图 (e.g. wechat) are greyed "即将支持" — not faked as live.
 */

// A. Channel types. `roadmap: true` = not implemented yet (greyed). `fields`
// mirror `anet channel add <type>` params — shown disabled under each channel.
const CHANNELS: { key: string; label: string; roadmap?: boolean; fields: { label: string; value?: string; secret?: boolean }[] }[] = [
  {
    key: 'telegram', label: 'Telegram',
    fields: [
      { label: 'Bot Token', value: '••••••••••••', secret: true },
      { label: '允许的 chat id (allowFrom)', value: '—' },
      { label: '状态目录', value: '~/.anet/channels/telegram' },
    ],
  },
  {
    key: 'feishu', label: '飞书 Feishu',
    fields: [
      { label: 'App ID', value: 'cli_••••••' },
      { label: 'App Secret', value: '••••••••••••', secret: true },
      { label: '允许的 open_id (allowFrom)', value: '—' },
      { label: '允许的群 chat_id (allowChats)', value: '—' },
      { label: '群触发策略', value: 'mention' },
    ],
  },
  {
    key: 'commhub', label: 'CommHub',
    fields: [
      { label: 'Hub 地址', value: '<hub-address>' },
      { label: '节点 token（自动）', value: '••••••••', secret: true },
    ],
  },
  { key: 'wechat', label: 'WeChat', roadmap: true, fields: [] },
];

// B. Runtime → selectable model presets (from anet VENDORS, bin/cli.ts).
const RUNTIMES = ['claude-agent-sdk', 'claude-code-cli', 'codex-sdk', 'grok-build-acp'];
const RUNTIME_MODELS: Record<string, string[]> = {
  'claude-agent-sdk': ['deepseek-v4-pro', 'MiniMax-M3', 'MiniMax-M2.7', 'claude-sonnet-4-6', 'claude-opus-4-x', 'intern', 'mimo'],
  'claude-code-cli': ['（由 CLI 管理）'],
  'codex-sdk': ['gpt-5.5'],
  'grok-build-acp': ['grok-build'],
};

// C. Real config.flags (per 通信龙). permissionMode is a select; the rest toggles.
const PERMISSION_MODES = ['auto', 'default', 'bypassPermissions'];

// D. Node ops — all disabled stubs this round. `danger` styles the destructive ones.
const OPS: { label: string; danger?: boolean }[] = [
  { label: '重启节点', danger: true },
  { label: '停止节点' },
  { label: '查看日志' },
  { label: '重命名' },
  { label: '新开会话 (reset session)' },
  { label: '删除节点', danger: true },
];

function channelSet(channels: Session['channels']): Set<string> {
  if (!channels) return new Set();
  const list = Array.isArray(channels) ? channels : String(channels).split(/[,\s]+/);
  return new Set(list.map(c => c.trim().toLowerCase()).filter(Boolean));
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

/** Disabled text field — presentational only. */
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

/** Disabled visual toggle. */
function StubToggle({ label }: { label: string }) {
  return (
    <label className="flex items-center justify-between rounded-lg border border-[#26262b] bg-[#161618] px-3 py-2 text-sm text-gray-300 cursor-not-allowed">
      <span>{label}</span>
      <span className="relative inline-block h-5 w-9 rounded-full bg-[#2a2a30]">
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-gray-500" />
      </span>
    </label>
  );
}

/** Disabled select showing one current value. */
function StubSelect({ value }: { value: string }) {
  return (
    <select
      disabled defaultValue="cur"
      className="w-full appearance-none rounded-md border border-[#26262b] bg-[#161618] px-2.5 py-1.5 text-[12px] text-gray-300 cursor-not-allowed disabled:opacity-100"
    >
      <option value="cur">{value}</option>
    </select>
  );
}

export function NodeSettingsPanel({ session: s, onClose }: { session: Session; onClose: () => void }) {
  const active = channelSet(s.channels);
  const runtime = s.runtime || '—';
  const model = s.model || s.agent || '—';
  // imageCapable: read-only, auto from model (MiniMax-M3 / Claude = yes).
  const imageCapable = /minimax-m3|claude/i.test(model);
  const isCodex = /codex/i.test(runtime);
  const models = RUNTIME_MODELS[runtime] || [model];

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

        <div className="mx-4 mt-3 rounded-lg border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-300/90">
          演示占位 · 后端未接入，以下配置与操作暂不生效
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

          {/* A. 接入 Channel */}
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
                  {/* Per-channel secondary config — shown for active, non-roadmap channels. */}
                  {!ch.roadmap && active.has(ch.key) && ch.fields.length > 0 && (
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-[#1c1c1f]">
                      {ch.fields.map(f => <StubField key={f.label} label={f.label} value={f.value} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* B. Runtime + 模型 */}
          <section>
            <SectionTitle>Runtime · 模型</SectionTitle>
            <div className="space-y-2.5">
              <div>
                <span className="text-[11px] text-gray-500">Runtime</span>
                <div className="mt-0.5"><StubSelect value={runtime} /></div>
              </div>
              <div>
                <span className="text-[11px] text-gray-500">模型 / Preset</span>
                <div className="mt-0.5"><StubSelect value={model} /></div>
                {models.length > 1 && (
                  <p className="mt-1 text-[10px] text-gray-600 truncate" title={models.join(' · ')}>可选：{models.join(' · ')}</p>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <span>图片能力 (imageCapable)</span>
                <span className={`px-1.5 py-0.5 rounded ${imageCapable ? 'bg-green-900/30 text-green-300' : 'bg-[#2a2a30] text-gray-400'}`}>
                  {imageCapable ? '支持' : '不支持'} · 只读
                </span>
              </div>
            </div>
          </section>

          {/* C. 运行模式 / flags */}
          <section>
            <SectionTitle>运行模式 · flags</SectionTitle>
            <div className="space-y-2">
              <div>
                <span className="text-[11px] text-gray-500">权限模式 permissionMode</span>
                <div className="mt-0.5"><StubSelect value={PERMISSION_MODES[1]} /></div>
              </div>
              <StubToggle label="跳过权限确认 dangerouslySkipPermissions" />
              <StubToggle label="团队模式 teammateMode" />
              <StubToggle label="/loop 目标调度 (goalTickMs)" />
              {isCodex && (
                <>
                  <StubToggle label="codex: approvalPolicy = never" />
                  <StubToggle label="codex: sandboxMode = danger-full-access" />
                  <StubToggle label="codex: skipGitRepoCheck" />
                </>
              )}
            </div>
          </section>

          {/* D. 运维 */}
          <section>
            <SectionTitle>运维</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {OPS.map(op => (
                <button
                  key={op.label}
                  type="button"
                  // RED LINE: every op is a no-op until the backend lands (#260).
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
            <p className="mt-2 text-[11px] text-gray-600">演示占位 · 暂未接后端，点击不会执行任何操作</p>
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
