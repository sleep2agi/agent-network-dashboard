// `.616` 契约测试：把「未知不显示成 0」与「时间按本地显示」钉在源码里
//
// 为什么用静态契约：这两类问题的共同特征是"看起来合理"——
//   加载期显示 0 与"确实没有数据"在界面上长得一样；UTC 当本地显示只差 8 小时，
//   单看一个页面根本发现不了。它们无法用渲染测试稳定复现（需要构造加载中/时区环境），
//   因此按仓库惯例断言"关键分支与调用还在"，防止后续重构悄悄退回去。
//
// 覆盖（对应 2026-11-18 的 .610 / .614 / .615 / .616）：
//   ① hooks 暴露 loaded（data 是否到达），而不是只给 isLoading
//   ② /admin 与 /messages 用 !loaded 判定未就绪并显示 '—'
//   ③ /requirements 用 countText 在未就绪时显示 '—'
//   ④ 节点信息卡的时间字段走 formatHubTime（UTC 解析 + 本地格式化）
//   ⑤ formatHubTime 空值返回空串（不得变成 1970-01-01）
import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = new URL('..', import.meta.url);
const read = (p) => {
  const u = new URL(p, root);
  assert.ok(existsSync(u), `${p} 必须存在`);
  return readFileSync(u, 'utf8');
};

// ① hooks：loaded 语义
const hooks = read('app/lib/hooks.ts');
assert.ok(/loaded: data !== undefined/.test(hooks),
  'hooks 必须暴露 loaded = (data !== undefined) —— SSR 首帧 isLoading 为 false，只判 loading 会渲染出 0');

// ② /admin 与 /messages：未就绪显示 '—'
const admin = read('app/admin/page.tsx');
assert.ok(/const \{ sessions, loaded: sessionsLoaded \}/.test(admin),
  '/admin 必须用 loaded 判定未就绪');
assert.ok(/const notReady = !sessionsLoaded;/.test(admin),
  '/admin 必须把 notReady 建立在 loaded 上（而不是 isLoading）');
assert.ok(/'—'/.test(admin),
  '/admin 在线/离线在未就绪时必须显示 —');

const messages = read('app/messages/page.tsx');
assert.ok(/loaded: messagesLoaded/.test(messages),
  '/messages 必须取 loaded');
assert.ok(/!messagesLoaded/.test(messages),
  '/messages 计数胶囊必须在未就绪时显示占位，而不是 0');

// ③ /requirements：countText
const requirements = read('app/requirements/page.tsx');
assert.ok(/const countText =/.test(requirements) && /'—'/.test(requirements),
  '需求页状态计数在未就绪时必须显示 —（.610）');

// ④ 节点信息卡的时间字段必须走 formatHubTime
const nodePage = read('app/node/page.tsx');
assert.ok(/formatHubTime\(session\?\.last_seen_at\)/.test(nodePage),
  '「最后心跳」必须用 formatHubTime（UTC 解析 + 本地格式化）');
assert.ok(/formatHubTime\(session\?\.registered_at\)/.test(nodePage),
  '「注册时间」必须用 formatHubTime');
assert.ok(/formatHubTime\(session\?\.updated_at\)/.test(nodePage),
  '「更新时间」必须用 formatHubTime');

// ⑤ formatHubTime 的空值语义（读实现，行为由 time-parse.test.mts 覆盖）
const time = read('app/lib/time.ts');
assert.ok(/export function formatHubTime/.test(time),
  'lib/time.ts 必须提供 formatHubTime');
assert.ok(/if \(ms === null\) return '';/.test(time),
  'formatHubTime 对空/不可解析值必须返回空串（不得显示 1970）');

console.log('未知≠0 与本地时间契约：PASS（9 组断言）');
