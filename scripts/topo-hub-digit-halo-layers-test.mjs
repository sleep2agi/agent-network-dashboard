/* Round 650 · MILESTONE — hub digit drop-shadow gains a SECOND
 * outer layer at 4px/6px blur with halved alpha. 9th anchor in
 * multi-layer halo family (1st hub-cluster anchor).
 *
 * Test phases:
 *   1. mock 2 working nodes → hub working-count digit renders
 *   2. rest (no hub hover): digit halo-layers='0', no filter
 *   3. source: both light + cyber filter branches stack 2 drop-
 *      shadows with emerald tint at descending alphas
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-hub-working-count-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-working-count-halo-layers]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    layers: el.getAttribute('data-topo-hub-working-count-halo-layers'),
    glow:   el.getAttribute('data-topo-hub-working-count-glow'),
    filter: cs.filter,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLight = /'drop-shadow\(0 0 2px rgba\(16, 185, 129, 0\.6\)\) drop-shadow\(0 0 4px rgba\(16, 185, 129, 0\.3\)\) brightness\(1\.15\)'/.test(src);
const sourceCyber = /'drop-shadow\(0 0 3px rgba\(52, 211, 153, 0\.6\)\) drop-shadow\(0 0 6px rgba\(52, 211, 153, 0\.3\)\) brightness\(1\.15\)'/.test(src);
const sourceLayersAttr = /data-topo-hub-working-count-halo-layers=\{!reducedMotion && hoveredHub \? '2' : '0'\}/.test(src);

const results = {
  rest_present:           !!rest,
  rest_layers_0:          rest?.layers === '0',
  rest_glow_false:        rest?.glow === 'false',
  rest_filter_none_or_no_drop_shadow: rest?.filter === 'none' || !/drop-shadow/.test(rest?.filter || ''),
  source_light_filter:    sourceLight,
  source_cyber_filter:    sourceCyber,
  source_layers_attr:     sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R650 hub digit multi-layer halo (MILESTONE — 1st hub-cluster anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
