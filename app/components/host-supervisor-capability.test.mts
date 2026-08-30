// #1545 —— picker 里「创建能力」那一格的判定。
//
// 背景:daemon 从 #1353 起就在上报 can_create_nodes,hub 也一路存到
// /api/host-supervisors(这个组件读的就是它)—— 但此前**没有人念**,
// 于是 picker 照常把一台建不了节点的 daemon 列成可选,用户点了才发现。
//
// 🔴 这里测的不是"能不能渲染出字",是**「未知」和「不可用」有没有被分开**。
//    一个把两者都当成"坏了"的实现,在只检查"blocked 会不会禁用"的测试下全绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityPresentation, type CapabilityKind } from './HostSupervisorPicker.tsx';
import { describeCapability } from '@sleep2agi/agent-network/daemon-capability-display';

const NOW = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

test('daemon 说了不行 → 禁用 + 告警色', () => {
  const p = capabilityPresentation('blocked');
  assert.deepEqual(p, { disabled: true, tone: 'blocked' });
  assert.deepEqual(capabilityPresentation('blocked-age-unknown'), { disabled: true, tone: 'blocked' });
});

// 🔴 本文件最重要的一条。
test('🔴「没报过」不得被当成不可用 —— 不禁用,且色调不同', () => {
  const unknown = capabilityPresentation('never-reported');
  assert.equal(unknown.disabled, false, '拦下一台其实好好的机器,比让用户点一次更糟');
  assert.notEqual(unknown.tone, 'blocked', '未知不是告警');
  // 正控:blocked 确实是 true/blocked —— 证明上面两条不是恒真
  assert.equal(capabilityPresentation('blocked').disabled, true);
  assert.equal(capabilityPresentation('blocked').tone, 'blocked');
});

test('「可用但不知何时测的」同样不禁用(我们不知道它坏)', () => {
  assert.deepEqual(capabilityPresentation('ready-age-unknown'), { disabled: false, tone: 'unknown' });
});

test('ready → 不禁用 + 独立色调', () => {
  const p = capabilityPresentation('ready');
  assert.equal(p.disabled, false);
  assert.equal(p.tone, 'ready');
});

test('三种色调两两不同(否则三件不同的事会挤成同一种灰)', () => {
  const tones = (['blocked', 'never-reported', 'ready'] as const).map(k => capabilityPresentation(k).tone);
  assert.equal(new Set(tones).size, 3);
});

// ── 与 describeCapability 的接缝:kind 的取值必须都被覆盖到 ──
test('🔴 describeCapability 产出的每一个 kind 都在映射里有明确落点', () => {
  const rows = [
    { can_create_nodes: true, create_capability_observed_ms_ago: 0, last_seen_at: iso(NOW - 3000) },
    { can_create_nodes: false, create_nodes_blocked_reason: 'anet_bin_source',
      create_capability_observed_ms_ago: 0, last_seen_at: iso(NOW - 3000) },
    { can_create_nodes: true, last_seen_at: iso(NOW - 3000) },
    { can_create_nodes: false, create_nodes_blocked_reason: 'anet_bin_source', last_seen_at: iso(NOW - 3000) },
    { last_seen_at: iso(NOW - 3000) },
  ];
  const kinds = rows.map(r => describeCapability(r, NOW).kind);
  // 分母自证:这五行确实产出了五个**不同**的 kind。
  // 少一个,下面的覆盖检查就会在不知不觉中变松。
  assert.equal(new Set(kinds).size, 5, `实际 kinds=${JSON.stringify(kinds)}`);
  for (const k of kinds) {
    const p = capabilityPresentation(k as CapabilityKind);
    assert.ok(['blocked', 'unknown', 'ready'].includes(p.tone), `kind ${k} 落到了未知色调`);
  }
  // 且这五个 kind 里,**恰好两个**禁用(两种 blocked),其余不禁用
  const disabled = kinds.filter(k => capabilityPresentation(k as CapabilityKind).disabled);
  assert.equal(disabled.length, 2, `实际禁用的=${JSON.stringify(disabled)}`);
});
