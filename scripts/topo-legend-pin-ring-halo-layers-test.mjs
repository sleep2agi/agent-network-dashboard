/* Round 649 — legend pin-ring drop-shadow gains a SECOND outer
 * layer. 3rd panel-tier anchor in the multi-layer halo family
 * (after R647 freshness pip + R648 group label).
 *
 * Test phases:
 *   1. mock 2 nodes → legend renders with pin-rings
 *   2. rest: pin-rings halo-layers='0', opacity=0
 *   3. source: filter expression stacks 2 drop-shadows with
 *      row.fill tint at 0x88 + 0x44 alpha
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
await page.waitForSelector('[data-legend-pin-ring-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-legend-pin-ring-halo-layers]')).map(el => ({
    layers: el.getAttribute('data-legend-pin-ring-halo-layers'),
    pinned: el.getAttribute('data-legend-pin-ring-pinned'),
    opacity: el.getAttribute('opacity'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 3px \$\{row\.fill\}88\) drop-shadow\(0 0 6px \$\{row\.fill\}44\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-legend-pin-ring-halo-layers=\{isPinned \? '2' : '0'\}/.test(src);

const restAllZero = rest.every(r => r.layers === '0' && r.pinned === 'false' && r.opacity === '0');

const results = {
  rings_present:        rest.length >= 3,
  rest_all_zero:        restAllZero,
  source_filter:        sourceFilter,
  source_layers_attr:   sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R649 legend pin-ring multi-layer halo (panel-tier 3rd anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
