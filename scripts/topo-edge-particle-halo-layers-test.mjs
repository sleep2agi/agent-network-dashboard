/* Round 679 — edge flow particle (the moving SMIL circle) extends
 * single-axis brightness hover to 2-layer drop-shadow at pal.flow-
 * Particle tint with 2+4 stride, alpha 80/40. Closes per-edge ALL
 * 5 surfaces multi-layer (badge circle + badge digit + visible path
 * + flow-rail + flow particle). 38th anchor in family.
 *
 * Source assertions:
 *   - light filter uses pal.flowParticle at 80/40, 2+4 stride
 *   - cyber filter prepends drop-shadows before url(#topo-glow)
 *   - data-edge-particle-halo-layers attr toggles '2' ↔ '0'
 *
 * Runtime assertions:
 *   - particles present in DOM (reduced-motion must be off)
 *   - all rest: halo-layers='0'
 *   - cross-particle gate-consistency: brightness ↔ layers
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1200 },
  reducedMotion: 'no-preference',
});
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'), mk('a·3'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', kind: 'message', content: 'p',  network_id: 'default', created_at: fresh },
  { id: 'm2', from_alias: 'a·2', to_alias: 'a·3', kind: 'task',    content: 'p2', network_id: 'default', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-particle-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-edge-particle]')).map(el => ({
    edge:       el.getAttribute('data-edge-particle'),
    layers:     el.getAttribute('data-edge-particle-halo-layers'),
    brightness: el.getAttribute('data-edge-particle-brightness'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLight  = /isLight\s*\?\s*`drop-shadow\(0 0 2px \$\{pal\.flowParticle\}80\) drop-shadow\(0 0 4px \$\{pal\.flowParticle\}40\) brightness\(1\.15\)`/.test(src);
const sourceCyber  = /:\s*`drop-shadow\(0 0 2px \$\{pal\.flowParticle\}80\) drop-shadow\(0 0 4px \$\{pal\.flowParticle\}40\) url\(#topo-glow\) brightness\(1\.15\)`/.test(src);
const sourceAttr   = /data-edge-particle-halo-layers=\{\(isHoveredEdge \|\| isEndpointHoveredEdge\) \? '2' : '0'\}/.test(src);

const allConsistent = restState.every(e =>
  (e.brightness === '1' && e.layers === '0') ||
  (e.brightness === '1.15' && e.layers === '2')
);

const results = {
  particles_present:    restState.length >= 2,
  rest_all_layers_zero: restState.every(e => e.layers === '0'),
  rest_gate_consistent: allConsistent,
  source_light_filter:  sourceLight,
  source_cyber_filter:  sourceCyber,
  source_layers_attr:   sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R679 edge flow particle multi-layer halo (closes per-edge 5/5 surfaces):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
