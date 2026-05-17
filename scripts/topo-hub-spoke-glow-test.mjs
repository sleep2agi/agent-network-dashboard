/* Round 533 verification: hub spokes gain drop-shadow glow on hub-hover
 * — drop-shadow visual-polish family 9th anchor.
 *
 * Test phases:
 *   1. rest: ALL spokes have data-topo-hub-spoke-glow='false',
 *            computed filter='none'
 *   2. hover hub (mouse.move to hub center per R527 banked path):
 *      ALL spokes have glow='true', filter matches drop-shadow with
 *      cyber cyan-400 hue
 *   3. transition list includes 'filter 250ms ease-out'
 *   4. source-side regex confirms filter ternary + transition wiring
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'), mk('a·3'), mk('a·4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-hub-spoke-glow]', { timeout: 15000 });
await page.waitForTimeout(800);

const readAll = async () => page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-topo-hub-spoke-glow]'));
  return els.map((el) => {
    const cs = getComputedStyle(el);
    return {
      glow:        el.getAttribute('data-topo-hub-spoke-glow'),
      filter:      cs.filter,
      transition:  cs.transition,
    };
  });
});

// Phase 1: rest
const rest = await readAll();

// Phase 2: hover hub (mouse.move to hub center — bbox of hub-highlight
// or hub spoke origin near canvas center). Use hub-highlight bbox per
// R527 banked path.
const hubBbox = await page.locator('[data-topo-hub-highlight]').first().boundingBox();
if (hubBbox) {
  await page.mouse.move(hubBbox.x + hubBbox.width / 2, hubBbox.y + hubBbox.height / 2);
}
await page.waitForTimeout(400);
const hover = await readAll();

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterTernary =
  /filter: !reducedMotion && hoveredHub\s+\? \(isLight\s+\? 'drop-shadow\(0 0 1\.5px rgba\(13, 148, 136, 0\.4\)\)'\s+: 'drop-shadow\(0 0 1\.5px rgba\(34, 211, 238, 0\.4\)\)'\)\s+: undefined,/.test(src);
const sourceAttrWired =
  /data-topo-hub-spoke-glow=\{!reducedMotion && hoveredHub \? 'true' : 'false'\}/.test(src);
const sourceTransitionExt =
  /transition: 'stroke 250ms ease-out, stroke-width 250ms ease-out, opacity 250ms ease-out, filter 250ms ease-out'/.test(src);

const restAllFalse = rest.length > 0 && rest.every((s) => s.glow === 'false');
const restAllFilterNone = rest.length > 0 && rest.every((s) => s.filter === 'none' || s.filter === '');
const hoverAllTrue = hover.length > 0 && hover.every((s) => s.glow === 'true');
const hoverAllFilterDS = hover.length > 0 && hover.every((s) =>
  /drop-shadow\(.+34,?\s*211,?\s*238/.test(s.filter || '')
);
const restTransitionHasFilter = rest.length > 0 && rest.every((s) =>
  /\bfilter\b/.test(s.transition || '')
);

const results = {
  spokes_present:            rest.length >= 3,  // 4 nodes → 4 spokes
  rest_all_glow_false:       restAllFalse,
  rest_all_filter_none:      restAllFilterNone,
  rest_transition_has_filter: restTransitionHasFilter,
  hover_all_glow_true:       hoverAllTrue,
  hover_all_filter_drop_shadow: hoverAllFilterDS,
  source_filter_ternary:     sourceFilterTernary,
  source_attr_wired:         sourceAttrWired,
  source_transition_ext:     sourceTransitionExt,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R533 hub-spoke hover-glow:`,
  JSON.stringify(results, null, 2),
  '\n  spoke count:', rest.length,
  '\n  rest sample:', JSON.stringify(rest[0]),
  '\n  hover sample:', JSON.stringify(hover[0]));
process.exit(ok ? 0 : 1);
