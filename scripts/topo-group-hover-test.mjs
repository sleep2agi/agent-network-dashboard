/* Round 18 verification: hovering a node in a multi-member group upgrades
 * the group-box to accent treatment (solid stroke, thicker, legendAccent
 * colour) and brightens the label; other groups dim to 0.28; resting
 * appearance unchanged. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.removeItem('anet-brand');
    localStorage.removeItem('anet-topo-view');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  // Two prefix groups (A站 / B站), each ≥2 members so groupBoxes renders.
  const aliases = ['A站红', 'A站蓝', 'A站绿', 'B站乙', 'B站丙', 'B站丁'];
  const sessions = aliases.map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('g[data-group]').length === 2;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);

const readGroup = key => page.evaluate(k => {
  const g = document.querySelector(`g[data-group="${k}"]`);
  if (!g) return null;
  const rect = g.querySelector('rect');
  const text = g.querySelector('text');
  return {
    opacity: parseFloat(getComputedStyle(g).opacity || '1'),
    stroke: rect.getAttribute('stroke'),
    strokeWidth: +rect.getAttribute('stroke-width'),
    strokeDasharray: rect.getAttribute('stroke-dasharray'),
    fillOpacity: rect.getAttribute('fill-opacity'),
    textFill: text.getAttribute('fill'),
  };
}, key);

// Resting state (no hover)
const restA = await readGroup('A站');
const restB = await readGroup('B站');

// Hover a node in group A站
await page.locator('g[data-node="A站红"]').hover();
await page.waitForTimeout(350); // allow the 200ms transition to settle

const hoverA = await readGroup('A站');
const hoverB = await readGroup('B站');

await browser.close();
const results = {
  restADashedThin:     restA?.strokeDasharray === '6 6' && restA?.strokeWidth === 1.5,
  restBDashedThin:     restB?.strokeDasharray === '6 6' && restB?.strokeWidth === 1.5,
  hoveredASolidThick:  hoverA?.strokeDasharray === 'none' && hoverA?.strokeWidth === 2,
  hoveredAAccentStroke: hoverA?.stroke === '#67e8f9', // dark legendAccent
  hoveredABrighterText: hoverA?.textFill === '#e5e7eb', // dark legendHeadline
  otherBDimmedOpacity: Math.abs((hoverB?.opacity ?? 1) - 0.28) < 0.02,
  otherBKeepsDashed: hoverB?.strokeDasharray === '6 6',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group hover linkage:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);
