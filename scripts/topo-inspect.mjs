/* Verify triple-tier rendering by reading SVG node positions */
import { chromium } from 'playwright';

const TOKEN = process.env.LOOP_REVIEW_TOKEN;
const browser = await chromium.launch({ headless: true });

function makeFakeSession(index) {
  return {
    alias: `agent${index}号`,
    status: index % 5 === 0 ? 'working' : 'idle',
    network_id: 'default',
    created_at: '2026-05-13T00:00:00Z',
    updated_at: '2026-05-13T00:00:00Z',
    last_seen_at: '2026-05-13T00:00:00Z',
  };
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

await ctx.route('**/api/hub/status*', async (route) => {
  const response = await route.fetch();
  const body = await response.json();
  const real = body.sessions || [];
  const padded = [...real];
  while (padded.length < 25) padded.push(makeFakeSession(padded.length));
  await route.fulfill({ response, json: { ...body, sessions: padded } });
});

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('circle[r="26"]').length >= 20;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);

const data = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const cx = 500, cy = 330;
  const nodes = [...svg.querySelectorAll('circle[r="26"]')];
  const offline = [...svg.querySelectorAll('circle[r="18"]')];
  const dist = (c) => Math.round(Math.hypot(parseFloat(c.getAttribute('cx')) - cx, parseFloat(c.getAttribute('cy')) - cy));
  return {
    onlineCount: nodes.length,
    onlineRadii: nodes.map(dist).sort((a, b) => a - b),
    offlineCount: offline.length,
    offlineRadii: offline.map(dist).sort((a, b) => a - b),
  };
});

console.log(JSON.stringify(data, null, 2));
await browser.close();
