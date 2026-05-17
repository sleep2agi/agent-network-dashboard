/* Round 485 verification: edge particle opacity lifts to 1.0 on
 * isHoveredEdge OR isEndpointHoveredEdge (user hovering edge OR
 * one of its endpoint nodes). Extends R484's "inspection overrides
 * encoding" pattern to a 2nd anchor at the edge-particle scope.
 *
 * Contract:
 *   - rest stale edge: opacity matches freshness × edgeOpacityMul,
 *     data-edge-particle-opacity-lifted='false'
 *   - hover one of the endpoint nodes: that edge's particle
 *     opacity lifts to '1', lifted='true', rest-opacity attr
 *     preserved (encoding intact)
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const sessionFresh = new Date(Date.now() - 60 * 1000).toISOString();
const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

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
    created_at: sessionFresh, updated_at: sessionFresh, last_seen_at: sessionFresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'),
  ] } });
});
// Stale message — freshness alpha decays to ~0.30 floor
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: {
  messages: [
    { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 'old', created_at: fiveMinAgo },
  ],
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-particle]', { timeout: 15000 });
await page.waitForTimeout(500);

const readParticle = () => page.evaluate(() => {
  const p = document.querySelector('[data-edge-particle]');
  if (!p) return null;
  return {
    key:      p.getAttribute('data-edge-particle'),
    lifted:   p.getAttribute('data-edge-particle-opacity-lifted'),
    restOp:   p.getAttribute('data-edge-particle-opacity-rest'),
    opacity:  p.getAttribute('opacity'),
  };
});

const rest = await readParticle();
// Hover the source node (a·1) to trigger isEndpointHoveredEdge
const sourceNode = await page.$('g[data-node="a·1"]');
let hovered = null;
if (sourceNode) {
  await sourceNode.hover();
  await page.waitForTimeout(400);
  hovered = await readParticle();
}

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLiftConditional = /opacity=\{\(isHoveredEdge \|\| isEndpointHoveredEdge\) \? 1 : Math\.min\(1, fresh \* edgeOpacityMul\)\}/.test(src);
const sourceLiftedAttr      = /data-edge-particle-opacity-lifted=/.test(src);
const sourceRestAttr        = /data-edge-particle-opacity-rest=/.test(src);

await browser.close();

const restOpacityNum = parseFloat(rest?.opacity || '0');
const hoverRestOpacityNum = parseFloat(hovered?.restOp || '0');
// Encoding preservation: in BOTH states the rest-opacity attr stays
// below 1.0 (freshness decay still encoded) — even though it may
// shift between states due to R56 edgeOpacityMul hover boost.
// The point: on hover, the LIVE opacity reads as 1 (override active)
// while the underlying decay encoding is still present in the attr.
const encodingPreservedOnHover = hoverRestOpacityNum < 1.0;

const results = {
  particle_present:        !!rest,
  rest_lifted_false:       rest?.lifted === 'false',
  rest_opacity_decayed:    restOpacityNum < 0.7,
  hover_lifted_true:       hovered?.lifted === 'true',
  hover_opacity_is_1:      hovered?.opacity === '1',
  encoding_preserved_on_hover: encodingPreservedOnHover,
  source_lift_conditional: sourceLiftConditional,
  source_lifted_attr:      sourceLiftedAttr,
  source_rest_attr:        sourceRestAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge particle opacity lift on inspect:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hovered:', JSON.stringify(hovered));
process.exit(ok ? 0 : 1);
