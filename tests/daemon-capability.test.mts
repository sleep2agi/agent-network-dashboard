// #1545 dashboard 侧 —— 三态渲染的语义锁。
//
// 🔴 这套断言与 agent-network-app 的 src/daemon-capability.test.ts **压的是同一套语义**。
//    两个仓之间没有共享包，那份模块是同语义的第二份实现；两边各有一套测试，
//    任何一边漂了都会红，而不是安静地分岔。
//
// 🔴 用 node:test 而不是 bun:test：tsconfig 收 `**/*.mts`，而 next build 会做类型检查
//    （next.config 没有 ignoreBuildErrors）——`bun:test` 没有类型声明，会让 CI 的
//    `npm run build` 红。仓里既有的 7 个 .test.mts 全部用 node:test，跟着仓走。
//    scripts/run-tests.mjs 认 node:test 与 bun:test 两种 import，都分派给 `bun test`。
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describeDaemonCapability, formatAge } from '../app/lib/daemon-capability.ts';

const NOW = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

// 🔴 两向见证：只验 blocked 那一侧的话，一个恒返回 blocked 的实现也会全绿。
const ready = describeDaemonCapability(
  { can_create_nodes: true, create_capability_observed_ms_ago: 0, last_seen_at: iso(NOW - 120_000) }, NOW);
const blocked = describeDaemonCapability(
  { can_create_nodes: false, create_nodes_blocked_reason: 'anet_bin_source',
    create_capability_observed_ms_ago: 0, last_seen_at: iso(NOW - 300_000) }, NOW);
const unknown = describeDaemonCapability({ last_seen_at: iso(NOW - 60_000) }, NOW);

test('#1545 三态 kind 互不相同', () => {
  assert.equal(new Set([ready.kind, blocked.kind, unknown.kind]).size, 3);
});
test('#1545 三态文案互不相同', () => {
  assert.equal(new Set([ready.label, blocked.label, unknown.label]).size, 3);
});
test('#1545 ready 侧真的是 ready，且说了多久以前测的', () => {
  assert.equal(ready.kind, 'ready');
  assert.ok(ready.label.includes('2m 前'), ready.label);
});
test('#1545 blocked 侧真的是 blocked，且说了多久以前测的', () => {
  assert.equal(blocked.kind, 'blocked');
  assert.ok(blocked.label.includes('5m 前'), blocked.label);
});
// 本模块存在的理由：undefined ≠ false。渲染成"不能建"会让人去修一台其实好好的
// 机器；渲染成"能建"是朝"没问题"说谎。它必须是第三种话。
test('#1545 从没报过 ⇒ unknown，既不是 ready 也不是 blocked', () => {
  assert.equal(unknown.kind, 'unknown');
});
test('#1545 unknown 说清了为什么，且版本代际带包名+完整号', () => {
  assert.ok(unknown.detail!.includes('agent-node'));
  assert.ok(unknown.detail!.includes('2.5.0-preview.55'));
  assert.ok(unknown.detail!.includes('重启'));
});
test('#1545 blocked 原样带出 reason code 并指向那台机器上的命令', () => {
  assert.ok(blocked.detail!.includes('anet_bin_source'));
  assert.ok(blocked.detail!.includes('anet doctor'));
});
test('#1545 缺 reason 仍是 blocked —— 兜底不朝「没问题」方向倒', () => {
  assert.equal(describeDaemonCapability({ can_create_nodes: false }, NOW).kind, 'blocked');
});

// 年龄：绝对年龄 = (now - last_seen_at) + observed_ms_ago。daemon 只给时长。
test('#1545 年龄两段都计入（60s 心跳延迟 + 60s 测量早于上报 = 2m）', () => {
  const v = describeDaemonCapability(
    { can_create_nodes: true, create_capability_observed_ms_ago: 60_000, last_seen_at: iso(NOW - 60_000) }, NOW);
  assert.equal(v.ageMs, 120_000);
  assert.ok(v.label.includes('2m 前'), v.label);
});
test('#1545 正控 —— 只算 observed 会得到不同的数，所以上面那条不是恒真', () => {
  assert.notEqual(formatAge(60_000), formatAge(120_000));
});
test('#1545 缺 observed ⇒ 年龄未知，不伪造 0', () => {
  const v = describeDaemonCapability({ can_create_nodes: true, last_seen_at: iso(NOW - 60_000) }, NOW);
  assert.equal(v.ageMs, undefined);
  assert.ok(!v.label.includes('前'), v.label);
  assert.ok(v.detail!.includes('开机只算一次'));
});
test('#1545 缺 last_seen_at ⇒ 同样年龄未知', () => {
  assert.equal(describeDaemonCapability(
    { can_create_nodes: true, create_capability_observed_ms_ago: 0 }, NOW).ageMs, undefined);
});
test('#1545 formatAge 不四舍五入到「刚刚」，各档位互不相同', () => {
  assert.equal(formatAge(500), '500ms 前');
  assert.equal(new Set([formatAge(500), formatAge(5_000), formatAge(300_000),
    formatAge(7_200_000), formatAge(200_000_000)]).size, 5);
});
test('#1545 负数/NaN 不假装知道', () => {
  assert.equal(formatAge(-1), '?');
  assert.equal(formatAge(NaN), '?');
});

// 不复制 CLI 的修法表 —— 做成会红的断言，不是一句注释。
test('#1545 模块里没有自造的修法命令', () => {
  const src = readFileSync(new URL('../app/lib/daemon-capability.ts', import.meta.url), 'utf8');
  const codeOnly = src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  assert.equal(/install -d|sudo tee|ANET_BIN_ABS=/.test(codeOnly), false);
});

// 链路：类型与渲染都接上了（源码级，防被 rebase 掉）。
test('#1545 route 的 DaemonRow 带上三个能力字段', () => {
  const route = readFileSync(new URL('../app/api/anet/host-supervisors/route.ts', import.meta.url), 'utf8');
  const block = route.match(/interface DaemonRow \{[\s\S]*?\n\}/)?.[0] || '';
  for (const f of ['can_create_nodes', 'create_nodes_blocked_reason', 'create_capability_observed_ms_ago']) {
    assert.ok(block.includes(f), `DaemonRow 缺 ${f}`);
  }
});
test('#1545 两处卡片都渲染 CapabilityLine（折叠卡 + 网格卡）', () => {
  const picker = readFileSync(new URL('../app/components/HostSupervisorPicker.tsx', import.meta.url), 'utf8');
  assert.equal((picker.match(/<CapabilityLine /g) || []).length, 2);
});
// 🔴 渲染必须是纯函数：时间戳由 picker 在取数那一刻定下，不在渲染里调 Date.now()
//    （eslint react-hooks/purity），且所有卡片用同一个基准。
test('#1545 CapabilityLine 不在渲染里取时间', () => {
  const picker = readFileSync(new URL('../app/components/HostSupervisorPicker.tsx', import.meta.url), 'utf8');
  const body = picker.slice(picker.indexOf('function CapabilityLine('));
  assert.ok(!body.slice(0, body.indexOf('\n}')).includes('Date.now()'));
  assert.ok(picker.includes('setLoadedAt(Date.now())'));
});
