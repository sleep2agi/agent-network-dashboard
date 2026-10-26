#!/usr/bin/env node
/**
 * 军团两页的冒烟脚本（手动跑，需要 app + Playwright）：
 *   BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx node scripts/smoke-legion.mjs
 *
 * 覆盖这几轮真实踩过的坑：
 *   1. 画布尺寸（曾因初始化被 skip，新开页面 300×150 空白）
 *   2. 搜索命中 / 无结果 + 清空
 *   3. 部门聚焦（含镜头动）与「聚焦所在部门」
 *   4. 导出 PNG 必须是全分辨率（交互期 0.6× 不能导出）
 *   5. 2D 列表键盘选中 + 回车打开
 * 任何一项失败退出码 1。
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.ANET_DASHBOARD_PASSWORD || 'admin123';
const results = [];
const fail = (name, detail) => results.push({ name, ok: false, detail });
const pass = (name, detail) => results.push({ name, ok: true, detail });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
if (!login.ok()) {
  console.error(`login failed: ${login.status()}`);
  process.exit(2);
}
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

/* ── 3D ─────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/legion/3d`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let bright = 0;
  for (let i = 0; i < d.length; i += 4 * 29) if (d[i] + d[i + 1] + d[i + 2] > 300) bright++;
  return { w: c.width, h: c.height, bright };
});
canvas && canvas.w > 300 && canvas.bright > 50
  ? pass('3D 画布已渲染', canvas)
  : fail('3D 画布已渲染', canvas);

// 搜索：先命中，再无结果 + 清空
const search = page.getByTestId('legion-3d-search');
await search.fill('平台');
await page.waitForTimeout(400);
const hit = await page.evaluate(() => document.body.innerText.includes('个部门'));
await search.fill('zzz-不存在');
await page.waitForTimeout(400);
const noMatch = await page.evaluate(() => document.body.innerText.includes('没有匹配'));
const clear = page.getByRole('button', { name: '清空搜索' }).first();
if (await clear.count()) await clear.click();
await page.waitForTimeout(200);
const cleared = (await search.inputValue()) === '';
hit && noMatch && cleared ? pass('搜索命中 / 无结果 / 清空', { hit, noMatch, cleared }) : fail('搜索命中 / 无结果 / 清空', { hit, noMatch, cleared });

// 部门聚焦（用列表选第一个部门）
await page.getByTestId('legion-3d-list-toggle').click();
await page.waitForTimeout(300);
await page.getByTestId('legion-3d-node-list').getByRole('option').nth(1).click();
await page.waitForTimeout(400);
const focusBtn = page.getByRole('button', { name: '聚焦此部门' });
let focused = false;
if (await focusBtn.count()) {
  await focusBtn.click();
  await page.waitForTimeout(900);
  focused = await page.evaluate(() => document.body.innerText.includes('聚焦：'));
}
await page.getByTestId('legion-3d-list-toggle').click();
focused ? pass('部门聚焦', 'chip 出现') : fail('部门聚焦');

// 导出：必须在交互后仍导出全分辨率
const box = await page.locator('canvas').boundingBox();
await page.mouse.move(box.x + 500, box.y + 400);
for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByTestId('legion-3d-export').click(),
]);
const path = `${process.env.TMPDIR || '/tmp'}/legion-smoke-export.png`;
await download.saveAs(path);
const buf = readFileSync(path);
const pngW = buf.readUInt32BE(16);
pngW >= 1000 ? pass('导出全分辨率', { pngW }) : fail('导出全分辨率', { pngW });

/* ── 2D ─────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/legion`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.getByTestId('legion-list-toggle').click();
await page.waitForTimeout(300);
const opts = page.getByTestId('legion-node-list').getByRole('option');
const count = await opts.count();
await opts.nth(count - 1).click();
await page.waitForTimeout(300);
// 焦点停在列表项上直接回车：页面用捕获阶段处理，不需要先点空白
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
const landed = new URL(page.url()).pathname;
landed.startsWith('/nodes/') || landed === '/org'
  ? pass('2D 列表选中 + 回车打开', { counted: count, landed })
  : fail('2D 列表选中 + 回车打开', { counted: count, landed });

errors.length ? fail('无 pageerror', errors) : pass('无 pageerror');

await browser.close();

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' ' + JSON.stringify(r.detail) : ''}`);
const failed = results.filter(r => !r.ok).length;
if (failed) {
  console.error(`smoke-legion: ${failed} 项失败 / ${results.length}`);
  process.exit(1);
}
console.log(`smoke-legion: ✓ ${results.length} 项全部通过`);
