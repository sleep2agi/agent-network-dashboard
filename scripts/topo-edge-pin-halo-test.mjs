/* Round 692 — extends edge visible path (R677) + flow-rail (R678) +
 * particle (R679) halo gates from hover-only to (hover || pin).
 * Closes per-edge pin-state symmetry: pre-R692 only the badge
 * (R646/R672 already pin-aware) halo'd when an edge was pinned;
 * R692 closes the gap so ALL 5 per-edge surfaces respond to pin.
 *
 * Implementation: hoists `isEdgePinned = pinnedEdgeKey === link.key`
 * to the outer link map closure (before the visible path/rail/
 * particle declarations) — pre-existing badge IIFE's isPinned stays
 * unchanged.
 *
 * Source assertions:
 *   - `isEdgePinned` defined in outer link map closure
 *   - visible path filter + halo-layers gate include isEdgePinned
 *   - flow-rail filter + halo-layers gate include isEdgePinned
 *   - particle filter + halo-layers gate include isEdgePinned
 *
 * Runtime assertions:
 *   - edges render with halo-layers='0' at rest (no hover, no pin)
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
    mk('a·1'), mk('a·2'), mk('a·3'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', kind: 'message', content: 'p', network_id: 'default', created_at: fresh },
  { id: 'm2', from_alias: 'a·2', to_alias: 'a·3', kind: 'task',    content: 'p2', network_id: 'default', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-visible-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const visibles = Array.from(document.querySelectorAll('[data-edge-visible-halo-layers]'));
  const rails    = Array.from(document.querySelectorAll('[data-edge-flow-rail-halo-layers]'));
  return {
    visible_count: visibles.length,
    rail_count:    rails.length,
    visible_rest_zero: visibles.every(el => el.getAttribute('data-edge-visible-halo-layers') === '0'),
    rail_rest_zero:    rails.every(el => el.getAttribute('data-edge-flow-rail-halo-layers') === '0'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceIsEdgePinned    = /const isEdgePinned = pinnedEdgeKey === link\.key;/.test(src);
const sourceVisibleAttr     = /data-edge-visible-halo-layers=\{\(isHoveredEdge \|\| isEndpointHoveredEdge \|\| isEdgePinned\) \? '2' : '0'\}/.test(src);
const sourceVisibleFilter   = /filter: \(isHoveredEdge \|\| isEndpointHoveredEdge \|\| isEdgePinned\)\s*\?\s*\(isLight/.test(src);
const sourceRailAttr        = /data-edge-flow-rail-halo-layers=\{\(isHoveredEdge \|\| isEndpointHoveredEdge \|\| isEdgePinned\) \? '2' : '0'\}/.test(src);
const sourceRailFilter      = /filter: \(isHoveredEdge \|\| isEndpointHoveredEdge \|\| isEdgePinned\)\s*\?\s*`drop-shadow\(0 0 2px \$\{pal\.flowPath\}/.test(src);
const sourceParticleAttr    = /data-edge-particle-halo-layers=\{\(isHoveredEdge \|\| isEndpointHoveredEdge \|\| isEdgePinned\) \? '2' : '0'\}/.test(src);
const sourceParticleFilter  = /filter: \(isHoveredEdge \|\| isEndpointHoveredEdge \|\| isEdgePinned\)\s*\?\s*\(isLight/.test(src);

const results = {
  edges_present:       runtimeState.visible_count >= 2,
  rails_present:       runtimeState.rail_count >= 2,
  visible_rest_zero:   runtimeState.visible_rest_zero,
  rail_rest_zero:      runtimeState.rail_rest_zero,
  source_is_pinned:    sourceIsEdgePinned,
  source_visible_attr: sourceVisibleAttr,
  source_visible_filter: sourceVisibleFilter,
  source_rail_attr:    sourceRailAttr,
  source_rail_filter:  sourceRailFilter,
  source_particle_attr:   sourceParticleAttr,
  source_particle_filter: sourceParticleFilter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R692 per-edge tier pin-gated halo (closes 5/5 pin-symmetry):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${runtimeState.visible_count} visibles, ${runtimeState.rail_count} rails`);
process.exit(ok ? 0 : 1);
