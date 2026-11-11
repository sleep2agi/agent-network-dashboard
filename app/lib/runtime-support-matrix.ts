/**
 * Runtime 支持矩阵（静态表）— 只为「新建节点前查一下哪个 runtime 支持什么」。
 *
 * 数据来源（2026-11-11 抄录）：
 *   · 客户端 `agent-network-app/src/runtime-support.ts` 的 CATALOG
 *   · 该文件注明其格子对齐公开支持矩阵 https://www.anet.sh/guide/support-matrix
 *
 * 三条硬约束：
 *   ① 这是**静态表**，没有 Hub 实时接口；页面上必须显式标注「静态 · 可能滞后」
 *   ② 未验证一律显示「未验证」，不把未知画成支持
 *   ③ 与客户端数据可能漂移；改客户端时需同步本文件（已记在 #4561）
 */

export type SupportLevel = 'supported' | 'partial' | 'unsupported' | 'unverified' | 'na';

export type RuntimeId =
  | 'claude-agent-sdk'
  | 'codex-sdk'
  | 'grok-build-acp'
  | 'claude-code-cli'
  | 'codex-app-server'
  | 'grok-build-cli'
  | 'opencode-cli';

export type FeatureId =
  | 'hub_chat'
  | 'tui_copresence'
  | 'daemon_lifecycle'
  | 'adopt'
  | 'provider_config'
  | 'skills'
  | 'tokens'
  | 'steer'
  | 'long_task';

export const MATRIX_SOURCE = {
  label: '静态表 · 2026-11-11 抄录',
  from: '客户端 runtime-support.ts / anet.sh/guide/support-matrix',
  href: 'https://www.anet.sh/guide/support-matrix',
} as const;

export const RUNTIMES: Array<{ id: RuntimeId; label: string; maturity: 'stable' | 'preview' | 'experimental' }> = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', maturity: 'stable' },
  { id: 'codex-sdk', label: 'Codex SDK', maturity: 'stable' },
  { id: 'grok-build-acp', label: 'Grok ACP', maturity: 'stable' },
  { id: 'claude-code-cli', label: 'Claude Code CLI', maturity: 'stable' },
  { id: 'codex-app-server', label: 'Codex App Server', maturity: 'preview' },
  { id: 'grok-build-cli', label: 'Grok CLI', maturity: 'experimental' },
  { id: 'opencode-cli', label: 'OpenCode CLI', maturity: 'preview' },
];

export const FEATURES: Array<{ id: FeatureId; label: string }> = [
  { id: 'hub_chat', label: '中枢对话' },
  { id: 'tui_copresence', label: 'TUI 共存' },
  { id: 'daemon_lifecycle', label: '进程生命周期' },
  { id: 'adopt', label: '接管已有会话' },
  { id: 'provider_config', label: 'Provider 配置' },
  { id: 'skills', label: 'Skills' },
  { id: 'tokens', label: '令牌' },
  { id: 'steer', label: '打断/引导' },
  { id: 'long_task', label: '长时间任务' },
];

/** 与客户端 CATALOG 一致：默认未验证/不适用，逐项覆盖。 */
const DEFAULT_ROW: Record<FeatureId, SupportLevel> = {
  hub_chat: 'unverified',
  tui_copresence: 'na',
  daemon_lifecycle: 'unverified',
  adopt: 'unverified',
  provider_config: 'na',
  skills: 'unverified',
  tokens: 'unverified',
  steer: 'na',
  long_task: 'unverified',
};

const OVERRIDES: Record<RuntimeId, Partial<Record<FeatureId, SupportLevel>>> = {
  'claude-agent-sdk': { daemon_lifecycle: 'supported' },
  'codex-sdk': { daemon_lifecycle: 'supported', provider_config: 'partial' },
  'grok-build-acp': { daemon_lifecycle: 'supported' },
  'claude-code-cli': { tui_copresence: 'na', daemon_lifecycle: 'unverified' },
  'codex-app-server': {
    tui_copresence: 'supported',
    adopt: 'partial',
    provider_config: 'partial',
    steer: 'supported',
  },
  'grok-build-cli': {
    tui_copresence: 'partial',
    skills: 'unsupported',
    long_task: 'partial',
  },
  'opencode-cli': {
    tui_copresence: 'supported',
    provider_config: 'partial',
    long_task: 'unsupported',
  },
};

export function cellOf(runtime: RuntimeId, feature: FeatureId): SupportLevel {
  return OVERRIDES[runtime]?.[feature] ?? DEFAULT_ROW[feature];
}

export const LEVEL_STYLE: Record<SupportLevel, { text: string; label: string }> = {
  supported: { text: '✓', label: '已验证支持' },
  partial: { text: '◐', label: '部分支持' },
  unsupported: { text: '✕', label: '已验证不可用' },
  unverified: { text: '?', label: '未验证' },
  na: { text: '—', label: '不适用' },
};
