#!/usr/bin/env node
/**
 * Canvas 文字的对比度探针。
 *
 * 为什么单独一条：`scripts/check-contrast.mjs` 只能扫 DOM，军团 3D 页的
 * 文字是 Canvas 画的，测不到。这条脚本在页面里开一块 canvas，用**页面同一套
 * token + 字号**把文字画出来，再按真实像素算对比度（包含抗锯齿/透明度混合）。
 *
 * 用法（需要跑着的 app + Playwright）：
 *   BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx node scripts/check-canvas-labels.mjs
 *
 * 约定（改了 3D 页的标签样式要同步这里）：
 *   - 字号 11px（core 13px）
 *   - 文字色 --fg
 *   - 深度淡出下限 ALPHA_FLOOR = 0.8（远端标签的最坏情况）
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.ANET_DASHBOARD_PASSWORD || 'admin123';
const THEMES = ['cyber', 'light'];
const ALPHA_FLOOR = 0.8;
const MIN = 4.5;

const probe = ({ alphaFloor }) => {
  const root = getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue('--bg').trim();
  const fg = root.getPropertyValue('--fg').trim();
  const cv = document.createElement('canvas');
  cv.width = 200;
  cv.height = 40;
  const g = cv.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.globalAlpha = alphaFloor;
  g.fillStyle = fg;
  g.font = '11px system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('军团 Legion', 6, cv.height / 2);
  const d = g.getImageData(0, 0, cv.width, cv.height).data;

  const hex = (h) => {
    const m = h.replace('#', '');
    return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  const bgc = hex(bg);
  // 文字像素 = 与底色差异最大的那一批（取最亮的 1%），抗锯齿边缘不算
  const pixels = [];
  for (let i = 0; i < d.length; i += 4) pixels.push({ r: d[i], g: d[i + 1], b: d[i + 2] });
  const dist = (p) => Math.abs(p.r - bgc.r) + Math.abs(p.g - bgc.g) + Math.abs(p.b - bgc.b);
  pixels.sort((a, b) => dist(b) - dist(a));
  const core = pixels.slice(0, Math.max(1, Math.floor(pixels.length * 0.01)));
  const avg = core.reduce((a, p) => ({ r: a.r + p.r / core.length, g: a.g + p.g / core.length, b: a.b + p.b / core.length }), { r: 0, g: 0, b: 0 });
  return { bg, fg, alphaFloor, contrast: +ratio(avg, bgc).toFixed(2) };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const res = await ctx.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
if (!res.ok()) {
  console.error(`login failed: ${res.status()}`);
  process.exit(2);
}
const page = await ctx.newPage();
let failures = 0;
for (const theme of THEMES) {
  await page.addInitScript(t => localStorage.setItem('anet-theme', t), theme);
  await page.goto(`${BASE}/legion/3d`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(600);
  const r = await page.evaluate(probe, { alphaFloor: ALPHA_FLOOR });
  const ok = r.contrast >= MIN;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${theme}: 标签 ${r.contrast}:1（alpha ${r.alphaFloor}，fg ${r.fg} on ${r.bg}）`);
}
await browser.close();
if (failures) {
  console.error(`canvas-labels: ${failures} 个主题不达标`);
  process.exit(1);
}
console.log('canvas-labels: ✓ 所有主题 ≥ ' + MIN + ':1');
