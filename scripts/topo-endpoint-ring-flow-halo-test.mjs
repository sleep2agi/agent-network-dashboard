/* Round 639 — endpoint emphasis ring filter gains a stroke-tinted
 * drop-shadow halo on isEndpoint. Halo color matches pal.flowEdge
 * stroke (cyber cyan / light emerald). 3rd anchor in chromatic-
 * identity family at the per-node ring surface.
 *
 * Test phases:
 *   1. mock 2 nodes + 1 message → 1 edge, hover edge to trigger
 *      hoveredEdgeEndpoints → endpoint ring opacity > 0
 *   2. rest (no edge hover): all endpoint rings halo-color='none',
 *      endpoint-active='false'
 *   3. hover edge → 2 endpoint rings turn active; halo-color
 *      matches pal.flowEdge (cyber: #67e8f9, light: #10b981);
 *      computed filter contains drop-shadow + brightness
 *   4. source: filter expression uses ${pal.flowEdge}40 in drop-shadow
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
// 3 messages → edge badge becomes visible + clickable (R215 threshold)
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

// rest: collect endpoint ring halo colors (should all be 'none')
const restRings = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-edge-endpoint-ring]')).map(el => ({
    haloColor: el.getAttribute('data-edge-endpoint-ring-halo-color'),
    active:    el.getAttribute('data-edge-endpoint-active'),
  }));
});

// Pin the edge by clicking the recent-row tint rect (R116 lets
// recent-row click pin activeEdgeKey → hoveredEdgeEndpoints fires).
await page.click('[data-recent-row-tint-brightness]', { force: true });
await page.waitForTimeout(400);

const activeState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-edge-endpoint-ring]')).map(el => {
    const cs = getComputedStyle(el);
    return {
      haloColor: el.getAttribute('data-edge-endpoint-ring-halo-color'),
      active:    el.getAttribute('data-edge-endpoint-active'),
      brightness:el.getAttribute('data-edge-endpoint-ring-brightness'),
      filter:    cs.filter,
    };
  });
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 2px \$\{pal\.flowEdge\}40\) brightness\(1\.15\)`/.test(src);
const sourceHaloAttr = /data-edge-endpoint-ring-halo-color=\{isEndpoint \? pal\.flowEdge : 'none'\}/.test(src);

const restAllNone = restRings.every(r => r.haloColor === 'none' && r.active === 'false');
const activeRings = activeState.filter(s => s.active === 'true');
const activeAllHaloMatch = activeRings.length > 0
  && activeRings.every(s => /^#[0-9a-f]{6,8}$/i.test(s.haloColor || '')
                          && /drop-shadow/.test(s.filter || '')
                          && /brightness/.test(s.filter || ''));

const results = {
  rings_present:           restRings.length >= 2,
  rest_all_none:           restAllNone,
  active_at_least_two:     activeRings.length >= 2,
  active_brightness_1_15:  activeRings.every(s => s.brightness === '1.15'),
  active_halo_match:       activeAllHaloMatch,
  source_filter:           sourceFilter,
  source_halo_attr:        sourceHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R639 endpoint emphasis ring stroke-tinted halo (chromatic identity 3rd anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest:   ${JSON.stringify(restRings)}`,
  `\n  active: ${JSON.stringify(activeState)}`);
process.exit(ok ? 0 : 1);
