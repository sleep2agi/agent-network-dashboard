/* Round 248 verification: two more theme-toggle snap closures:
 *
 *   1. Group box <rect> (#111 / R66): existing transition list
 *      'stroke + stroke-width + fill-opacity + filter 200ms' grows
 *      to include 'fill 200ms'. The rect's theme-driven fill
 *      (isLight ? slate-900 : indigo-300) no longer snaps.
 *
 *   2. Hub center core <circle> (the visual anchor at canvas
 *      centre, fill=isLight ? emerald-600 : emerald-500): had NO
 *      transition at all — most prominent element on canvas was
 *      flipping in one frame while everything around it eased.
 *      R248 adds inline 'fill 200ms ease-out' + data-topo-hub-
 *      core attr for test introspection.
 *
 * Test scope:
 *   - Hub core probe ([data-topo-hub-core]): present, has fill
 *     attribute, transition contains 'fill 200ms' (or 0.2s)
 *   - Group box probe ([data-group-label]) → climb to its
 *     <rect> sibling — needs grid layout + ≥2 prefix-shared
 *     aliases. Probe its style.transition for 'fill 200ms'
 *     alongside the existing R66 properties.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
// Hub core renders only in ring layout; group boxes only in grid.
// Two contexts back-to-back.
async function setupLayout(layout) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      sessionStorage.setItem('anet_v3_auth', '1');
      localStorage.setItem('anet-topo-layout', l);
    } catch {}
  }, layout);
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
    // 3 alpha-prefix + 1 delta — R106 cluster makes ONE alpha group box in grid
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha-1'), mk('alpha-2'), mk('alpha-3'), mk('delta'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForTimeout(400);
  return page;
}

// Scenario A: ring → hub core
const pageRing = await setupLayout('ring');
await pageRing.waitForSelector('[data-topo-hub-core]', { timeout: 10000, state: 'attached' });
const hub = await pageRing.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-core]');
  return el ? { fill: el.getAttribute('fill'), transition: el.style.transition } : null;
});
await pageRing.close();

// Scenario B: grid → group box <rect>
const pageGrid = await setupLayout('grid');
// Wait for group label (signals group box has been mounted alongside)
await pageGrid.waitForSelector('[data-group-label]', { timeout: 10000, state: 'attached' });
const groupBox = await pageGrid.evaluate(() => {
  const allRects = Array.from(document.querySelectorAll('rect'));
  const found = allRects.find(r => r.getAttribute('rx') === '14'
    && r.style && /fill\s+200ms/.test(r.style.transition || ''));
  return found ? { fill: found.getAttribute('fill'), transition: found.style.transition } : null;
});
await pageGrid.close();

const out = { hub, groupBox };
await browser.close();

const hasProp = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  hub_present:                 out.hub !== null,
  hub_has_fill_attr:           typeof out.hub?.fill === 'string' && out.hub.fill.length > 0,
  hub_transition_has_fill:     hasProp(out.hub?.transition, 'fill'),

  groupbox_present:            out.groupBox !== null,
  groupbox_has_fill_attr:      typeof out.groupBox?.fill === 'string' && out.groupBox.fill.length > 0,
  groupbox_transition_stroke:  hasProp(out.groupBox?.transition, 'stroke'),
  groupbox_transition_fill_op: hasProp(out.groupBox?.transition, 'fill-opacity'),
  groupbox_transition_filter:  hasProp(out.groupBox?.transition, 'filter'),
  groupbox_transition_fill:    hasProp(out.groupBox?.transition, 'fill'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} groupbox + hubcore ease:`, JSON.stringify(results),
  '\n  hub:     ', out.hub,
  '\n  groupBox:', out.groupBox);
process.exit(ok ? 0 : 1);
