import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const fetches = [];
page.on('request', r => {
  const u = r.url();
  if (u.includes('/api/hub/messages')) fetches.push(new URL(u).searchParams.get('limit'));
});
await page.goto('http://127.0.0.1:3000/messages', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3500);
console.log('initial fetch limits:', [...new Set(fetches)].join(','));
// Viewport should land on the newest message, not the top of the page
const atTop = await page.evaluate(() => window.scrollY < 50);
console.log('landed at top of page (want false):', atTop);
const bubbles = await page.locator('.space-y-1 > div').count();
console.log('rendered timeline items:', bubbles);
// Tap "Load earlier" twice
for (let i = 0; i < 2; i++) {
  const btn = page.locator('text=Load earlier messages');
  if (await btn.count()) { await btn.scrollIntoViewIfNeeded(); await btn.click(); await page.waitForTimeout(2500); }
}
console.log('after 2× load-earlier:', [...new Set(fetches)].join(','));
await page.screenshot({ path: '/tmp/anet-mobile-qa/m5-messages.png', animations: 'disabled' });
await browser.close();
