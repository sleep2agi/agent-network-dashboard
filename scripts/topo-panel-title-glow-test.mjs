/* Round 550 verification: panel-title texts (recent + legend) gain
 * pal.legendAccent drop-shadow on active state. 14th + 15th anchors
 * in drop-shadow family (counted as R550 + sibling).
 *
 * Source-canonical for the LIVE state probe (DOM filter readback via
 * SVG is reliable here — text element, no shared-gate IIFE). Pin
 * trigger: click a status legend row to set pinnedStatus → glow on
 * legend-panel title. activeEdgeKey would require flow data — for
 * recent-panel just source-side regex confirms the wiring.
 *
 * Test phases:
 *   1. rest: both panel titles' computed filter = 'none'
 *   2. legend title — click pressure-bar working seg to pin → filter
 *      contains drop-shadow with the cyan accent
 *   3. source regex confirms both texts wired with the filter
 *      conditional + transition list extension
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('a·3', 'offline'),
  ] } });
});
// Provide one message so flowLinks > 0 → recent-panel renders.
// buildFlowLinks reads from_alias/to_alias/content/created_at (banked R520).
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-panel-title]', { timeout: 15000 });
await page.waitForTimeout(500);

// Phase 1: rest filters
const restLegend = await page.evaluate(() => {
  const el = document.querySelector('[data-legend-panel-title]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { filter: cs.filter, glowAttr: el.getAttribute('data-legend-panel-title-glow') };
});
const restRecent = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-title]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { filter: cs.filter, glowAttr: el.getAttribute('data-recent-panel-title-glow') };
});

// Phase 2: click pressure-bar working seg to pin → triggers
// pinnedStatus='working' → legend title should glow.
await page.click('[data-pressure-seg="working"]');
await page.waitForTimeout(400);
const pinnedLegend = await page.evaluate(() => {
  const el = document.querySelector('[data-legend-panel-title]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { filter: cs.filter, glowAttr: el.getAttribute('data-legend-panel-title-glow') };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRecentFilter =
  /filter: activeEdgeKey \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\)` : undefined/.test(src);
const sourceLegendFilter =
  /filter: pinnedStatus \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\)` : undefined/.test(src);
const sourceRecentTransition =
  /transition: 'fill 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  rest_legend_filter_none:    restLegend?.filter === 'none',
  rest_recent_filter_none:    restRecent?.filter === 'none',
  rest_legend_glow_attr_false: restLegend?.glowAttr === 'false',
  rest_recent_glow_attr_false: restRecent?.glowAttr === 'false',
  pinned_legend_glow_attr:    pinnedLegend?.glowAttr === 'true',
  // Computed filter contains drop-shadow with rgb/rgba (hex+alpha resolves to rgba)
  pinned_legend_filter_set:   /drop-shadow\(/.test(pinnedLegend?.filter || ''),
  source_recent_filter:       sourceRecentFilter,
  source_legend_filter:       sourceLegendFilter,
  source_recent_transition:   sourceRecentTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R550 panel-title pin-gated drop-shadow (14th + 15th anchors):`,
  JSON.stringify(results, null, 2),
  '\n  rest legend:', JSON.stringify(restLegend),
  '\n  rest recent:', JSON.stringify(restRecent),
  '\n  pinned legend:', JSON.stringify(pinnedLegend));
process.exit(ok ? 0 : 1);
