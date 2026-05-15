import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme','cyber'); sessionStorage.setItem('anet_v3_auth','1'); } catch {} });
await ctx.route('**/api/hub/networks*', async (route) => {
  await route.fulfill({ json: { ok: true, networks: [{ network_id: 'default', network_name: 'default', role: 'owner' }] } });
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
// crop the sidebar region
await page.screenshot({ path: '/tmp/anet-issue-50/network-derive.png', clip: { x: 0, y: 0, width: 230, height: 420 } });
await browser.close();
console.log('done');
