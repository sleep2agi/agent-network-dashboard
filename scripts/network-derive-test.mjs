import { chromium } from 'playwright';
const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => { try { localStorage.setItem('anet-theme','cyber'); sessionStorage.setItem('anet_v3_auth','1'); } catch {} });
// simulate the #92 bug: /api/networks scope-limited to only "default"
await ctx.route('**/api/hub/networks*', async (route) => {
  await route.fulfill({ json: { ok: true, networks: [{ network_id: 'default', network_name: 'default', role: 'owner' }] } });
});
// see what real network_ids the sessions carry
const page = await ctx.newPage();
const apiRes = await page.goto('http://127.0.0.1:3000/api/hub/status', { waitUntil: 'domcontentloaded' });
const statusBody = await apiRes.json();
const realNetIds = [...new Set((statusBody.sessions||[]).map(s => s.network_id).filter(Boolean))];
console.log('real network_ids in sessions:', JSON.stringify(realNetIds));
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
// read the Sidebar network buttons
const sidebarNets = await page.evaluate(() => {
  const hdr = [...document.querySelectorAll('div')].find(d => d.textContent?.trim() === 'Networks');
  if (!hdr) return { error: 'no Networks header' };
  const list = hdr.nextElementSibling;
  return [...list.querySelectorAll('button')].map(b => b.textContent.trim());
});
console.log('Sidebar shows networks:', JSON.stringify(sidebarNets));
await browser.close();
console.log('done');
