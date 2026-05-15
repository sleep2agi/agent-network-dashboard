/* Round 74 verification: Cmd+K palette can toggle layout + fit canvas.
 * Same architecture as R69 — palette dispatches a window CustomEvent,
 * TopoGraph reduces it into state.
 *
 *  - Start in ring layout (default). Dispatch anet:topo-layout {toggle}
 *    → SVG re-renders in grid: zoom group's transform changes; no hub
 *    `<g data-topo-hub>` present (grid drops it).
 *  - Dispatch again → back to ring (hub re-appears).
 *  - Zoom in via keyboard `+` (3 times). Dispatch anet:topo-view {fit}
 *    → zoom transform returns to fitted state.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['a', 'b', 'c'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(500);

const readState = () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const hub = svg ? svg.querySelector('g[data-topo-hub]') : null;
  let zoomTransform = null;
  if (svg) {
    for (const g of svg.querySelectorAll(':scope > g')) {
      const t = g.getAttribute('transform') || '';
      if (t.includes('scale(')) { zoomTransform = t; break; }
    }
  }
  return {
    hubPresent: !!hub,
    layoutStorage: localStorage.getItem('anet-topo-layout'),
    transform: zoomTransform,
  };
});

const startState = await readState();   // ring → hub present

// Dispatch toggle → grid
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anet:topo-layout', { detail: { kind: 'toggle' } })));
await page.waitForTimeout(300);
const afterToggle1 = await readState();   // grid → hub gone

// Dispatch toggle again → ring
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anet:topo-layout', { detail: { kind: 'toggle' } })));
await page.waitForTimeout(300);
const afterToggle2 = await readState();   // ring → hub present

// Now test fit. Zoom in 3 times via `+` key.
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.waitForTimeout(200);
const zoomedState = await readState();

// Dispatch view fit
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anet:topo-view', { detail: { kind: 'fit' } })));
await page.waitForTimeout(250);
const afterFitState = await readState();

await browser.close();

const results = {
  start_ring_hubPresent:     startState.hubPresent === true,
  start_storageRing:         startState.layoutStorage === 'ring',
  toggle1_gridHubAbsent:     afterToggle1.hubPresent === false,
  toggle1_storageGrid:       afterToggle1.layoutStorage === 'grid',
  toggle2_ringHubBack:       afterToggle2.hubPresent === true,
  toggle2_storageRing:       afterToggle2.layoutStorage === 'ring',
  zoom_transformChanged:     zoomedState.transform !== afterToggle2.transform,
  fit_transformReturnsToFit: afterFitState.transform !== zoomedState.transform,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} cmdk layout+view:`, JSON.stringify(results),
  `\n  start=`,        startState,
  `\n  toggle1=`,      afterToggle1,
  `\n  toggle2=`,      afterToggle2,
  `\n  zoomed=`,       zoomedState,
  `\n  afterFit=`,     afterFitState);
process.exit(ok ? 0 : 1);
