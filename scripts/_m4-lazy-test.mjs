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
  if (u.includes('/api/hub/tasks') && u.includes('to_name')) fetches.push(new URL(u).searchParams.get('limit'));
});
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3500);
const card = page.locator('.anet-agent-card').filter({ has: page.locator('span.font-semibold', { hasText: /^通信龙$/ }) }).first();
await card.scrollIntoViewIfNeeded();
await card.click();
await page.waitForTimeout(2500);
console.log('initial fetch limits:', fetches.join(','));
// Tap the "Load earlier messages" affordance twice
for (let i = 0; i < 2; i++) {
  const btn = page.locator('text=Load earlier messages');
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(2000); }
}
console.log('after 2× load-earlier:', fetches.join(','));
// Scroll the top row into view — also exercises the scroll-up trigger path
const topRow = page.locator('text=Load earlier messages');
if (await topRow.count()) { await topRow.scrollIntoViewIfNeeded(); await page.waitForTimeout(2500); }
console.log('after scroll-to-top:', fetches.join(','));
const ended = await page.locator('text=beginning of history').count();
console.log('beginning-of-history marker:', ended);
await page.screenshot({ path: '/tmp/anet-mobile-qa/m4-chat.png', animations: 'disabled' });
await browser.close();
