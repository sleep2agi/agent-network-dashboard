/* Round 654 — hub-spoke drop-shadow gains a SECOND outer layer at
 * 3px + 0.2 alpha. CLOSES hub-cluster glow QUINTET at 5/5 multi-
 * layer (R533 was the last single-layer hub element after R650-R653).
 *
 * Test phases:
 *   1. mock 2 nodes → hub-spokes render (one per non-hub node)
 *   2. rest: all spokes halo-layers='0', no drop-shadow filter
 *   3. open chat with a·1 → R636 isHoveredSpoke fires → that spoke
 *      gets halo-layers='2', computed filter has 2 drop-shadow
 *      substrings with teal/cyan tint (rgba(34,211,238,...) on cyber)
 *   4. source: both light + cyber branches stack 2 drop-shadows
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
await page.waitForSelector('[data-topo-hub-spoke-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restSpokes = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-topo-hub-spoke-halo-layers]')).map(el => ({
    layers: el.getAttribute('data-topo-hub-spoke-halo-layers'),
    glow:   el.getAttribute('data-topo-hub-spoke-glow'),
  }));
});

// Open chat to fire isHoveredSpoke on a·1's spoke
await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const activeState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-topo-hub-spoke-halo-layers]')).map(el => {
    const cs = getComputedStyle(el);
    return {
      layers: el.getAttribute('data-topo-hub-spoke-halo-layers'),
      glow:   el.getAttribute('data-topo-hub-spoke-glow'),
      self:   el.getAttribute('data-topo-hub-spoke-brightness-self'),
      filter: cs.filter,
    };
  });
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLight = /'drop-shadow\(0 0 1\.5px rgba\(13, 148, 136, 0\.4\)\) drop-shadow\(0 0 3px rgba\(13, 148, 136, 0\.2\)\) brightness\(1\.15\)'/.test(src);
const sourceCyber = /'drop-shadow\(0 0 1\.5px rgba\(34, 211, 238, 0\.4\)\) drop-shadow\(0 0 3px rgba\(34, 211, 238, 0\.2\)\) brightness\(1\.15\)'/.test(src);
const sourceLayersAttr = /data-topo-hub-spoke-halo-layers=\{!reducedMotion && \(hoveredHub \|\| isHoveredSpoke\) \? '2' : '0'\}/.test(src);

const restAllZero = restSpokes.every(s => s.layers === '0' && s.glow === 'false');
const activeSpokes = activeState.filter(s => s.self === 'true');
const activeAllTwoLayers = activeSpokes.length >= 1
  && activeSpokes.every(s => s.layers === '2'
                          && (s.filter?.match(/drop-shadow/g) || []).length === 2);

const results = {
  spokes_present:       restSpokes.length >= 2,
  rest_all_zero:        restAllZero,
  active_exactly_one:   activeSpokes.length === 1,
  active_all_two_layers:activeAllTwoLayers,
  source_light:         sourceLight,
  source_cyber:         sourceCyber,
  source_layers_attr:   sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R654 hub-spoke multi-layer halo (CLOSES hub-cluster glow QUINTET at 5/5):`,
  JSON.stringify(results, null, 2),
  `\n  rest:   ${JSON.stringify(restSpokes)}`,
  `\n  active: ${JSON.stringify(activeState)}`);
process.exit(ok ? 0 : 1);
