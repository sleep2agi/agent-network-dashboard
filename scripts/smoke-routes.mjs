#!/usr/bin/env node
/**
 * 全站路由体检（手动跑，需要 app + Playwright）：
 *
 *   BASE_URL=http://localhost:3100 ANET_DASHBOARD_PASSWORD=xxx node scripts/smoke-routes.mjs
 *   THEMES=cyber,light node scripts/smoke-routes.mjs      # 默认两套主题
 *   ONLY=/nodes,/tasks node scripts/smoke-routes.mjs      # 只跑指定路由
 *
 * 为什么单独一个脚本：军团页有 smoke-legion 守着，但其余页面（节点/任务/消息/
 * 定时任务/SkillHub/服务器/Providers/设置/版本/组织/管理）没有回归网。今天
 * /settings/networks 就因为一条缺失字段整页崩过 —— 这类问题只会在真浏览器里暴露。
 *
 * 判定：HTTP 200/307 + 无 pageerror + 无 4xx/5xx 子资源（登录后不应有 401/500）。
 * 退出码 0/1。
 */

import { chromium } from 'playwright';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASSWORD = process.env.ANET_DASHBOARD_PASSWORD || 'admin123';
const THEMES = (process.env.THEMES || 'cyber,light').split(',').map(t => t.trim()).filter(Boolean);

const ALL_ROUTES = [
  '/', '/nodes', '/tasks', '/requirements', '/messages', '/scheduled-tasks',
  '/skillhub', '/servers', '/providers', '/versions', '/org', '/admin',
  '/settings', '/settings/tokens', '/settings/networks', '/legion', '/legion/3d', '/legion/plaza',
  '/node',
];
// 本地 stub Hub 没实现 /api/anet/*（真机才有），这些 5xx 不算页面问题。
// 本地 stub Hub 没实现的端点：/api/anet/*（真机才有）与 /api/hub/scheduled-tasks
// （stub 未实现，返回 401）。这两类 4xx/5xx 不算页面问题。
const IGNORE_5XX = (process.env.IGNORE_5XX || '/api/anet/,/api/hub/scheduled-tasks')
  .split(',').map(s => s.trim()).filter(Boolean);
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const ROUTES = ONLY.length ? ALL_ROUTES.filter(r => ONLY.includes(r)) : ALL_ROUTES;

const results = [];
const browser = await chromium.launch();

for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
  if (!login.ok()) {
    console.error(`login failed: ${login.status()} — 检查 ANET_DASHBOARD_PASSWORD / BASE_URL`);
    process.exit(2);
  }
  await ctx.addInitScript(t => localStorage.setItem('anet-theme', t), theme);
  const page = await ctx.newPage();

  for (const route of ROUTES) {
    const errs = [];
    const bad = [];
    const onErr = e => errs.push(e.message.slice(0, 140));
    const onRes = r => {
      const s = r.status();
      const u = r.url();
      const ignored = IGNORE_5XX.some(prefix => prefix && u.includes(prefix));
      if (s >= 400 && !ignored && !u.includes('/_next/webpack-hmr')) bad.push(`${s} ${u.replace(BASE, '').slice(0, 70)}`);
    };
    page.on('pageerror', onErr);
    page.on('response', onRes);
    let status = 0;
    try {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 });
      status = res?.status() ?? 0;
      await page.waitForTimeout(900);
    } catch (e) {
      errs.push(String(e).slice(0, 120));
    }
    page.off('pageerror', onErr);
    page.off('response', onRes);

    const crashed = await page.evaluate(() => {
      const t = document.body?.innerText ?? '';
      return t.includes("This page couldn't load") || t.includes('Application error');
    }).catch(() => false);

    const ok = (status === 200 || status === 307) && errs.length === 0 && bad.length === 0 && !crashed;
    results.push({ theme, route, status, ok, errs, bad, crashed });
  }
  await ctx.close();
}

await browser.close();

for (const r of results) {
  if (r.ok) {
    console.log(`✓ [${r.theme}] ${r.route}`);
  } else {
    console.log(`✗ [${r.theme}] ${r.route} status=${r.status} crashed=${r.crashed}`);
    for (const e of r.errs.slice(0, 3)) console.log(`    err: ${e}`);
    for (const b of r.bad.slice(0, 3)) console.log(`    res: ${b}`);
  }
}

const failed = results.filter(r => !r.ok);
console.log(
  failed.length === 0
    ? `\nsmoke-routes: ✓ ${results.length} 项通过（${THEMES.join('+')}）`
    : `\nsmoke-routes: ${failed.length} 项失败 / ${results.length}`,
);
process.exit(failed.length === 0 ? 0 : 1);
