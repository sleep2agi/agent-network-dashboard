import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
// Simulate hub-down: fail the health probe at the network layer
await page.route('**/api/hub/health', route => route.abort());
await page.goto('http://127.0.0.1:3000/settings', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3500);
const visible = await page.locator('text=how to recover').count();
await page.locator('text=CommHub Connection').scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: '/tmp/anet-mobile-qa/f5-failpath.png', animations: 'disabled' });
console.log(`hub-down simulation → troubleshoot box visible: ${visible} (expect 1)`);
await browser.close();
