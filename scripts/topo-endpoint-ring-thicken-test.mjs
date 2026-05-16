/* Round 233 verification: edge endpoint ring (R111/R182) gains a
 * stroke-width thicken (1.6 → 2.4) on edge hover, completing the
 * hover-elevation gesture across the whole edge surface.
 *
 * Test scope:
 *   - Rest state (no edge hovered): every endpoint ring has
 *     stroke-width=1.6, data-edge-endpoint-active='false', opacity=0
 *   - Transition wiring: style.transition includes 'stroke-width
 *     180ms', so when isEndpoint flips the value eases (not snaps)
 *   - Hover state (dispatched mouseenter on edge hitbox): the two
 *     endpoint nodes' rings flip to stroke-width=2.4, data-edge-
 *     endpoint-active='true', and opacity > 0
 *
 * Scenario: 4 working agents + 1 flow alpha→beta count=5 so a
 * single edge is present with two well-defined endpoints.
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
const now = Date.now();
const msgs = [];
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-endpoint-ring]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probeAll = (page) => page.evaluate(() => {
  const rings = Array.from(document.querySelectorAll('[data-edge-endpoint-ring]'));
  return rings.map((r) => ({
    active:     r.getAttribute('data-edge-endpoint-active'),
    strokeAttr: r.getAttribute('stroke-width'),
    strokeData: r.getAttribute('data-edge-endpoint-ring-stroke-width'),
    transition: r.style.transition,
    opacity:    parseFloat(r.getAttribute('opacity') || ''),
  }));
});

// Rest state ---
const rest = await probeAll(page);

// Hover state — recent-signal panel row also flips hoveredEdgeKey
// (see "Hover a row → set hoveredEdgeKey" comment in TopoGraph
// around line 5197). The row is a robust hover target — discrete
// rect bbox, plain HTML coords through the SVG. Hovering the row
// for the alpha→beta flow drives hoveredEdgeEndpoints = {alpha,
// beta}, which is exactly the test condition we need.
const recentRow = await page.locator('[data-recent-row]').first();
await recentRow.hover({ force: true });
await page.waitForTimeout(300);
const hover = await probeAll(page);

await browser.close();

const restAllInactive = rest.every(r => r.active === 'false');
const restStrokes     = rest.map(r => r.strokeAttr);
const restAll16       = restStrokes.every(s => s === '1.6');
const restTransition  = rest.every(r => /stroke-width\s+180ms/.test(r.transition || ''));

const hoverActiveCount = hover.filter(r => r.active === 'true').length;
const hoverActiveRings = hover.filter(r => r.active === 'true');
const hoverActiveStrokes = hoverActiveRings.map(r => r.strokeAttr);
const hoverActiveAll24 = hoverActiveStrokes.length > 0 && hoverActiveStrokes.every(s => s === '2.4');
const hoverActiveDataStr = hoverActiveRings.every(r => r.strokeData === '2.4');
const hoverActiveOpacityHigh = hoverActiveRings.every(r => r.opacity > 0.5);
const hoverInactiveStillStable = hover.filter(r => r.active === 'false').every(r => r.strokeAttr === '1.6');

const results = {
  rest_all_inactive:        restAllInactive,
  rest_all_stroke_16:       restAll16,
  rest_all_has_transition:  restTransition,
  hover_two_endpoints:      hoverActiveCount === 2,
  hover_active_stroke_24:   hoverActiveAll24,
  hover_data_attr_24:       hoverActiveDataStr,
  hover_active_opacity_hi:  hoverActiveOpacityHigh,
  hover_inactive_still_16:  hoverInactiveStillStable,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} endpoint ring thicken:`, JSON.stringify(results),
  '\n  rest:',  rest.map(r => ({ a: r.active, s: r.strokeAttr })),
  '\n  hover:', hover.map(r => ({ a: r.active, s: r.strokeAttr, o: r.opacity })));
process.exit(ok ? 0 : 1);
