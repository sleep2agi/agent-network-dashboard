/* R35 — verify /server-logs WeChat-style search toggle at iPhone 13. */
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
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);
await page.goto('http://127.0.0.1:3000/server-logs', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('button[aria-label^="Open"]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r35-server-logs-closed.png', animations: 'disabled', fullPage: false });

await page.click('button[aria-label^="Open"]');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r35-server-logs-open.png', animations: 'disabled', fullPage: false });

console.log('R35 /server-logs shots → r35-server-logs-{closed,open}.png');
await browser.close();
