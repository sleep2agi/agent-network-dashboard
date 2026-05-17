/* Round 572 verification: panel-row text scopes (recent + legend)
 * stack brightness(1.15) onto R568/R569 drop-shadow filter.
 * 9th + 10th anchors in per-element brightness family.
 *
 * Test phases:
 *   1. mock 1 message + 3 sessions → recent-panel + legend-panel render
 *   2. rest: filters='none', brightness-attrs='1'
 *   3. click pressure-seg working → pinnedStatus='working' →
 *      working legend-row label filter contains drop-shadow AND
 *      brightness(1.15); brightness-attr='1.15'
 *   4. source-side regex confirms stacked filter expressions at both
 *      sites + data-attrs
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
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('alpha·3', 'offline'),
  ] } });
});
// 1 message so flowLinks > 0 → recent-panel renders
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'alpha·1', to_alias: 'alpha·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-row-label="working"]', { timeout: 15000 });
await page.waitForTimeout(500);

const probeLegend = (k) => page.evaluate((key) => {
  const el = document.querySelector(`[data-legend-row-label="${key}"]`);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    brightnessAttr: el.getAttribute('data-legend-row-label-brightness'),
    glowAttr: el.getAttribute('data-legend-row-label-glow'),
  };
}, k);

const probeRecent = () => page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-text]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    brightnessAttr: el.getAttribute('data-recent-row-text-brightness'),
    glowAttr: el.getAttribute('data-recent-row-text-glow'),
  };
});

const restLegend = await probeLegend('working');
const restRecent = await probeRecent();

await page.click('[data-pressure-seg="working"]');
await page.waitForTimeout(400);
const pinnedLegend = await probeLegend('working');

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRecentFilter = /filter: \(isRowHovered \|\| isRowPinned\)\s*\?\s*`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) brightness\(1\.15\)`/.test(src);
const sourceLegendFilter = /filter: \(hoveredStatus === row\.key \|\| isPinned\)\s*\?\s*`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) brightness\(1\.15\)`/.test(src);
const sourceRecentAttr = /data-recent-row-text-brightness=\{\(isRowHovered \|\| isRowPinned\) \? '1\.15' : '1'\}/.test(src);
const sourceLegendAttr = /data-legend-row-label-brightness=\{\(hoveredStatus === row\.key \|\| isPinned\) \? '1\.15' : '1'\}/.test(src);

const results = {
  rest_legend_filter_none:        restLegend?.filter === 'none',
  rest_legend_brightness_1:       restLegend?.brightnessAttr === '1',
  rest_legend_glow_false:         restLegend?.glowAttr === 'false',
  rest_recent_filter_none:        restRecent?.filter === 'none',
  rest_recent_brightness_1:       restRecent?.brightnessAttr === '1',
  rest_recent_glow_false:         restRecent?.glowAttr === 'false',
  // Pin working → working legend-row label lights up with stacked filter
  pinned_legend_glow_true:        pinnedLegend?.glowAttr === 'true',
  pinned_legend_brightness_1_15:  pinnedLegend?.brightnessAttr === '1.15',
  pinned_legend_has_dropshadow:   /drop-shadow\(/.test(pinnedLegend?.filter || ''),
  pinned_legend_has_brightness:   /brightness\(1\.15\)/.test(pinnedLegend?.filter || ''),
  // Source regexes for both anchors
  source_recent_filter:  sourceRecentFilter,
  source_legend_filter:  sourceLegendFilter,
  source_recent_attr:    sourceRecentAttr,
  source_legend_attr:    sourceLegendAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R572 panel-row text stacked brightness (9th + 10th anchors in per-element family):`,
  JSON.stringify(results, null, 2),
  '\n  rest legend (working):', JSON.stringify(restLegend),
  '\n  rest recent:',           JSON.stringify(restRecent),
  '\n  pinned legend (working):', JSON.stringify(pinnedLegend));
process.exit(ok ? 0 : 1);
