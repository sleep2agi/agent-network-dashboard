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
await page.waitForTimeout(3500);
await page.screenshot({ path: '/tmp/anet-mobile-qa/r45-overview.png', animations: 'disabled', fullPage: false });
const hasConfig = await page.locator('text=Local config').count();
console.log(`R45 → /tmp/anet-mobile-qa/r45-overview.png — Local config label present: ${hasConfig}`);
await browser.close();
