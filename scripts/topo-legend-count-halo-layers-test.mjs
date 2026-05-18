/* Round 671 — legend-row COUNT text extends single-axis brightness
 * to 2-layer drop-shadow at row.fill (per-tier color) tint with 3+6
 * stride and alpha 99/4c — matches R665 swatch convention. Completes
 * legend-row tier closure: swatch + label + count all multi-layer
 * halo. 30th anchor in family.
 *
 * Source assertions:
 *   - filter chain uses row.fill at 0x99 + 0x4c with 3+6 stride
 *   - data-legend-count-halo-layers attr toggles '2' ↔ '0'
 *
 * Runtime assertions:
 *   - all 3 legend rows present, halo-layers='0' at rest
 *   - brightness attr at rest: '1' on all rows
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
    mk('a·1', 'working'), mk('a·2', 'working'),
    mk('a·3', 'idle'),    mk('a·4', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-count-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restCounts = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-legend-count-brightness]')).map(el => ({
    brightness: el.getAttribute('data-legend-count-brightness'),
    layers:     el.getAttribute('data-legend-count-halo-layers'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /\? `drop-shadow\(0 0 3px \$\{row\.fill\}99\) drop-shadow\(0 0 6px \$\{row\.fill\}4c\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-legend-count-halo-layers=\{\(hoveredStatus === row\.key \|\| isPinned\) \? '2' : '0'\}/.test(src);

const restAllZero    = restCounts.every(r => r.layers === '0');
const restAllOneBri  = restCounts.every(r => r.brightness === '1');

const results = {
  counts_present:        restCounts.length >= 3,
  rest_all_layers_zero:  restAllZero,
  rest_all_brightness_1: restAllOneBri,
  source_filter:         sourceFilter,
  source_layers_attr:    sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R671 legend-row count multi-layer halo (per-tier row.fill tint):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restCounts)}`);
process.exit(ok ? 0 : 1);
