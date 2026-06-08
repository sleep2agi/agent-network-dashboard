/* R32 — verify /nodes search-as-magnifier on iPhone 13.
 * Shot 1: default (search closed) — magnifier visible top-right.
 * Shot 2: tap magnifier — input row reveals.
 * Shot 3: type a query — chip changes + filtered list. */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const page = await ctx.newPage();
// Visit overview once to give SWR a chance to warm caches, then go to /nodes.
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);
await page.goto('http://127.0.0.1:3000/nodes', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('button[aria-label="Open search"]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r32-nodes-closed.png', animations: 'disabled', fullPage: false });

await page.click('button[aria-label="Open search"]');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r32-nodes-open.png', animations: 'disabled', fullPage: false });

await page.fill('input[placeholder="Search nodes…"]', 'codex');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r32-nodes-typed.png', animations: 'disabled', fullPage: false });

console.log('R32 /nodes shots → r32-nodes-{closed,open,typed}.png');
await browser.close();
