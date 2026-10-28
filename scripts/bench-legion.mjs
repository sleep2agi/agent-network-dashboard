#!/usr/bin/env node
/**
 * 军团 3D 帧率体检（手动跑，需要 app + 408 节点桩）：
 *
 *   # 终端 A：BIG2=1 node /tmp/opencode/dash-repro/stub-states.mjs
 *   # 终端 B：
 *   BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx node scripts/bench-legion.mjs
 *
 * 为什么单独跑：3D 的降级策略（标签预算、光晕、分辨率）是按节点数切的，
 * 一旦有人改动渲染路径，帧率会掉而构建/单测全绿。这里给出可对比的数字：
 * 静止 / 拖动 / 缩放 三段的 p50 / p95 帧间隔。
 *
 * 判定（headless 软件光栅环境，实测上限约 30–38fps）：
 *   三段 p95 ≤ 120ms、平均 fps ≥ 15、无 pageerror —— 阈值故意放宽到「只抓真回归」
 *   （例如渲染路径退化成几百毫秒一帧），不追单帧抖动。
 *   这组数字用于**相对回归**：改渲染路径前后对比同一台机器/同一浏览器；
 *   真实 GPU 浏览器会明显更高，不要拿它对外宣称 60fps。
 */

import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.ANET_DASHBOARD_PASSWORD || 'admin123';
const MS = Number(process.env.SAMPLE_MS || 2500);

const browser = await chromium.launch();
// 登录限流 10 次/15 分钟：频繁跑体检时用 STORAGE_STATE 复用已登录 cookie。
const STORAGE = process.env.STORAGE_STATE || '';
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  ...(STORAGE ? { storageState: STORAGE } : {}),
});
if (!STORAGE) {
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
  if (!login.ok()) {
    console.error(`login failed: ${login.status()} — 检查 ANET_DASHBOARD_PASSWORD / BASE_URL，或用 STORAGE_STATE 复用 cookie`);
    process.exit(2);
  }
}
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message.slice(0, 140)));

await page.goto(`${BASE}/legion/3d`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2600);

const stats = async () => page.evaluate(async (ms) => {
  const deltas = [];
  let last = performance.now();
  await new Promise(resolve => {
    const start = performance.now();
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  deltas.shift();
  const sorted = deltas.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const mean = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  return {
    frames: deltas.length,
    fps: Math.round(1000 / mean),
    p50: Math.round(q(0.5)),
    p95: Math.round(q(0.95)),
  };
}, MS);

const idle = await stats();

// 拖动：按住画布做圆周运动
const canvas = await page.locator('canvas').boundingBox();
await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
await page.mouse.down();
const dragPromise = (async () => {
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    await page.mouse.move(
      canvas.x + canvas.width / 2 + Math.cos(a) * 160,
      canvas.y + canvas.height / 2 + Math.sin(a) * 90,
    );
  }
})();
const dragging = await stats();
await dragPromise;
await page.mouse.up();
await page.waitForTimeout(400);

// 缩放：滚轮连续 8 格
await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
const wheelPromise = (async () => {
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
})();
const zooming = await stats();
await wheelPromise;

await browser.close();

console.log(JSON.stringify({ idle, dragging, zooming, errs }, null, 1));
const ok = [idle, dragging, zooming].every(s => s.p95 <= 120 && s.fps >= 15) && errs.length === 0;
console.log(ok
  ? `\nbench-legion: ✓ 静止 ${idle.fps}fps（p95 ${idle.p95}ms）/ 拖动 ${dragging.fps}fps（p95 ${dragging.p95}ms）/ 缩放 ${zooming.fps}fps（p95 ${zooming.p95}ms）`
  : `\nbench-legion: ✗ 有段落掉到阈值外或存在 pageerror`);
process.exit(ok ? 0 : 1);
