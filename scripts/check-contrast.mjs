#!/usr/bin/env node
/**
 * 对比度体检 —— 把「小字看不清」变成可复跑的数字。
 *
 * 为什么需要它：前几轮修 `--fg-dim`、浅色主题 accent 时，我是靠临时脚本
 * 在浏览器里扫叶子文本、按 WCAG 阈值（大字 3:1、其余 4.5:1）算比值。
 * 那个脚本留在 /tmp 里就会烂掉，下次改色系又得重写一遍。
 *
 * 用法（需要先起 dev/prod，并装好 Playwright 浏览器）：
 *   BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx node scripts/check-contrast.mjs
 *
 * 说明：
 *   - 只看「叶子文本」（没有子元素的节点），避免父容器重复计数；
 *   - 跳过 display:none / visibility:hidden / opacity<0.4（装饰性分隔符、禁用态）；
 *   - 背景取最近一个「不透明度 > 0.6」的祖先背景色，找不到就用 body；
 *   - 有违规时退出码 1，方便以后接进 CI 或 pre-push。
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.ANET_DASHBOARD_PASSWORD || 'admin123';
const THEMES = (process.env.THEMES || 'cyber,light').split(',').filter(Boolean);
const PAGES = (process.env.PAGES || '/,/nodes,/tasks,/messages,/versions,/settings,/legion,/legion/3d,/org,/scheduled-tasks,/providers,/skillhub').split(',').filter(Boolean);

const audit = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(',').map(v => parseFloat(v));
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => {
    let cur = el;
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.6) return c;
      cur = cur.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  };

  const bad = [];
  for (const el of document.querySelectorAll('p, span, a, button, label, h1, h2, h3, td, th, li, time, small, div')) {
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length > 120 || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.4) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    // 半透明前景是装饰（分隔符、水印），不是要读的文字
    if (fg.a < 0.5) continue;
    const bg = bgOf(el);
    const r = ratio(fg, bg);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (r < need) bad.push({ text: txt.slice(0, 32), ratio: +r.toFixed(2), need, size: Math.round(size), color: cs.color });
  }
  // 同一颜色/比值只报一次，够定位问题又不刷屏
  const seen = new Set();
  return bad.filter(b => { const k = `${b.ratio}|${b.color}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
if (!res.ok()) {
  console.error(`login failed: ${res.status()} — 检查 ANET_DASHBOARD_PASSWORD / BASE_URL`);
  process.exit(2);
}

const page = await ctx.newPage();
let total = 0;
for (const theme of THEMES) {
  await page.addInitScript(t => localStorage.setItem('anet-theme', t), theme);
  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(700);
    const bad = await page.evaluate(audit);
    if (bad.length) {
      total += bad.length;
      console.log(`\n[${theme}] ${path} — ${bad.length} 处不达标`);
      for (const b of bad) console.log(`  ${b.ratio}:1 (need ${b.need}) ${b.size}px  ${JSON.stringify(b.text)}  ${b.color}`);
    }
  }
}
await browser.close();

if (total > 0) {
  console.error(`\n对比度体检：${total} 处不达标`);
  process.exit(1);
}
console.log(`对比度体检通过：${THEMES.length} 个主题 × ${PAGES.length} 个页面，0 处不达标`);
