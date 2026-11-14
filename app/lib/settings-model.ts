// Settings information architecture — data separated from the page so the
// ordering invariant and the "no dead links" invariant can be asserted in
// tests (a settings page shipped with a link to a non-existent route before).
//
// Group order mirrors the desktop client's `src/settings-model.ts`
// (账号 → 用户管理 → Agent 组织架构 → 本地 Hub → 外观 → 通知 → 快捷键 → 关于).
// Dashboard only ships the groups it can back with real data; 通知 / 语音输入 /
// 快捷键 三组客户端有、Dashboard 没有对应能力，不画假开关。

export interface SettingsSection {
  /** DOM anchor id, also the `data-settings-group` value. */
  id: string;
  label: string;
}

export interface SettingsLink {
  href: string;
  title: string;
  desc: string;
  action: string;
  /** 'team' → 成员与组织组；'resource' → 资源组。 */
  group: 'team' | 'resource';
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'account', label: '账号' },
  { id: 'connection', label: '连接' },
  { id: 'team', label: '团队' },
  { id: 'appearance', label: '外观' },
  { id: 'resources', label: '资源' },
  { id: 'about', label: '关于' },
];

export const SETTINGS_LINKS: SettingsLink[] = [
  { href: '/admin', title: '成员与访问权限', desc: '成员、可访问的 Agent 与授权。', action: '管理', group: 'team' },
  { href: '/org', title: '组织架构', desc: '部门层级、负责人与编制；也可以看军团图。', action: '打开', group: 'team' },
  { href: '/settings/tokens', title: 'API Token', desc: '创建与管理 CLI 访问用的 Token。', action: '管理', group: 'resource' },
  { href: '/settings/networks', title: '网络', desc: '创建、管理与删除 Agent 网络。', action: '管理', group: 'resource' },
  { href: '/providers', title: '模型 Provider', desc: '配置模型 Provider 与各服务器的可达性。', action: '管理', group: 'resource' },
  { href: '/messages', title: '消息', desc: '所有 Agent 的 CommHub 消息全局时间线。', action: '打开', group: 'resource' },
  { href: '/logs', title: '审计日志', desc: '登录鉴权、Token 轮换与管理操作记录。', action: '打开', group: 'resource' },
  { href: '/server-logs', title: '服务器日志', desc: 'CommHub 服务的实时 stdout / stderr。', action: '打开', group: 'resource' },
];

export const SETTINGS_THEMES = [
  { id: 'cyber', label: '深色', swatch: '#0b0b0d' },
  { id: 'light', label: '浅色', swatch: '#f6f7f9' },
  { id: 'slack', label: 'Slack 紫', swatch: '#3f0e40' },
  // 与客户端对齐：跟随操作系统的明暗偏好（web 走 prefers-color-scheme）。
  { id: 'system', label: '跟随系统', swatch: 'linear-gradient(135deg,#0b0b0d 0 50%,#f6f7f9 50% 100%)' },
] as const;

/** Client-aligned group order. Kept as a literal so a reorder is a test failure. */
export const SETTINGS_GROUP_ORDER = ['account', 'connection', 'team', 'appearance', 'resources', 'about'];
