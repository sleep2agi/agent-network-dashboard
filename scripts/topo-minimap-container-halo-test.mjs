/* Round 696 — minimap container joins multi-layer halo family on
 * hoveredMinimap. Pre-R696 the container had only static Tailwind
 * box-shadow elevation. R696 adds inline filter 2-layer drop-shadow
 * at pal.legendAccent (2+4 stride, alpha 80/40). Companion to R655
 * inner viewport-rect halo — outer container + inner viewport now
 * both glow when minimap is hovered.
 *
 * Source assertions:
 *   - inline filter uses pal.legendAccent at 2+4 stride 80/40 gated
 *     on hoveredMinimap
 *   - data-topo-minimap-container-halo-layers toggles '2' ↔ '0'
 *
 * Runtime assertions:
 *   - minimap renders only when zoom/pan != default
 *   - simulate non-default view via canvas drag — but simpler: just
 *     verify when minimap appears, halo-layers='0' at rest
 *
 * Minimap is gated on isDefaultView=false — without user interaction
 * it stays hidden. Source verification covers the structural change.
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
    // Set a non-default view in localStorage so the minimap renders on mount.
    localStorage.setItem('anet-topo-view', JSON.stringify({ zoom: 1.5, x: -100, y: -50 }));
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
await page.waitForSelector('[data-topo-minimap]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const minimap = document.querySelector('[data-topo-minimap]');
  return minimap ? {
    halo_layers: minimap.getAttribute('data-topo-minimap-container-halo-layers'),
    hovered:     minimap.getAttribute('data-topo-minimap-hovered'),
  } : null;
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: hoveredMinimap\s*\?\s*`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\)`\s*: undefined/.test(src);
const sourceAttr   = /data-topo-minimap-container-halo-layers=\{hoveredMinimap \? '2' : '0'\}/.test(src);

const results = {
  minimap_rendered:    !!runtimeState,
  rest_layers_zero:    runtimeState?.halo_layers === '0',
  rest_not_hovered:    runtimeState?.hovered === 'false',
  source_filter:       sourceFilter,
  source_halo_attr:    sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R696 minimap container multi-layer halo (52nd anchor — companion to R655 inner viewport):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
