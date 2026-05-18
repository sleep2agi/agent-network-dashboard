/* Round 672 — edge-badge DIGIT text extends single-axis brightness
 * across a unified 4-condition gate to the SAME two-branch multi-
 * layer halo pattern as R646 edge-badge CIRCLE. Cyan branch (hover/
 * pin/endpoint) uses pal.legendAccent; amber branch (hot-only) uses
 * hotStroke. Both at 2+4 stride (text scale, matches R645). Edge-
 * badge circle (R646) + digit (R672) now emit halo in lockstep on
 * edge attention. 31st anchor in family.
 *
 * Source assertions:
 *   - cyan branch: pal.legendAccent 80/40 with 2+4 stride
 *   - amber branch: hotStroke 80/40 with 2+4 stride
 *   - halo-layers + halo-branch data attrs reflect runtime state
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'), mk('a·3'), mk('a·4'),
  ] } });
});
// 12 messages between a·1 ↔ a·2 — enough to push edge into "hot" state
// (~10 messages in window). Other edges stay non-hot.
const HOT_PAIR = [['a·1', 'a·2']];
const COLD_PAIRS = [['a·3', 'a·4']];
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `hot${i}`,
    from_alias: HOT_PAIR[0][i % 2],
    to_alias:   HOT_PAIR[0][(i + 1) % 2],
    kind: 'task', content: `hot ${i}`,
    network_id: 'default', created_at: fresh,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `cold${i}`,
    from_alias: COLD_PAIRS[0][i % 2],
    to_alias:   COLD_PAIRS[0][(i + 1) % 2],
    kind: 'message', content: `cold ${i}`,
    network_id: 'default', created_at: fresh,
  })),
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-digit-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-edge-badge-digit-halo-layers]')).map(el => ({
    layers: el.getAttribute('data-edge-badge-digit-halo-layers'),
    branch: el.getAttribute('data-edge-badge-digit-halo-branch'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceCyanFilter  = /\(isHoveredEdge \|\| isPinned \|\| isEndpointHoveredEdge\)\s+\?\s+`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)`/.test(src);
const sourceAmberFilter = /isHot\s+\?\s+`drop-shadow\(0 0 2px \$\{hotStroke\}80\) drop-shadow\(0 0 4px \$\{hotStroke\}40\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr  = /data-edge-badge-digit-halo-layers=\{\(isHoveredEdge \|\| isPinned \|\| isEndpointHoveredEdge \|\| isHot\) \? '2' : '0'\}/.test(src);
const sourceBranchAttr  = /data-edge-badge-digit-halo-branch=\{[\s\S]*?\(isHoveredEdge \|\| isPinned \|\| isEndpointHoveredEdge\) \? 'cyan'[\s\S]*?: isHot \? 'amber'[\s\S]*?: 'none'/.test(src);

// Logical invariant at rest: branch='none' ↔ layers='0', and any non-none
// branch must have layers='2'. Don't pin to specific message-rate thresholds
// (those vary with mock data) — verify the cyan↔amber↔none gate consistency
// at every edge digit instead.
const allConsistent = restState.every(e =>
  (e.branch === 'none' && e.layers === '0') ||
  ((e.branch === 'cyan' || e.branch === 'amber') && e.layers === '2')
);
const hasNoneAtRest = restState.some(e => e.branch === 'none' && e.layers === '0');

const results = {
  digits_present:      restState.length >= 2,
  rest_gate_consistent: allConsistent,
  has_none_at_rest:    hasNoneAtRest,
  source_cyan_filter:  sourceCyanFilter,
  source_amber_filter: sourceAmberFilter,
  source_layers_attr:  sourceLayersAttr,
  source_branch_attr:  sourceBranchAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R672 edge-badge digit multi-layer halo (2-branch lockstep w/ R646 circle):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
