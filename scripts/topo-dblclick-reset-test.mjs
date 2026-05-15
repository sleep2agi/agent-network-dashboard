/* Round 41 verification: double-clicking empty canvas resets view to
 * {zoom:1, x:0, y:0}. Double-clicking a node does NOT reset (the
 * node's own onClick wins, and resetView should not fire). */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    localStorage.setItem('anet-topo-view', JSON.stringify({ zoom: 1, x: 0, y: 0 }));
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['a', 'b'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 30000 });
await page.waitForTimeout(500);

const readZoom = () => page.evaluate(() => {
  const span = document.querySelector('button[aria-label="Zoom in"]').parentElement.querySelector('span[title*="zoom level"]');
  return +span.textContent.replace('%', '');
});

// Zoom in a couple times via keyboard, then dbl-click empty canvas → expect reset to 100%.
await page.keyboard.press('=');
await page.keyboard.press('=');
await page.waitForTimeout(120);
const zoomedIn = await readZoom();

// Find empty-canvas coords: top-left area of the SVG, well outside node positions.
const box = await page.$eval('svg[viewBox="0 0 1000 680"]', el => el.getBoundingClientRect());
// y=0.35 is below the top-overlay panels (which sit at y<100 inside the SVG)
const emptyX = box.x + box.width * 0.20;
const emptyY = box.y + box.height * 0.40;
await page.mouse.dblclick(emptyX, emptyY);
await page.waitForTimeout(200);
const afterEmptyDbl = await readZoom();

// Now zoom in again and dbl-click a node — view should NOT reset.
await page.keyboard.press('=');
await page.keyboard.press('=');
await page.waitForTimeout(120);
const zoomedIn2 = await readZoom();
await page.locator('g[data-node="a"]').dblclick().catch(() => {});
await page.waitForTimeout(200);
const afterNodeDbl = await readZoom();

await browser.close();
const results = {
  zoomedInBeforeDbl: zoomedIn > 100,
  emptyCanvasResets:  afterEmptyDbl === 100,
  nodeDoesNotReset:   zoomedIn2 > 100 && afterNodeDbl === zoomedIn2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} dblclick reset:`, JSON.stringify(results),
  `\n  zoomedIn=${zoomedIn} afterEmptyDbl=${afterEmptyDbl} zoomedIn2=${zoomedIn2} afterNodeDbl=${afterNodeDbl}`);
process.exit(ok ? 0 : 1);
