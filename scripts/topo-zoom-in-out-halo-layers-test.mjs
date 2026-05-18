/* Round 673 — chrome zoom-in + zoom-out buttons gain multi-layer
 * halo on hover via new hoveredZoomIn / hoveredZoomOut state. Pre-
 * R673 these buttons had only Tailwind hover:brightness-[1.15] (R596)
 * — a single-axis paint lift. Post-R673 inline filter uses the same
 * 2+4 stride at pal.legendAccent tint as R667 reset+fullscreen and
 * R668 zoom-level pill. The chrome zoom-strip (zoom-out + zoom-level
 * + zoom-in) is now FULLY halo-extended at all 3 controls.
 *
 * 32nd anchor in multi-layer halo family (paired sibling extension).
 *
 * Source assertions:
 *   - useState pair for hoveredZoomIn / hoveredZoomOut
 *   - both buttons' onMouseEnter/Leave wired
 *   - both inline filters use pal.legendAccent 2+4 stride alpha 80/40
 *   - data-topo-chrome-zoom-{in,out}-halo-layers attrs toggle '2'/'0'
 *
 * Runtime assertions:
 *   - both buttons present in DOM
 *   - rest state: halo-layers='0' on both
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
await page.waitForSelector('[data-topo-chrome-zoom-in-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  const zin  = document.querySelector('[data-topo-chrome-zoom-in-halo-layers]');
  const zout = document.querySelector('[data-topo-chrome-zoom-out-halo-layers]');
  return {
    zin_present:  !!zin,
    zout_present: !!zout,
    zin_layers:   zin?.getAttribute('data-topo-chrome-zoom-in-halo-layers'),
    zout_layers:  zout?.getAttribute('data-topo-chrome-zoom-out-halo-layers'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceState        = /const \[hoveredZoomIn, setHoveredZoomIn\] = useState\(false\);/.test(src) &&
                           /const \[hoveredZoomOut, setHoveredZoomOut\] = useState\(false\);/.test(src);
const sourceZinHandler   = /onMouseEnter=\{\(\) => setHoveredZoomIn\(true\)\}/.test(src) &&
                           /onMouseLeave=\{\(\) => setHoveredZoomIn\(false\)\}/.test(src);
const sourceZoutHandler  = /onMouseEnter=\{\(\) => setHoveredZoomOut\(true\)\}/.test(src) &&
                           /onMouseLeave=\{\(\) => setHoveredZoomOut\(false\)\}/.test(src);
const sourceZinFilter    = /filter: hoveredZoomIn \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceZoutFilter   = /filter: hoveredZoomOut \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceZinAttr      = /data-topo-chrome-zoom-in-halo-layers=\{hoveredZoomIn \? '2' : '0'\}/.test(src);
const sourceZoutAttr     = /data-topo-chrome-zoom-out-halo-layers=\{hoveredZoomOut \? '2' : '0'\}/.test(src);

const results = {
  zin_present:        restState.zin_present,
  zout_present:       restState.zout_present,
  rest_zin_layers_0:  restState.zin_layers === '0',
  rest_zout_layers_0: restState.zout_layers === '0',
  source_state:       sourceState,
  source_zin_handler: sourceZinHandler,
  source_zout_handler:sourceZoutHandler,
  source_zin_filter:  sourceZinFilter,
  source_zout_filter: sourceZoutFilter,
  source_zin_attr:    sourceZinAttr,
  source_zout_attr:   sourceZoutAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R673 chrome zoom-in/-out multi-layer halo (completes chrome zoom-strip trio):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
