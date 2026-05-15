/* Round 61 verification: legend rows also pin status filter on click.
 *  - Hovering still works (R55, transient release).
 *  - Clicking a row toggles pinnedStatus same as R60 pressure segments.
 *  - Pinned row's swatch gets an outer ring at r=8 (concentric, row colour).
 *  - Click same row again → release.
 *  - Sticky: pin survives mouse-move-away (vs R55 hover which clears).
 *  - The R60 pressure-segment pin and this share `pinnedStatus`, so
 *    clicking the legend then clicking the pressure-segment for a
 *    different status replaces (not stacks) the filter — verified by
 *    chain: legend.working → pressure.idle → only idle stays bright.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'wkr',  status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl1', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl2', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(500);

const opacities = () => page.evaluate(() => {
  const o = {};
  for (const a of ['wkr', 'idl1', 'idl2']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});

const before = await opacities();

// Click the WORKING legend row.
const workingLegend = page.locator('g[data-legend-status="working"]').first();
const workingExists = await workingLegend.count() > 0;
if (!workingExists) { console.log('❌ legend row[working] not found'); process.exit(1); }
await workingLegend.click({ force: true });
await page.waitForTimeout(250);
const afterPin = await opacities();

// Pin survives mouse move.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterMouseMove = await opacities();

// Pinned row should carry an aria-pressed=true.
const pinnedAria = await page.evaluate(() => {
  const g = document.querySelector('g[data-legend-status="working"]');
  return g?.getAttribute('aria-pressed');
});
// And a concentric r=8 ring exists inside it.
const pinnedRingExists = await page.evaluate(() => {
  const g = document.querySelector('g[data-legend-status="working"]');
  if (!g) return false;
  return [...g.querySelectorAll('circle')].some(c => c.getAttribute('r') === '8');
});

// Switch pin via pressure segment (idle) — should REPLACE, not stack.
const idleSeg = page.locator('[data-pressure-seg="idle"]').first();
await idleSeg.click({ force: true });
await page.waitForTimeout(250);
const afterSwitch = await opacities();

// And the legend pin should release (concentric ring gone from working).
const workingRingGone = await page.evaluate(() => {
  const g = document.querySelector('g[data-legend-status="working"]');
  if (!g) return true;
  return ![...g.querySelectorAll('circle')].some(c => c.getAttribute('r') === '8');
});

// Click idle legend again to release pin. The click ALSO triggers a
// mouseenter that sets hoveredStatus='idle', which would keep the
// filter active (activeStatus = hoveredStatus ?? pinnedStatus). Move
// the mouse away to clear the hover so we observe the pin-only state.
await page.locator('g[data-legend-status="idle"]').first().click({ force: true });
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterRelease = await opacities();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:           bright(before.wkr) && bright(before.idl1) && bright(before.idl2),
  legendPin_keepsWorking:    bright(afterPin.wkr),
  legendPin_dimsIdle:        dim(afterPin.idl1) && dim(afterPin.idl2),
  legendPin_survivesMouse:   bright(afterMouseMove.wkr) && dim(afterMouseMove.idl1),
  legendPin_ariaPressed:     pinnedAria === 'true',
  legendPin_ringRendered:    pinnedRingExists,
  pressureSwitch_replaces:   dim(afterSwitch.wkr) && bright(afterSwitch.idl1) && bright(afterSwitch.idl2),
  pressureSwitch_clearsLegendRing: workingRingGone,
  release_restoresAll:       bright(afterRelease.wkr) && bright(afterRelease.idl1),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend pin:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  afterPin=`, afterPin,
  `\n  afterMouseMove=`, afterMouseMove,
  `\n  afterSwitch=`, afterSwitch,
  `\n  afterRelease=`, afterRelease,
  `\n  pinnedAria=${pinnedAria} ringRendered=${pinnedRingExists} workingRingGone=${workingRingGone}`);
process.exit(ok ? 0 : 1);
