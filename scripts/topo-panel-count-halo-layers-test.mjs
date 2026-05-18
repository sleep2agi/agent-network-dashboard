/* Round 669 — panel-count pair (recent + legend) extends single-axis
 * brightness(1.15) hover paint to the 2-layer drop-shadow halo
 * vocabulary. 28th anchor in multi-layer halo family — symmetric
 * panel-pair sweep (both panel COUNT texts simultaneously).
 *
 * Source assertions:
 *   - recent: filter chain uses pal.legendAccent at 0x80 + 0x40 with 2+4
 *     stride, gated on hoveredPanel === 'recent'
 *   - legend: filter chain uses pal.legendAccent at 0x80 + 0x40 with 2+4
 *     stride, gated on hoveredPanel === 'legend'
 *   - both halo-layers data-attrs toggle '2' ↔ '0' on hover
 *
 * Runtime assertions:
 *   - both panel counts present in DOM at rest, halo-layers='0'
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2'), mk('a·3')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', kind: 'task',    content: 'ping',  network_id: 'default', created_at: fresh },
  { id: 'm2', from_alias: 'a·2', to_alias: 'a·3', kind: 'message', content: 'pong',  network_id: 'default', created_at: fresh },
  { id: 'm3', from_alias: 'a·3', to_alias: 'a·1', kind: 'task',    content: 'hello', network_id: 'default', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-panel-count]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  const legend = document.querySelector('[data-legend-panel-count]');
  const recent = document.querySelector('[data-recent-panel-count-letter-spacing]');
  return {
    legend_present:    !!legend,
    recent_present:    !!recent,
    legend_layers:     legend?.getAttribute('data-legend-panel-count-halo-layers'),
    recent_layers:     recent?.getAttribute('data-recent-panel-count-halo-layers'),
    legend_brightness: legend?.getAttribute('data-legend-panel-count-brightness'),
    recent_brightness: recent?.getAttribute('data-recent-panel-count-brightness'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRecentFilter = /hoveredPanel === 'recent' \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceLegendFilter = /hoveredPanel === 'legend' \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceRecentAttr = /data-recent-panel-count-halo-layers=\{hoveredPanel === 'recent' \? '2' : '0'\}/.test(src);
const sourceLegendAttr = /data-legend-panel-count-halo-layers=\{hoveredPanel === 'legend' \? '2' : '0'\}/.test(src);

const results = {
  recent_present:        restState.recent_present,
  legend_present:        restState.legend_present,
  rest_recent_layers_0:  restState.recent_layers === '0',
  rest_legend_layers_0:  restState.legend_layers === '0',
  rest_recent_bright_1:  restState.recent_brightness === '1',
  rest_legend_bright_1:  restState.legend_brightness === '1',
  source_recent_filter:  sourceRecentFilter,
  source_legend_filter:  sourceLegendFilter,
  source_recent_attr:    sourceRecentAttr,
  source_legend_attr:    sourceLegendAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R669 panel-count pair multi-layer halo (symmetric panel-pair sweep):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
