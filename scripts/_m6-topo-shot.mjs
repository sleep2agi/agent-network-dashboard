import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
// Vincent's screenshot is desktop tree view; verify there AND on iPhone 13.
for (const [name, ctxOpts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['iphone13', { ...devices['iPhone 13'] }]]) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/?topo=1', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(5000);
  const recent = await page.locator('[data-topo-panel="recent"]').count();
  const legend = await page.locator('[data-topo-panel="legend"]').count();
  console.log(`${name}: recent-panel nodes=${recent} (want 0), legend=${legend}`);
  await page.screenshot({ path: `/tmp/anet-mobile-qa/m6-topo-${name}.png`, animations: 'disabled' });
  await ctx.close();
}
await browser.close();
