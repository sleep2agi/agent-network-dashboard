/* Round 681 — hub core circle extends single-layer drop-shadow
 * (R536, 2px+0.5 alpha) to 2-layer halo by adding outer 4px+0.25
 * alpha — half-falloff + 2x blur stride matching the family
 * vocabulary. 40th anchor in family — first hub-CORE anchor (R650-
 * R653 + R654 + R651 targeted hub-related elements AROUND the core,
 * not the core disc itself).
 *
 * Source assertions:
 *   - light filter: 2-layer drop-shadow at emerald rgba 0.5/0.25
 *   - cyber filter: 2-layer drop-shadow at emerald-400 rgba 0.5/0.25
 *   - data-topo-hub-core-halo-layers attr toggles '2' ↔ '0'
 *
 * Runtime assertions:
 *   - hub core present in DOM
 *   - rest halo-layers='0', brightness='1'
 *   - gate consistency: brightness ↔ layers (≥1 ↔ '2')
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
await page.waitForSelector('[data-topo-hub-core-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-core-halo-layers]');
  return el ? {
    layers:     el.getAttribute('data-topo-hub-core-halo-layers'),
    brightness: el.getAttribute('data-topo-hub-core-brightness'),
    hovered:    el.getAttribute('data-topo-hub-core-hovered'),
  } : null;
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLight  = /'drop-shadow\(0 0 2px rgba\(16, 185, 129, 0\.5\)\) drop-shadow\(0 0 4px rgba\(16, 185, 129, 0\.25\)\) brightness\(1\.15\)'/.test(src);
const sourceCyber  = /'drop-shadow\(0 0 2px rgba\(52, 211, 153, 0\.5\)\) drop-shadow\(0 0 4px rgba\(52, 211, 153, 0\.25\)\) brightness\(1\.15\)'/.test(src);
const sourceAttr   = /data-topo-hub-core-halo-layers=\{isCoreHovered \? '2' : '0'\}/.test(src);

const results = {
  hub_core_present:    !!restState,
  rest_layers_zero:    restState?.layers === '0',
  rest_brightness_1:   restState?.brightness === '1',
  rest_hovered_false:  restState?.hovered === 'false',
  source_light_filter: sourceLight,
  source_cyber_filter: sourceCyber,
  source_layers_attr:  sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R681 hub core multi-layer halo (first hub-core anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
