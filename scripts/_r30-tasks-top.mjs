/* R30 verify shot — /tasks viewport-only (not fullPage) to dodge the
 * timeout on long task lists. Captures just what's above the fold
 * which is where the Suspense-fallback overlap bug lived. */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const page = await ctx.newPage();

// First shot: fast — catches the Suspense fallback
await page.goto('http://127.0.0.1:3000/tasks', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(120);
await page.screenshot({ path: '/tmp/anet-mobile-qa/tasks-suspense.png', animations: 'disabled', fullPage: false });

// Second shot: wait for hydration + filter row to be visible
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/anet-mobile-qa/tasks-loaded.png', animations: 'disabled', fullPage: false });

console.log('shots → /tmp/anet-mobile-qa/tasks-suspense.png + tasks-loaded.png');
await browser.close();
