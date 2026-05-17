/* Round 573 verification: panel-title text (recent + legend) stacks
 * brightness(1.15) onto R550's active-gated drop-shadow. 11th + 12th
 * anchors in per-element brightness family.
 *
 * Test phases:
 *   1. rest: filters='none', brightness-attrs='1', glow-attrs='false'
 *   2. click pressure-seg working → pinnedStatus='working' →
 *      legend-panel-title filter contains drop-shadow AND brightness(1.15);
 *      brightness-attr='1.15'
 *   3. source-side regex confirms stacked filter at both panels
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
    mk('a·1', 'working'), mk('a·2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-panel-title]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    brightness: el.getAttribute(s.includes('legend') ? 'data-legend-panel-title-brightness' : 'data-recent-panel-title-brightness'),
    glow: el.getAttribute(s.includes('legend') ? 'data-legend-panel-title-glow' : 'data-recent-panel-title-glow'),
  };
}, sel);

const restLegend = await probe('[data-legend-panel-title]');
const restRecent = await probe('[data-recent-panel-title]');

await page.click('[data-pressure-seg="working"]');
await page.waitForTimeout(400);
const pinnedLegend = await probe('[data-legend-panel-title]');

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRecentFilter = /filter: activeEdgeKey \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) brightness\(1\.15\)`/.test(src);
const sourceLegendFilter = /filter: pinnedStatus \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) brightness\(1\.15\)`/.test(src);
const sourceRecentAttr = /data-recent-panel-title-brightness=\{activeEdgeKey \? '1\.15' : '1'\}/.test(src);
const sourceLegendAttr = /data-legend-panel-title-brightness=\{pinnedStatus \? '1\.15' : '1'\}/.test(src);

const results = {
  rest_legend_filter_none:       restLegend?.filter === 'none',
  rest_legend_brightness_1:      restLegend?.brightness === '1',
  rest_legend_glow_false:        restLegend?.glow === 'false',
  rest_recent_filter_none:       restRecent?.filter === 'none',
  rest_recent_brightness_1:      restRecent?.brightness === '1',
  rest_recent_glow_false:        restRecent?.glow === 'false',
  pinned_legend_glow_true:       pinnedLegend?.glow === 'true',
  pinned_legend_brightness_1_15: pinnedLegend?.brightness === '1.15',
  pinned_legend_has_dropshadow:  /drop-shadow\(/.test(pinnedLegend?.filter || ''),
  pinned_legend_has_brightness:  /brightness\(1\.15\)/.test(pinnedLegend?.filter || ''),
  source_recent_filter:          sourceRecentFilter,
  source_legend_filter:          sourceLegendFilter,
  source_recent_attr:            sourceRecentAttr,
  source_legend_attr:            sourceLegendAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R573 panel-title stacked brightness (11th + 12th anchors):`,
  JSON.stringify(results, null, 2),
  '\n  rest legend:', JSON.stringify(restLegend),
  '\n  rest recent:', JSON.stringify(restRecent),
  '\n  pinned legend:', JSON.stringify(pinnedLegend));
process.exit(ok ? 0 : 1);
