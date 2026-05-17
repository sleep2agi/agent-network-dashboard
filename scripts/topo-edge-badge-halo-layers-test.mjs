/* Round 646 — edge-badge CIRCLE filter gains a SECOND drop-shadow
 * layer at 6px blur with halved alpha. Extends multi-layer halo
 * family from rings + text to the first per-edge surface.
 *
 * Test phases:
 *   1. mock hot edge (12 messages → isHot=true) → badge visible
 *   2. rest (no hover/pin): hot branch fires → halo-layers='2',
 *      computed filter has 2 drop-shadow substrings with amber tint
 *   3. source: both hover/pin/endpoint AND hot branches stack
 *      2 drop-shadows
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
// 12 messages → isHot=true (count ≥ 10 threshold) → hot branch of filter fires
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages:
  Array.from({ length: 12 }, (_, i) => ({
    from_alias: 'a·1', to_alias: 'a·2', content: `msg-${i}`, created_at: fresh,
  }))
} }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const hot = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-badge-halo-layers="2"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    layers: el.getAttribute('data-edge-badge-halo-layers'),
    glow:   el.getAttribute('data-edge-badge-glow'),
    filter: cs.filter,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHoverPin = /`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}99\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}50\) brightness\(1\.15\)`/.test(src);
const sourceHot      = /`drop-shadow\(0 0 3px \$\{hotStroke\}80\) drop-shadow\(0 0 6px \$\{hotStroke\}40\) brightness\(1\.15\)`/.test(src);
const sourceLayers   = /data-edge-badge-halo-layers=\{\(\(isHoveredEdge \|\| isPinned \|\| isEndpointHoveredEdge\) \|\| isHot\) \? '2' : '0'\}/.test(src);

const hotDropShadowCount = (hot?.filter?.match(/drop-shadow/g) || []).length;

const results = {
  hot_present:            !!hot,
  hot_layers_2:           hot?.layers === '2',
  hot_glow_hot:           hot?.glow === 'hot',
  hot_two_dropshadows:    hotDropShadowCount === 2,
  hot_filter_brightness:  /brightness/.test(hot?.filter || ''),
  source_hover_pin:       sourceHoverPin,
  source_hot:             sourceHot,
  source_layers_attr:     sourceLayers,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R646 edge-badge multi-layer halo (per-edge chromatic identity):`,
  JSON.stringify(results, null, 2),
  `\n  hot: ${JSON.stringify(hot)}`);
process.exit(ok ? 0 : 1);
