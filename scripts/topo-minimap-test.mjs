/* Round 30 verification: minimap.
 *  - not mounted at default view (1×, centered)
 *  - mounted when zoomed in (one node dot per session, viewport rect)
 *  - click recenters the canvas (view.x / view.y change) */
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
  const sessions = ['A站', 'B站', 'C站', 'D站', 'E站', 'F站'].flatMap(g =>
    Array.from({ length: 3 }, (_, i) => ({
      alias: `${g}${i + 1}`, status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    })),
  );
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 30000 });
await page.waitForTimeout(500);

const minimap = '[data-topo-minimap]';
const notMountedAtDefault = (await page.locator(minimap).count()) === 0;

// Zoom in via `+` twice → view changes → minimap mounts
await page.keyboard.press('=');
await page.keyboard.press('=');
await page.waitForTimeout(200);
const mountedAfterZoom = (await page.locator(minimap).count()) === 1;
const dotCount = await page.locator(`${minimap} svg circle`).count();
const hasViewportRect = await page.locator(`${minimap} svg rect`).count() > 0;

// Click on the minimap's far left → expect view.x to become more positive (canvas pans right)
const beforeView = await page.evaluate(() => JSON.parse(localStorage.getItem('anet-topo-view')));
const mmBox = await page.locator(minimap).boundingBox();
await page.mouse.click(mmBox.x + 10, mmBox.y + mmBox.height / 2);
await page.waitForTimeout(200);
const afterView = await page.evaluate(() => JSON.parse(localStorage.getItem('anet-topo-view')));
const clickRecenters = afterView.x !== beforeView.x || afterView.y !== beforeView.y;

await browser.close();
const results = {
  notMountedAtDefault,
  mountedAfterZoom,
  oneDotPerSession: dotCount === 18, // 6 groups × 3 = 18 nodes
  viewportRectPresent: hasViewportRect,
  clickRecenters,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap:`, JSON.stringify(results), `dots=${dotCount} view before=`, beforeView, `after=`, afterView);
process.exit(ok ? 0 : 1);
