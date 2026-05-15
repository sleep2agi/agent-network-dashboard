/* Round 56 verification: hovering a recent-signal panel row sets
 * hoveredEdgeKey to that link, which fires the R50 edge-focus +
 * R49 endpoint-highlight ladders against the canvas.
 *
 * Sessions: alpha, beta, gamma, delta, epsilon, zeta (all idle).
 * Messages create three deduped flow links in this order:
 *   alpha → beta
 *   gamma → delta
 *   epsilon → zeta
 * Hover the FIRST recent-signal row (alpha→beta):
 *   - alpha→beta visible edge: opacity boosts ≥1.5× baseline (R50)
 *   - other edges (γ→δ, ε→ζ): opacity dims < 0.6× baseline
 *   - alpha + beta nodes: stay bright (≥0.55) — endpoint highlight (R49)
 *   - gamma/delta/epsilon/zeta nodes: dim (<0.4)
 * Release → all restore.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
const now = new Date().toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { from_alias: 'alpha',   to_alias: 'beta',  content: 'm', created_at: now },
  { from_alias: 'gamma',   to_alias: 'delta', content: 'm', created_at: now },
  { from_alias: 'epsilon', to_alias: 'zeta',  content: 'm', created_at: now },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForTimeout(600);

const readState = () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const edges = {};
  for (const g of svg.querySelectorAll(':scope > g > g')) {
    const t = g.querySelector('path[data-edge-hitbox] title');
    if (!t) continue;
    const route = (t.textContent || '').split('\n')[0];
    const base = [...g.querySelectorAll(':scope > path')].find(
      p => !p.hasAttribute('data-edge-hitbox') && p.hasAttribute('marker-end')
    );
    if (base) edges[route] = +base.getAttribute('opacity');
  }
  const nodes = {};
  for (const a of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']) {
    const n = document.querySelector(`g[data-node="${a}"]`);
    nodes[a] = n ? +(n.style.opacity || '1') : null;
  }
  return { edges, nodes };
});

const before = await readState();

// Hover the first recent-signal row — its key is "alpha->beta".
const rowRect = await page.evaluate(() => {
  const g = document.querySelector('g[data-recent-row="alpha->beta"]');
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (!rowRect) { console.log('❌ recent-signal row alpha->beta not found'); process.exit(1); }
await page.mouse.move(10, 10);
await page.mouse.move(rowRect.x, rowRect.y);
await page.waitForTimeout(350);
const during = await readState();

await page.mouse.move(10, 10);
await page.waitForTimeout(350);
const after = await readState();

await browser.close();

const baseEdgeOp = before.edges['alpha → beta'];
const eAB = during.edges['alpha → beta'];
const eGD = during.edges['gamma → delta'];
const eEZ = during.edges['epsilon → zeta'];

const bright = (v) => v != null && v >= 0.55;
const dim = (v) => v != null && v < 0.4;
const results = {
  baselineEqual: Math.abs(before.edges['alpha → beta'] - before.edges['gamma → delta']) < 0.001
              && Math.abs(before.edges['alpha → beta'] - before.edges['epsilon → zeta']) < 0.001,
  hoverBrightensTargetEdge: eAB > baseEdgeOp * 1.5,
  hoverDimsOtherEdges: eGD < baseEdgeOp * 0.6 && eEZ < baseEdgeOp * 0.6,
  endpointsStayBright: bright(during.nodes.alpha) && bright(during.nodes.beta),
  nonEndpointsDim: dim(during.nodes.gamma) && dim(during.nodes.delta)
                && dim(during.nodes.epsilon) && dim(during.nodes.zeta),
  releaseRestoresEdges: Math.abs(after.edges['alpha → beta'] - baseEdgeOp) < 0.05
                     && Math.abs(after.edges['gamma → delta'] - baseEdgeOp) < 0.05,
  releaseRestoresNodes: bright(after.nodes.alpha) && bright(after.nodes.gamma) && bright(after.nodes.epsilon),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row hover:`, JSON.stringify(results),
  `\n  baseline α→β=${baseEdgeOp}`,
  `\n  during α→β=${eAB} γ→δ=${eGD} ε→ζ=${eEZ}`,
  `\n  during nodes=`, during.nodes,
  `\n  after  edges=`, after.edges);
process.exit(ok ? 0 : 1);
