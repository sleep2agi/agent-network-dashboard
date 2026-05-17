/* Round 644 — endpoint emphasis ring filter gains a SECOND drop-
 * shadow layer at 4px blur + 0x20 alpha, matching R643 status-
 * ring + R642 chat-target ring multi-layer halo. Closes the
 * 2-layer halo across all 3 per-node identity rings.
 *
 * Test phases:
 *   1. mock 2 nodes + 3 messages → 1 visible edge with badge
 *   2. rest: endpoint rings halo-layers='0', active='false'
 *   3. pin edge via recent-row click → both endpoint rings turn
 *      active=true, halo-layers='2', computed filter contains
 *      exactly 2 drop-shadow substrings with pal.flowEdge tint
 *   4. source: filter expression stacks 2 drop-shadows
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'one',   created_at: fresh },
  { from_alias: 'a·1', to_alias: 'a·2', content: 'two',   created_at: fresh },
  { from_alias: 'a·1', to_alias: 'a·2', content: 'three', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-endpoint-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restRings = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-edge-endpoint-ring]')).map(el => ({
    layers: el.getAttribute('data-edge-endpoint-ring-halo-layers'),
    active: el.getAttribute('data-edge-endpoint-active'),
  }));
});

await page.click('[data-recent-row-tint-brightness]', { force: true });
await page.waitForTimeout(400);

const activeState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-edge-endpoint-ring]')).map(el => {
    const cs = getComputedStyle(el);
    return {
      layers:    el.getAttribute('data-edge-endpoint-ring-halo-layers'),
      active:    el.getAttribute('data-edge-endpoint-active'),
      haloColor: el.getAttribute('data-edge-endpoint-ring-halo-color'),
      filter:    cs.filter,
    };
  });
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 2px \$\{pal\.flowEdge\}40\) drop-shadow\(0 0 4px \$\{pal\.flowEdge\}20\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-edge-endpoint-ring-halo-layers=\{isEndpoint \? '2' : '0'\}/.test(src);

const restAllZero = restRings.every(r => r.layers === '0' && r.active === 'false');
const activeRings = activeState.filter(s => s.active === 'true');
const activeAllTwoLayers = activeRings.length > 0
  && activeRings.every(s => s.layers === '2'
                          && (s.filter?.match(/drop-shadow/g) || []).length === 2
                          && /^#[0-9a-f]{6,8}$/i.test(s.haloColor || ''));

const results = {
  rings_present:           restRings.length >= 2,
  rest_all_zero:           restAllZero,
  active_at_least_2:       activeRings.length >= 2,
  active_all_two_layers:   activeAllTwoLayers,
  source_filter:           sourceFilter,
  source_layers_attr:      sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R644 endpoint emphasis ring multi-layer halo (chromatic-identity 3-ring family closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest:   ${JSON.stringify(restRings)}`,
  `\n  active: ${JSON.stringify(activeState)}`);
process.exit(ok ? 0 : 1);
