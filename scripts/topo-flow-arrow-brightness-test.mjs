/* Round 609 — legend flow-arrow gains stacked drop-shadow +
 * brightness on hoveredPanel === 'legend'. Ties the demo arrow
 * to the panel-wide hover gesture; banked R582/R583 stacked-
 * filter pattern at the legend decoration scope.
 *
 * Test phases:
 *   1. mock nodes → legend renders with flow-arrow path
 *   2. rest (no panel hover): filter='none', glow-attr='false',
 *      brightness-attr='1'
 *   3. computed transition-property contains 'filter'
 *   4. source: stacked filter conditional + data-attrs
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-flow-arrow]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-legend-flow-arrow]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    glowAttr: el.getAttribute('data-legend-flow-arrow-glow'),
    brightnessAttr: el.getAttribute('data-legend-flow-arrow-brightness'),
    stroke: el.getAttribute('stroke'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: hoveredPanel === 'legend'\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.flowEdge\}80\) brightness\(1\.15\)`\s*:\s*undefined/.test(src);
const sourceAttr = /data-legend-flow-arrow-brightness=\{hoveredPanel === 'legend' \? '1\.15' : '1'\}/.test(src);
const sourceGlow = /data-legend-flow-arrow-glow=\{hoveredPanel === 'legend' \? 'true' : 'false'\}/.test(src);

const results = {
  arrow_present:          !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_glow_false:        rest?.glowAttr === 'false',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  has_stroke:             !!rest?.stroke,
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_brightness_attr: sourceAttr,
  source_glow_attr:       sourceGlow,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R609 flow-arrow stacked brightness (legend decoration scope):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
