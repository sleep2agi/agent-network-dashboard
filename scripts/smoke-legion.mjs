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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
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

// 主题首帧：pre-paint 脚本要在 hydration 前就把 data-theme 设好（不许闪白/报 hydration）
const themeHydration = [];
page.on('console', m => { const t = m.text(); if (/hydrat|did not match/i.test(t)) themeHydration.push(t.slice(0, 80)); });
await page.evaluate(() => localStorage.setItem('anet-theme', 'light'));
await page.goto(`${BASE}/legion`, { waitUntil: 'domcontentloaded' });
const themeAtFirstPaint = await page.evaluate(() => document.documentElement.dataset.theme);
await page.evaluate(() => localStorage.setItem('anet-theme', 'cyber'));
await page.waitForTimeout(800);
themeAtFirstPaint === 'light' && themeHydration.length === 0
  ? pass('主题在 hydration 前生效且无 hydration 警告', { themeAtFirstPaint })
  : fail('主题在 hydration 前生效且无 hydration 警告', { themeAtFirstPaint, themeHydration });

// 回到 3D 页继续后面的断言（主题检查借用了这个 page）
await page.goto(`${BASE}/legion/3d`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

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

// 全屏演示：点一下铺满视口（会议室/PPT 用），再点一下退出
await page.getByTestId('legion-3d-fullscreen').click();
await page.waitForTimeout(700);
const fsOn = await page.evaluate(() => ({
  on: !!document.fullscreenElement && document.fullscreenElement.getAttribute('data-testid') === 'legion-3d-stage',
  canvas: (() => { const c = document.querySelector('canvas'); return c ? `${c.clientWidth}x${c.clientHeight}` : null; })(),
  label: document.querySelector('[data-testid="legion-3d-fullscreen"]')?.textContent ?? '',
}));
await page.getByTestId('legion-3d-fullscreen').click();
await page.waitForTimeout(700);
const fsOff = await page.evaluate(() => !!document.fullscreenElement);
fsOn.on && fsOn.label.includes('退出') && !fsOff
  ? pass('3D 全屏进入/退出', fsOn)
  : fail('3D 全屏进入/退出', { fsOn, fsOff });

// 净屏：界面全隐（含底部大规模提示），Esc 恢复
await page.getByTestId('legion-3d-clean').click();
await page.waitForTimeout(500);
const cleanOn = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="legion-3d-fullscreen"]');
  const hint = document.querySelector('[data-testid="legion-3d-scale-hint"]');
  return { ui: btn ? getComputedStyle(btn).visibility : null, hint: hint ? getComputedStyle(hint).display : null };
});
await page.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/legion-clean.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const cleanOff = await page.evaluate(() => {
  const btn = document.querySelector('[data-testid="legion-3d-fullscreen"]');
  return btn ? getComputedStyle(btn).visibility : null;
});
cleanOn.ui === 'hidden' && cleanOn.hint !== 'flex' && cleanOff === 'visible'
  ? pass('3D 净屏隐藏界面 / Esc 恢复', cleanOn)
  : fail('3D 净屏隐藏界面 / Esc 恢复', { cleanOn, cleanOff });

// 图例即筛选：点「运行中」→ 该图例进入按下态；Esc 清掉
await page.getByTestId('legion-3d-filter-working').click();
await page.waitForTimeout(400);
const filterOn = await page.getByTestId('legion-3d-filter-working').getAttribute('aria-pressed');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const filterOff = await page.getByTestId('legion-3d-filter-working').getAttribute('aria-pressed');
filterOn === 'true' && filterOff === 'false'
  ? pass('3D 图例可当状态筛选（Esc 清）', { filterOn, filterOff })
  : fail('3D 图例可当状态筛选（Esc 清）', { filterOn, filterOff });

// 图例上的数量必须和「N 个 Agent」对得上（避免把未上报算成空闲）
const legendSum = await page.evaluate(() => {
  const nums = [...document.querySelectorAll('[data-testid^="legion-3d-filter-"]')]
    .map(b => Number((b.textContent || '').replace(/\D+/g, '')))
    .filter(n => Number.isFinite(n));
  const total = Number(document.body.innerText.match(/(\d+) 个 Agent/)?.[1] ?? 0);
  return { sum: nums.reduce((a, c) => a + c, 0), total, buckets: nums.length };
});
legendSum.sum === legendSum.total && legendSum.buckets >= 4
  ? pass('3D 图例数量合计 = Agent 总数', legendSum)
  : fail('3D 图例数量合计 = Agent 总数', legendSum);

// 自动取景：默认视角要把整张图收进画面（以前 zoom 固定 1.12，只占画布 40%）。
// 小网络（stub 3 人）取景后应显著放大；R 重置视角后仍保持取景。
const zoomOf = async () =>
  Number(await page.getByTestId('legion-3d-stage').getAttribute('data-zoom').catch(() => '0') || 0);
const zoomFitted = await zoomOf();
await page.keyboard.press('r');
await page.waitForTimeout(600);
const zoomReset = await zoomOf();
zoomFitted >= 120 && zoomReset >= 120
  ? pass('3D 自动取景（首屏/重置后）', { zoomFitted, zoomReset })
  : fail('3D 自动取景（首屏/重置后）', { zoomFitted, zoomReset });

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
const pngH = buf.readUInt32BE(20);
pngW >= 1000 ? pass('导出全分辨率', { pngW }) : fail('导出全分辨率', { pngW });

// 导出图必须真的带标题栏与图例（不是一张裸 canvas）：
// 高度 = canvas + 头 + 尾，且顶部/底部条带里有非背景像素（文字/图例点）。
const canv = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return { w: c.width, h: c.height, cw: c.clientWidth };
});
const scale = canv.w / Math.max(1, canv.cw);
const head = Math.round(58 * scale);
const foot = Math.round(32 * scale);
const bands = await page.evaluate(async ({ b64, head, foot }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0);
  const count = (y0, y1) => {
    const h = Math.max(1, y1 - y0);
    const d = g.getImageData(0, y0, cv.width, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 5) if (d[i] + d[i + 1] + d[i + 2] > 150) n++;
    return n;
  };
  return { w: img.width, h: img.height, top: count(0, head), bottom: count(cv.height - foot, cv.height) };
}, { b64: buf.toString('base64'), head, foot });
const exportTail = pngH - canv.h;
exportTail >= head + foot - 2 && bands.top > 20 && bands.bottom > 10 && bands.w === pngW
  ? pass('导出带标题栏与图例', { exportTail, head, foot, top: bands.top, bottom: bands.bottom })
  : fail('导出带标题栏与图例', { exportTail, head, foot, top: bands.top, bottom: bands.bottom });

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

  // 3D 也要认同一个深链口径，而且不能把 ?focus= 抹掉（StrictMode 重跑 effect
  // 曾经把参数清空，链接分享出去就是空的）。
  await page.goto(`${BASE}/legion/3d?focus=${encodeURIComponent(deptName)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const deep3d = await page.evaluate((name) => {
    const kept = new URLSearchParams(location.search).get('focus');
    return {
      chip: document.body.innerText.includes('聚焦：') && document.body.innerText.includes(name),
      urlKept: kept === name,
    };
  }, deptName);
  deep3d.chip && deep3d.urlKept
    ? pass('3D 部门深链 ?focus= 生效且不被抹掉', deep3d)
    : fail('3D 部门深链 ?focus= 生效且不被抹掉', deep3d);

  // 节点级深链 + 复制分享链接：?node=<alias> 打开后直接选中该 Agent。
  const deepAgentAlias = await page.evaluate(async () => {
    const res = await fetch('/api/hub/people?limit=200&offset=0');
    if (!res.ok) return null;
    const j = await res.json();
    return j?.people?.find(p => p.agents?.length)?.agents?.[0]?.alias ?? null;
  });
  if (deepAgentAlias) {
    await page.goto(`${BASE}/legion/3d?node=${encodeURIComponent(deepAgentAlias)}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const nodeDeep = await page.evaluate((alias) => {
      const detail = document.querySelector('[data-testid="legion-3d-detail"]')?.textContent ?? '';
      return {
        selected: detail.includes(alias),
        urlKept: new URLSearchParams(location.search).get('node') === alias,
      };
    }, deepAgentAlias);
    nodeDeep.selected && nodeDeep.urlKept
      ? pass('3D 节点深链 ?node= 选中该 Agent', nodeDeep)
      : fail('3D 节点深链 ?node= 选中该 Agent', nodeDeep);

    await page.getByTestId('legion-3d-copy').click();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    copied.includes('/legion/3d?') && copied.includes('node=')
      ? pass('复制的是分享链接而非名字', { copied: copied.replace(/^https?:\/\/[^/]+/, '') })
      : fail('复制的是分享链接而非名字', { copied });

    // 2D 同口径：?node=<成员名> 打开后直接选中该成员
    const personName = await page.evaluate(async () => {
      const res = await fetch('/api/hub/people?limit=200&offset=0');
      if (!res.ok) return null;
      const j = await res.json();
      const p = j?.people?.[0];
      return p?.display_name || p?.username || null;
    });
    if (personName) {
      await page.goto(`${BASE}/legion?node=${encodeURIComponent(personName)}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
      const deep2d = await page.evaluate((name) => ({
        selected: (document.querySelector('[data-testid="legion-panel"]')?.textContent ?? '').includes(name),
        urlKept: new URLSearchParams(location.search).get('node') === name,
      }), personName);
      deep2d.selected && deep2d.urlKept
        ? pass('2D 节点深链 ?node= 选中该成员', deep2d)
        : fail('2D 节点深链 ?node= 选中该成员', deep2d);

      // 2D 详情卡也要能复制「可发人的地址」（和 3D 一致）
      const copy2d = page.getByRole('button', { name: /的分享链接/ }).first();
      if (await copy2d.count()) {
        await copy2d.click();
        await page.waitForTimeout(300);
        const clip2d = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
        clip2d.includes('/legion?') && clip2d.includes('node=')
          ? pass('2D 复制的是分享链接', { copied: clip2d.replace(/^https?:\/\/[^/]+/, '') })
          : fail('2D 复制的是分享链接', { copied: clip2d });
      }
    }
  }
  await page.goto(`${BASE}/org?focus=${encodeURIComponent(deptName)}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

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

// 2D 导出：必须是真的 2x PNG（曾经导出图圆心变黑、图例写死颜色）
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const [dl2d] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.getByTestId('legion-export').click(),
]);
const p2d = `${process.env.TMPDIR || '/tmp'}/legion-2d-smoke-export.png`;
await dl2d.saveAs(p2d);
const b2d = readFileSync(p2d);
const w2d = b2d.readUInt32BE(16);
const h2d = b2d.readUInt32BE(20);
w2d >= 1000 && h2d >= 600 && b2d.length > 20000
  ? pass('2D 导出 2x PNG', { w: w2d, h: h2d, bytes: b2d.length })
  : fail('2D 导出 2x PNG', { w: w2d, h: h2d, bytes: b2d.length });

// 2D 全屏（和 3D 同口径）：进入后页面根全屏，头部按钮仍可点退出
await page.getByTestId('legion-fullscreen').click();
await page.waitForTimeout(700);
const fs2dOn = await page.evaluate(() => ({
  on: !!document.fullscreenElement,
  label: document.querySelector('[data-testid="legion-fullscreen"]')?.textContent ?? '',
}));
await page.getByTestId('legion-fullscreen').click();
await page.waitForTimeout(700);
const fs2dOff = await page.evaluate(() => !!document.fullscreenElement);
fs2dOn.on && fs2dOn.label.includes('退出') && !fs2dOff
  ? pass('2D 全屏进入/退出', fs2dOn)
  : fail('2D 全屏进入/退出', { fs2dOn, fs2dOff });

// 2D 净屏：头部与右侧面板隐藏，Esc 恢复
await page.getByTestId('legion-clean').click();
await page.waitForTimeout(500);
const clean2dOn = await page.evaluate(() => {
  const h = document.querySelector('h1');
  const panel = document.querySelector('[data-testid="legion-panel"]');
  return {
    h: h ? getComputedStyle(h).visibility : null,
    panel: panel ? Math.round(panel.getBoundingClientRect().width) : null,
  };
});
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const clean2dOff = await page.evaluate(() => {
  const h = document.querySelector('h1');
  return h ? getComputedStyle(h).visibility : null;
});
clean2dOn.h === 'hidden' && clean2dOn.panel === 0 && clean2dOff === 'visible'
  ? pass('2D 净屏隐藏界面 / Esc 恢复', clean2dOn)
  : fail('2D 净屏隐藏界面 / Esc 恢复', { clean2dOn, clean2dOff });

// 2D 图例同样可筛选：点「运行中」→ 有节点被压到 0.18；Esc 清
const dim2d = () => page.evaluate(() => [...document.querySelectorAll('svg g[role="button"]')]
  .map(g => Number(getComputedStyle(g).opacity)).filter(v => Math.abs(v - 0.18) < 0.01).length);
await page.getByTestId('legion-filter-working').click();
await page.waitForTimeout(400);
const dimmedOn = await dim2d();
const pressed2d = await page.getByTestId('legion-filter-working').getAttribute('aria-pressed');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const dimmedOff = await dim2d();
dimmedOn > 0 && dimmedOff === 0 && pressed2d === 'true'
  ? pass('2D 图例可当状态筛选（Esc 清）', { dimmedOn, dimmedOff })
  : fail('2D 图例可当状态筛选（Esc 清）', { dimmedOn, dimmedOff, pressed2d });

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
