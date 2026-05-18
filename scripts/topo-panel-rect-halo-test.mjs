/* Round 695 — recent-signal + legend panel rects (panel-pair backdrop)
 * extend filter chain on hoveredPanel branch from elevation-only to
 * 4-LAYER panel-tier composition. Prepends 2-layer radial drop-shadow
 * at pal.legendAccent (3+6 stride, alpha 80/40). Sibling to R693
 * hover-detail card + R694 per-node label card. Closes panel-pair
 * backdrop halo symmetry — both panels now glow on respective hover.
 *
 * Source assertions:
 *   - recent panel hover branch: 2× pal.legendAccent drop-shadow + elevation
 *   - legend panel hover branch: same composition
 *   - both halo-layers data attrs toggle '2' ↔ '0' on hoveredPanel
 *
 * Runtime assertions:
 *   - both panel rects present with data-topo-panel-elevation attrs
 *   - rest halo-layers='0' on both
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
  { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', kind: 'message', content: 'p', network_id: 'default', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-panel-elevation="legend"]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const recent = document.querySelector('[data-topo-panel-elevation="recent"]');
  const legend = document.querySelector('[data-topo-panel-elevation="legend"]');
  return {
    recent_present: !!recent,
    legend_present: !!legend,
    recent_halo:    recent?.getAttribute('data-topo-panel-recent-halo-layers'),
    legend_halo:    legend?.getAttribute('data-topo-panel-legend-halo-layers'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRecentLight = /hoveredPanel === 'recent'[\s\S]*?isLight\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 4px 12px rgba\(15,23,42,0\.14\)\)`/.test(src);
const sourceRecentCyber = /hoveredPanel === 'recent'[\s\S]*?:\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 4px 12px rgba\(0,0,0,0\.65\)\)`/.test(src);
const sourceLegendLight = /hoveredPanel === 'legend'[\s\S]*?isLight\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 4px 12px rgba\(15,23,42,0\.14\)\)`/.test(src);
const sourceLegendCyber = /hoveredPanel === 'legend'[\s\S]*?:\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 4px 12px rgba\(0,0,0,0\.65\)\)`/.test(src);
const sourceRecentAttr  = /data-topo-panel-recent-halo-layers=\{hoveredPanel === 'recent' \? '2' : '0'\}/.test(src);
const sourceLegendAttr  = /data-topo-panel-legend-halo-layers=\{hoveredPanel === 'legend' \? '2' : '0'\}/.test(src);

const results = {
  recent_present:        runtimeState.recent_present,
  legend_present:        runtimeState.legend_present,
  rest_recent_layers_0:  runtimeState.recent_halo === '0',
  rest_legend_layers_0:  runtimeState.legend_halo === '0',
  source_recent_light:   sourceRecentLight,
  source_recent_cyber:   sourceRecentCyber,
  source_legend_light:   sourceLegendLight,
  source_legend_cyber:   sourceLegendCyber,
  source_recent_attr:    sourceRecentAttr,
  source_legend_attr:    sourceLegendAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R695 panel-pair backdrop multi-layer halo (51 anchor — closes panel-pair backdrop symmetry):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
