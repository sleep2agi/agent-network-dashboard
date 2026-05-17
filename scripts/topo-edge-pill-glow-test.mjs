/* Round 546 verification: edge filter pill gains pal.flowEdge-tied drop-
 * shadow when rendered. CLOSES pin-active filter-pill drop-shadow sub-
 * family at the 4th pill variant. Source-canonical (banked R544 lesson —
 * setPinnedEdgeKey is bound to SVG edge hitbox/badge, Playwright can't
 * reach through topo-panel rect's pointer interception).
 *
 * Test phases:
 *   1. unpinned: no [data-active-filter="edge"] element
 *   2. source-side regex confirms filter wired with pal.flowEdge via
 *      color-mix 60% syntax, scoped to edge-pill block (setPinnedEdgeKey
 *      handler proximity)
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('svg[data-topo-layout]', { timeout: 15000 });
await page.waitForTimeout(500);

const unpinned = await page.evaluate(() =>
  document.querySelector('[data-active-filter="edge"]') !== null
);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// Scope: setPinnedEdgeKey(null) handler vicinity (edge pill block)
const edgePillScope = src.match(/onClick=\{\(\) => setPinnedEdgeKey\(null\)\}[\s\S]{0,2500}/)?.[0] || '';
const sourceFilterScoped =
  /filter: `drop-shadow\(0 0 3px color-mix\(in srgb, \$\{pal\.flowEdge\} 60%, transparent\)\)`,/.test(edgePillScope);

const results = {
  unpinned_pill_absent:    unpinned === false,
  source_filter_scoped:    sourceFilterScoped,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R546 edge filter pill glow (source-canonical, CLOSES sub-family):`,
  JSON.stringify(results, null, 2),
  '\n  unpinned absent:', unpinned);
process.exit(ok ? 0 : 1);
