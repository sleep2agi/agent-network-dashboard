/* Round 466 verification: root svg gains `data-topo-any-hover`
 * aggregate hover attr. Composed from 6 per-surface hover vars
 * (hoveredAlias, hoveredHub, hoveredEdgeKey, hoveredGroupLabel,
 * hoveredStatus, hoveredVendor). Read-only computed signal —
 * useful for tests + external CSS hooks.
 *
 * Contract:
 *   - at rest (no hover): data-topo-any-hover === 'false'
 *   - hover a node: 'true'
 *   - leave the node: back to 'false'
 *   - source-file conditional wired
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
    localStorage.setItem('anet-topo-layout', 'grid');
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
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[data-topo-any-hover]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAttr = () => page.evaluate(() =>
  document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-any-hover')
);

const restValue = await readAttr();

// Hover a group label to flip hoveredGroupLabel
await page.hover('[data-group-label-hit]');
await page.waitForTimeout(200);
const hoverValue = await readAttr();

// Move pointer far away to clear hover
await page.mouse.move(2, 2);
await page.waitForTimeout(300);
const restAgainValue = await readAttr();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasAttr        = /data-topo-any-hover=\{/.test(src);
const sourceCombines6Vars  = /hoveredAlias \|\| hoveredHub \|\| hoveredEdgeKey \|\| hoveredGroupLabel \|\|/.test(src);

await browser.close();

const results = {
  rest_is_false:        restValue === 'false',
  hover_flips_true:     hoverValue === 'true',
  rest_again_is_false:  restAgainValue === 'false',
  source_attr_wired:    sourceHasAttr,
  source_6_vars:        sourceCombines6Vars,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} data-topo-any-hover aggregate:`, JSON.stringify(results),
  '\n  rest:', restValue, '/ hover:', hoverValue, '/ rest again:', restAgainValue);
process.exit(ok ? 0 : 1);
