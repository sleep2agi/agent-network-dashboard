/* Round 436 verification: edge visible-path stroke-width lift on
 * hoveredAlias endpoint. Mirrors R430/R435 hub-spoke pattern at edge
 * scope — when hoveredAlias matches one of the edge's endpoints, the
 * visible path thickens by 1.15× alongside the existing edgeOpacityMul
 * 1.7× lift (now BOTH paint and geometry lift on endpoint hover).
 *
 * Contract:
 *   - rest: no edge reports data-edge-visible-endpoint-hovered='true'
 *   - hover one node alias: exactly the edges incident on that alias
 *     report endpoint-hovered='true' AND their renderWidth > rest base
 *   - siblings unaffected
 *   - source-file probe confirms the new conditional + endpoint cap
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    // alpha is incident on both edges; gamma↔beta is the non-incident edge
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta',  content: 'ping', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'gamma', content: 'pong', created_at: fresh, network_id: 'default' },
    { id: 'm3', from_alias: 'gamma', to_alias: 'beta',  content: 'pang', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-visible]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ps = [...document.querySelectorAll('[data-edge-visible]')];
  return ps.map(p => ({
    key:       p.getAttribute('data-edge-visible'),
    endHover:  p.getAttribute('data-edge-visible-endpoint-hovered'),
    sw:        parseFloat(p.getAttribute('data-edge-visible-stroke-width') || '0'),
  }));
});

const rest = await readAll();

// Hover alpha
let hover = null;
const box = await page.evaluate(() => {
  const t = document.querySelector('[data-node-alias-text="alpha"]');
  if (!t) return null;
  const node = t.closest('[data-node]');
  const target = node || t;
  const b = target.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (box) {
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(300);
  hover = await readAll();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /isEndpointHoveredEdge\s*\?\s*Math\.min\(width \* 1\.15,\s*8\)\s*\n?\s*:\s*width/.test(fileText);
const sourceIsEndpoint = /const isEndpointHoveredEdge = !!hoveredAlias && \(link\.from === hoveredAlias \|\| link\.to === hoveredAlias\)/.test(fileText);

await browser.close();

// rest: no edge should report endpoint-hover=true
const restNoneEndHover = rest.every(r => r.endHover === 'false');

// hover state: edges where alpha is an endpoint should report endpoint=true.
// fixture edges: alpha↔beta, alpha↔gamma, gamma↔beta (deduped keys).
const hoverByKey = new Map((hover || []).map(h => [h.key, h]));
const restByKey  = new Map((rest  || []).map(r => [r.key, r]));

// flow link keys are e.g. "alpha->beta" or "alpha-beta" — we don't know the
// exact format. Detect alpha-incident edges by key substring.
const isAlphaEdge = (key) => key && /alpha/i.test(key);
const alphaEdges = [...hoverByKey.entries()].filter(([k]) => isAlphaEdge(k));
const nonAlphaEdges = [...hoverByKey.entries()].filter(([k]) => !isAlphaEdge(k));

const alphaAllEndHover = alphaEdges.length > 0 && alphaEdges.every(([, h]) => h.endHover === 'true');
const nonAlphaNoEndHover = nonAlphaEdges.every(([, h]) => h.endHover === 'false');

// width lifted for alpha edges (compare to rest sw for same key)
const alphaSwLifted = alphaEdges.every(([k, h]) => {
  const r = restByKey.get(k);
  return r && h.sw > r.sw;
});

const results = {
  rest_edge_count_ge_2:        rest.length >= 2,
  rest_no_endpoint_hover:      restNoneEndHover,
  hover_alpha_edges_present:   alphaEdges.length >= 1,
  hover_alpha_all_endHover:    alphaAllEndHover,
  hover_alpha_sw_lifted:       alphaSwLifted,
  hover_non_alpha_unaffected:  nonAlphaNoEndHover,
  source_renderWidth_wired:    sourceWired,
  source_isEndpoint_wired:     sourceIsEndpoint,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge endpoint-hover sw lift:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
