// `.615` 回归测试：无时区时间戳必须按 UTC 解析（今天最严重的 bug）
//
// 背景（2026-11-18）：CommHub 的时间戳形如 `2026-11-16T19:18:08`（带 T、无时区）。
// 裸 `Date.parse` 会按**浏览器本地时区**解释；本机 UTC+8 下整段时间偏移 8 小时，
// 导致「近 24 小时失败数」系统性少报（实测 200 → 162）。
//
// 这个 bug 靠人眼看数字是发现不了的（162 看起来完全合理），所以必须由单测钉住：
//   · 带 T 无时区 → 按 UTC
//   · 空格分隔无时区 → 按 UTC
//   · 显式 Z / ±HH:MM → 原样
//
// 纯函数，无需 React/Next，按仓里 .test.mts 惯例走 bun。
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHubTime } from '../app/lib/time.ts';
import { shortModel, shortServer } from '../app/lib/node-format.ts';

const expectUtc = (y: number, m: number, d: number, h: number, mi: number, s: number): number =>
  Date.UTC(y, m - 1, d, h, mi, s);

test('parseHubTime: 带 T 但无时区 → 按 UTC（今天的 8 小时 bug）', () => {
  const iso = '2026-11-16T19:18:08';
  assert.equal(parseHubTime(iso), expectUtc(2026, 11, 16, 19, 18, 8));
});

test('parseHubTime: 空格分隔无时区 → 按 UTC', () => {
  assert.equal(parseHubTime('2026-11-16 19:18:08'), expectUtc(2026, 11, 16, 19, 18, 8));
});

test('parseHubTime: 显式 Z 不受本地时区影响', () => {
  assert.equal(parseHubTime('2026-11-16T19:18:08Z'), expectUtc(2026, 11, 16, 19, 18, 8));
});

test('parseHubTime: 带偏移按偏移换算（+08:00 → 11:18Z）', () => {
  assert.equal(parseHubTime('2026-11-16T19:18:08+08:00'), expectUtc(2026, 11, 16, 11, 18, 8));
});

test('parseHubTime: 带毫秒也按 UTC', () => {
  assert.equal(parseHubTime('2026-11-16T19:18:08.123'), expectUtc(2026, 11, 16, 19, 18, 8) + 123);
});

test('parseHubTime: 空 / 不可解析 → null（不能返回 0，0 是 1970）', () => {
  assert.equal(parseHubTime(''), null);
  assert.equal(parseHubTime(null), null);
  assert.equal(parseHubTime(undefined), null);
  assert.equal(parseHubTime('not-a-date'), null);
});

test('shortModel: 去掉厂商前缀；没有模型时返回空串（调用方据此整段不渲染）', () => {
  assert.equal(shortModel('deepseek/deepseek-flash'), 'deepseek-flash');
  assert.equal(shortModel('openai/gpt-6.1-sol'), 'gpt-6.1-sol');
  assert.equal(shortModel('deepseek-flash'), 'deepseek-flash');
  assert.equal(shortModel(null), '');
  assert.equal(shortModel(undefined), '');
});

test('shortServer: 长主机名截断到 8 字符 + 省略号，短名原样', () => {
  assert.equal(shortServer('iZrj93pr2rcf5r2y9uo1oyZ'), 'iZrj93pr…');
  assert.equal(shortServer('short'), 'short');
  assert.equal(shortServer(null), '—');
});
