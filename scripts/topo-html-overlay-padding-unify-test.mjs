/* Round 261 verification: HTML overlay padding aligned with SVG corner
 * panel padding — chrome strip + minimap both at 16 CSS px from canvas
 * edges, matching the SVG corner panels at (16, 16) panel-translate.
 *
 * Pre-R261:
 *   SVG panels: 16 SVG units from edges (≈ 15 CSS px @ ~0.94× scale)
 *   chrome:     12 CSS px (bottom-3 right-3) — ~3px optical asymmetry
 *   minimap:    12 CSS px (right-3)         — same asymmetry
 *
 * Post-R261:
 *   chrome:  bottom-4 right-4 → 16 CSS px from container edges
 *   minimap: right-4          → 16 CSS px from container right edge
 *
 * 16 CSS px ≈ 17 SVG units, slightly tighter than the SVG 16-unit
 * inset due to render-scale rounding, but visually matches the SVG
 * panel padding so HTML overlays and SVG panels speak one inset
 * vocabulary.
 *
 * Test scope:
 *   1. Chrome strip's right edge sits at ~16 CSS px from container
 *      right edge (allow ±2 px sub-pixel slop).
 *   2. Chrome strip's bottom edge sits at ~16 CSS px from container
 *      bottom edge (±2 slop).
 *   3. Minimap (mounted after zoom-in × 3): right edge at ~16 CSS px.
 *   4. R255 chrome-strip semantic gap intact: fleet→view gap still ≥ 11.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome]',         { timeout: 10000 });
await page.waitForSelector('[data-topo-wrapper]',        { timeout: 10000 });
await page.waitForTimeout(300);

const beforeMinimap = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-topo-wrapper]');
  const chrome  = document.querySelector('[data-topo-chrome]');
  const fleet   = document.querySelector('[data-topo-chrome-fleet-group-trailer]');
  const view    = document.querySelector('[data-topo-chrome-view-group-leader]');
  const wrR = wrapper?.getBoundingClientRect() ?? null;
  const chR = chrome?.getBoundingClientRect()  ?? null;
  return {
    wrapperRight:  wrR ? wrR.right  : null,
    wrapperBottom: wrR ? wrR.bottom : null,
    chromeRight:   chR ? chR.right  : null,
    chromeBottom:  chR ? chR.bottom : null,
    fleetRight:    fleet ? fleet.getBoundingClientRect().right : null,
    viewLeft:      view  ? view.getBoundingClientRect().left   : null,
  };
});

// Zoom in to force minimap mount
for (let i = 0; i < 3; i++) {
  await page.locator('[data-topo-chrome-zoom-in]').click();
  await page.waitForTimeout(120);
}
await page.waitForSelector('[data-topo-minimap]', { timeout: 5000 });
await page.waitForTimeout(300);

const minimapProbe = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-topo-wrapper]');
  const mm      = document.querySelector('[data-topo-minimap]');
  const wrR = wrapper?.getBoundingClientRect() ?? null;
  const mmR = mm?.getBoundingClientRect()      ?? null;
  return {
    wrapperRight: wrR ? wrR.right : null,
    minimapRight: mmR ? mmR.right : null,
  };
});
await browser.close();

const chromeRightOffset  = (beforeMinimap.wrapperRight  != null && beforeMinimap.chromeRight  != null)
  ? (beforeMinimap.wrapperRight - beforeMinimap.chromeRight) : null;
const chromeBottomOffset = (beforeMinimap.wrapperBottom != null && beforeMinimap.chromeBottom != null)
  ? (beforeMinimap.wrapperBottom - beforeMinimap.chromeBottom) : null;
const minimapRightOffset = (minimapProbe.wrapperRight   != null && minimapProbe.minimapRight  != null)
  ? (minimapProbe.wrapperRight - minimapProbe.minimapRight) : null;
const fleetToViewGap     = (beforeMinimap.fleetRight    != null && beforeMinimap.viewLeft     != null)
  ? (beforeMinimap.viewLeft - beforeMinimap.fleetRight) : null;

const inWindow = (v, target, slop) => v != null && Math.abs(v - target) <= slop;

const results = {
  chrome_right_at_16:         inWindow(chromeRightOffset,  16, 2),
  chrome_bottom_at_16:        inWindow(chromeBottomOffset, 16, 2),
  minimap_right_at_16:        inWindow(minimapRightOffset, 16, 2),
  r255_fleet_view_gap_intact: fleetToViewGap != null && fleetToViewGap >= 11,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} HTML overlay padding unify:`, JSON.stringify(results),
  '\n  chrome right offset:',  chromeRightOffset,  '/ bottom:', chromeBottomOffset,
  '\n  minimap right offset:', minimapRightOffset,
  '\n  R255 fleet→view gap:',  fleetToViewGap);
process.exit(ok ? 0 : 1);
