import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
// Mock an empty fleet + zero tasks → first-run empty state
await page.route('**/api/hub/status', r => r.fulfill({ json: { sessions: [] } }));
await page.route('**/api/hub/tasks**', r => r.fulfill({ json: { tasks: [], count: 0 } }));
await page.route('**/api/hub/stats', r => r.fulfill({ json: { ok: true, tasks: { total: 0, by_status: [] }, nodes: { total: 0 } } }));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(3500);
const hint = await page.locator('text=appears here automatically').count();
await page.screenshot({ path: '/tmp/anet-mobile-qa/f6-empty.png', animations: 'disabled' });
console.log(`empty-fleet mock → expectation line visible: ${hint} (expect 1)`);
await browser.close();
