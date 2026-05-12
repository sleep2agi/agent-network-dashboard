/* Captures the fold (viewport-only screenshot) for a given page so we
 * can inspect what the user actually sees on first paint. */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const OUT = path.resolve(process.cwd(), 'test-results/loop-review/folds');
mkdirSync(OUT, { recursive: true });

const targets = [
  { name: 'tasks-cyber-desktop', path: '/tasks', theme: 'cyber', w: 1440, h: 900 },
  { name: 'tasks-cyber-mobile',  path: '/tasks', theme: 'cyber', w: 390, h: 844 },
  { name: 'nodes-cyber-desktop', path: '/nodes', theme: 'cyber', w: 1440, h: 900 },
  { name: 'nodes-cyber-mobile',  path: '/nodes', theme: 'cyber', w: 390, h: 844 },
  { name: 'overview-cyber-desktop', path: '/', theme: 'cyber', w: 1440, h: 900 },
  { name: 'overview-light-desktop', path: '/', theme: 'light', w: 1440, h: 900 },
];

const browser = await chromium.launch({ headless: true });
for (const t of targets) {
  const ctx = await browser.newContext({ viewport: { width: t.w, height: t.h } });
  await ctx.addCookies([{
    name: 'anet_dashboard_session',
    value: `v3:${TOKEN}`,
    domain: '127.0.0.1', path: '/',
  }]);
  await ctx.addInitScript(theme => {
    try { localStorage.setItem('anet-theme', theme); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  }, t.theme);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:3000${t.path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), t.theme);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${t.name}.png`), fullPage: false, animations: 'disabled' });
  await ctx.close();
}
await browser.close();
console.log('captured', targets.length, 'fold-only screenshots to', OUT);
