/* Round 682 — group cluster box (grid-layout prefix-group rect)
 * extends filter chain from `url(#topo-groupbox-lift) brightness(1.15)`
 * to ADD 2-layer drop-shadow at pal.legendAccent tint between the SVG
 * elevation filter and the brightness — chain becomes:
 *   url(#topo-groupbox-lift)
 *   drop-shadow(0 0 3px ${pal.legendAccent}80)
 *   drop-shadow(0 0 6px ${pal.legendAccent}40)
 *   brightness(1.15)
 *
 * Cluster box and its R648 label now glow in lockstep when the group
 * is pinned or hovered. 41st anchor — first group-CLUSTER anchor.
 *
 * Source assertions:
 *   - filter chain has url(#topo-groupbox-lift) + 2 drop-shadows at
 *     pal.legendAccent + brightness(1.15)
 *   - data-group-box-halo-layers attr toggles '2' ↔ '0'
 *
 * Runtime assertions:
 *   - group cluster boxes present in grid layout (≥3 prefix groups)
 *   - rest: halo-layers='0' on all
 *   - gate consistency: brightness ↔ halo-layers
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
    localStorage.setItem('anet-topo-layout', 'grid');   // grid layout for cluster boxes
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
  // 3 prefix groups (a·X, b·X, c·X) so cluster boxes render
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'),
    mk('b·1'), mk('b·2'),
    mk('c·1'), mk('c·2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-box-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-group-box-halo-layers]')).map(el => ({
    layers:     el.getAttribute('data-group-box-halo-layers'),
    brightness: el.getAttribute('data-group-box-brightness'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /\? `url\(#topo-groupbox-lift\) drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)`/.test(src);
const sourceAttr   = /data-group-box-halo-layers=\{\(isPinned \|\| isHovered\) \? '2' : '0'\}/.test(src);

const allConsistent = restState.every(e =>
  (e.brightness === '1' && e.layers === '0') ||
  (e.brightness === '1.15' && e.layers === '2')
);

const results = {
  boxes_present:        restState.length >= 3,
  rest_all_layers_zero: restState.every(e => e.layers === '0'),
  rest_gate_consistent: allConsistent,
  source_filter:        sourceFilter,
  source_layers_attr:   sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R682 group cluster box multi-layer halo (first group-CLUSTER anchor):`,
  JSON.stringify(results, null, 2),
  `\n  count: ${restState.length}, sample: ${JSON.stringify(restState.slice(0, 3))}`);
process.exit(ok ? 0 : 1);
