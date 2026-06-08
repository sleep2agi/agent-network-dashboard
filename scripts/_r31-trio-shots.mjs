/* R31 verify shot — /nodes, /messages, /admin viewport-only at iPhone 13. */
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

for (const p of [['/nodes', 'r31-nodes'], ['/messages', 'r31-messages'], ['/admin', 'r31-admin']]) {
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000' + p[0], { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/anet-mobile-qa/${p[1]}.png`, animations: 'disabled', fullPage: false });
  console.log(`${p[0]} → /tmp/anet-mobile-qa/${p[1]}.png`);
  await page.close();
}
await browser.close();
