/* Round 666 — per-node hover ring (r=radius+12) gains stroke-tinted
 * drop-shadow halo on hoveredAlias match. 25th anchor in multi-layer
 * halo family (1st per-node-hover-ring anchor).
 *
 * Test phases:
 *   1. mock 2 idle nodes
 *   2. rest: all hover rings halo-layers='0'
 *   3. source: filter expression uses status.primary tint at 0x80 + 0x40
 *      with 2+4 stride
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
await page.waitForSelector('[data-node-hover-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restRings = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-node-hover-ring]')).map(el => ({
    alias:  el.getAttribute('data-node-hover-ring'),
    layers: el.getAttribute('data-node-hover-ring-halo-layers'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 2px \$\{status\.primary\}80\) drop-shadow\(0 0 4px \$\{status\.primary\}40\)`/.test(src);
const sourceLayersAttr = /data-node-hover-ring-halo-layers=\{hoveredAlias === session\.alias \? '2' : '0'\}/.test(src);

const restAllZero = restRings.every(r => r.layers === '0');

const results = {
  rings_present:      restRings.length >= 2,
  rest_all_zero:      restAllZero,
  source_filter:      sourceFilter,
  source_layers_attr: sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R666 per-node hover ring multi-layer halo (1st per-node-hover-ring anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restRings)}`);
process.exit(ok ? 0 : 1);
