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
await page.goto('http://127.0.0.1:3000/settings', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/anet-mobile-qa/f5-settings-1.png', animations: 'disabled', fullPage: false });
await page.evaluate(() => window.scrollBy(0, 700));
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/anet-mobile-qa/f5-settings-2.png', animations: 'disabled', fullPage: false });
console.log('S6 → settings light shots 1+2');
await browser.close();
