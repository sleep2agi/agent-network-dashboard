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

/* ── 全站：skip link ──────────────────────────────────────────────── */
await page.goto(`${BASE}/legion/3d`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.evaluate(() => { const el = document.activeElement; if (el && el.blur) el.blur(); });
await page.keyboard.press('Tab');
const skipFirst = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const skipLanded = await page.evaluate(() => document.activeElement?.id);
skipFirst === 'skip-to-content' && skipLanded === 'anet-main-content'
  ? pass('skip link：Tab 一次到主内容', { skipFirst, skipLanded })
  : fail('skip link：Tab 一次到主内容', { skipFirst, skipLanded });

/* ── 3D ─────────────────────────────────────────────────────────── */
await page.waitForTimeout(400);

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

// ? 速查表：曾因全站 HelpOverlay 也绑 ? 而被抢走（弹出的不是本页那张）
await page.locator('[data-testid="legion-3d-stage"]').focus();
await page.keyboard.press('Shift+Slash');
await page.waitForTimeout(400);
const helpOwn = await page.getByTestId('legion-3d-help').count();
const globalHelp = await page.evaluate(() => document.body.innerText.includes('Open command palette'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const helpClosed = (await page.getByTestId('legion-3d-help').count()) === 0;
helpOwn === 1 && !globalHelp && helpClosed
  ? pass('3D ? 打开本页速查表（不被全站面板抢）', { helpOwn, globalHelp, helpClosed })
  : fail('3D ? 打开本页速查表（不被全站面板抢）', { helpOwn, globalHelp, helpClosed });

/* ── 2D ─────────────────────────────────────────────────────────── */
await page.goto(`${BASE}/legion`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
await page.getByTestId('legion-list-toggle').click();
await page.waitForTimeout(300);
const opts = page.getByTestId('legion-node-list').getByRole('option');
const count = await opts.count();
await opts.nth(count - 1).click();
await page.waitForTimeout(300);
// 第一次回车：只选中（列表内回车不跳页）；再按一次才打开
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
const landed = new URL(page.url()).pathname;
landed.startsWith('/nodes/') || landed === '/org'
  ? pass('2D 列表选中 + 回车打开', { counted: count, landed })
  : fail('2D 列表选中 + 回车打开', { counted: count, landed });

/* ── /org：部门聚焦深链 / 折叠 / 搜索 ───────────────────────────── */
const deptName = await page.evaluate(async () => {
  const res = await fetch('/api/hub/departments');
  if (!res.ok) return null;
  const j = await res.json();
  return j?.departments?.[0]?.name ?? null;
});
if (deptName) {
  await page.goto(`${BASE}/org?focus=${encodeURIComponent(deptName)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  const row = await page.evaluate((name) => {
    const el = document.querySelector(`[data-org-group="${name}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const bg = getComputedStyle(el).backgroundColor;
    return { top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= window.innerHeight, bg };
  }, deptName);
  row && row.inView && row.bg !== 'rgba(0, 0, 0, 0)'
    ? pass('/org focus 深链高亮并滚到可见', { deptName, row })
    : fail('/org focus 深链高亮并滚到可见', { deptName, row });

  const togglesBefore = await page.locator('button[aria-label*="的成员"]').count();
  const expandedBefore = await page.locator('button[aria-label*="的成员"][aria-expanded="true"]').count();
  const firstToggle = page.locator('button[aria-label*="的成员"]').first();
  const wasExpanded = (await firstToggle.getAttribute('aria-expanded')) === 'true';
  if (togglesBefore > 0) { await firstToggle.click(); await page.waitForTimeout(300); }
  const flipped = (await firstToggle.getAttribute('aria-expanded')) === 'true';
  // 小网络（≤8 人/部门）默认展开、大网络默认折叠，两种都允许；关键是点一下能翻转
  togglesBefore > 0 && flipped !== wasExpanded
    ? pass('/org 折叠可切换', { togglesBefore, wasExpanded, flipped })
    : fail('/org 折叠可切换', { togglesBefore, wasExpanded, flipped });

  const input = page.locator('input').first();
  const peopleCount = async () => page.evaluate(() => (document.body.innerText.match(/@\w+/g) || []).length);
  const beforeSearch = await peopleCount();
  await input.fill('zzz-不存在'); await input.press('Enter');
  await page.waitForTimeout(800);
  const afterSearch = await peopleCount();
  await input.fill(''); await input.press('Enter');
  await page.waitForTimeout(600);
  const afterClear = await peopleCount();
  beforeSearch > 0 && afterSearch === 0
    ? pass('/org 搜索过滤人员', { beforeSearch, afterSearch, afterClear })
    : fail('/org 搜索过滤人员', { beforeSearch, afterSearch, afterClear });
} else {
  fail('/org focus 深链高亮并滚到可见', '当前 Hub 没有部门树，跳过');
}

// 2D 的 ? 同样不被全站抢（先回到 /legion —— 上面几段已经跳到别的页了）
await page.goto(`${BASE}/legion`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
await page.evaluate(() => { const el = document.activeElement; if (el && el.blur) el.blur(); });
await page.waitForTimeout(300);
await page.keyboard.press('Shift+Slash');
await page.waitForTimeout(500);
const help2dOwn = await page.getByTestId('legion-help').count();
const globalHelp2d = await page.evaluate(() => document.body.innerText.includes('Open command palette'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
help2dOwn === 1 && !globalHelp2d
  ? pass('2D ? 打开本页速查表', { help2dOwn, globalHelp2d })
  : fail('2D ? 打开本页速查表', { help2dOwn, globalHelp2d });

// 375 窄屏：/org 的徽标与折叠按钮不把页面撑宽
await page.setViewportSize({ width: 375, height: 812 });
await page.goto(`${BASE}/org`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
narrowOverflow === 0 ? pass('375 /org 无横向溢出', { narrowOverflow }) : fail('375 /org 无横向溢出', { narrowOverflow });

// 375 /legion：列表与右侧详情面板不重叠、无横向溢出
await page.goto(`${BASE}/legion`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);
await page.getByTestId('legion-list-toggle').click();
await page.waitForTimeout(300);
const mobile2d = await page.evaluate(() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
  const list = rect('[data-testid="legion-node-list"]');
  const panel = rect('[data-testid="legion-panel"]');
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overlap: list && panel ? !(list.bottom < panel.top || list.top > panel.bottom) : null,
  };
});
mobile2d.overflow === 0 && mobile2d.overlap === false
  ? pass('375 2D 列表与详情面板不重叠', mobile2d)
  : fail('375 2D 列表与详情面板不重叠', mobile2d);

// 375 /legion/3d：列表打开时详情卡让位（互斥），提示条/图例也不叠
await page.goto(`${BASE}/legion/3d`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.getByTestId('legion-3d-list-toggle').click();
await page.waitForTimeout(400);
await page.getByTestId('legion-3d-node-list').getByRole('option').nth(1).click();
await page.waitForTimeout(600);
await page.getByTestId('legion-3d-list-toggle').click();
await page.waitForTimeout(400);
const mobile3d = await page.evaluate(() => {
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
  return {
    detail: rect('[data-testid="legion-3d-detail"]'),
    hint: rect('[data-testid="legion-3d-scale-hint"]'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
const noStack = mobile3d.overflow === 0
  && (!mobile3d.hint || mobile3d.hint.h === 0 || !mobile3d.detail || mobile3d.hint.bottom < mobile3d.detail.top);
noStack ? pass('375 3D 详情与提示条不重叠', mobile3d) : fail('375 3D 详情与提示条不重叠', mobile3d);

errors.length ? fail('无 pageerror', errors) : pass('无 pageerror');

await browser.close();

for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' ' + JSON.stringify(r.detail) : ''}`);
const failed = results.filter(r => !r.ok).length;
if (failed) {
  console.error(`smoke-legion: ${failed} 项失败 / ${results.length}`);
  process.exit(1);
}
console.log(`smoke-legion: ✓ ${results.length} 项全部通过`);
