/* R33 — verify /messages search-as-magnifier on iPhone 13. */
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
await page.goto('http://127.0.0.1:3000/messages', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('button[aria-label^="Open"]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r33-messages-closed.png', animations: 'disabled', fullPage: false });

await page.click('button[aria-label^="Open"]');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r33-messages-open.png', animations: 'disabled', fullPage: false });

await page.fill('input[placeholder^="Search from"]', 'Vincent');
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r33-messages-typed.png', animations: 'disabled', fullPage: false });

console.log('R33 /messages shots → r33-messages-{closed,open,typed}.png');
await browser.close();
