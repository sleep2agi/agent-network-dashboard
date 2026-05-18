/* Round 674 — chrome Layout Ring/Grid toggle pair gain multi-layer
 * halo on hover via new hoveredLayout state ('ring'|'grid'|null).
 * Pre-R674 these buttons had only Tailwind hover:brightness-[1.15]
 * (R597). Post-R674 inline filter uses the same 2+4 stride at pal.
 * legendAccent tint as R667/R668/R673 chrome-control siblings,
 * completing the chrome toggle-controls family closure.
 *
 * 33rd anchor in multi-layer halo family (paired sibling extension).
 *
 * Source assertions:
 *   - useState<'ring'|'grid'|null>
 *   - both buttons' onMouseEnter/Leave wired with value-typed setter
 *   - both inline filters use pal.legendAccent 2+4 stride alpha 80/40
 *   - data-topo-chrome-layout-{ring,grid}-halo-layers attrs toggle '2'/'0'
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
await page.waitForSelector('[data-topo-chrome-layout-ring-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  const ring = document.querySelector('[data-topo-chrome-layout="ring"]');
  const grid = document.querySelector('[data-topo-chrome-layout="grid"]');
  return {
    ring_present: !!ring,
    grid_present: !!grid,
    ring_layers:  ring?.getAttribute('data-topo-chrome-layout-ring-halo-layers'),
    grid_layers:  grid?.getAttribute('data-topo-chrome-layout-grid-halo-layers'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceState        = /const \[hoveredLayout, setHoveredLayout\] = useState<'ring' \| 'grid' \| null>\(null\);/.test(src);
const sourceRingHandler  = /onMouseEnter=\{\(\) => setHoveredLayout\('ring'\)\}/.test(src) &&
                           /onMouseLeave=\{\(\) => setHoveredLayout\(\(prev\) => prev === 'ring' \? null : prev\)\}/.test(src);
const sourceGridHandler  = /onMouseEnter=\{\(\) => setHoveredLayout\('grid'\)\}/.test(src) &&
                           /onMouseLeave=\{\(\) => setHoveredLayout\(\(prev\) => prev === 'grid' \? null : prev\)\}/.test(src);
const sourceRingFilter   = /filter: hoveredLayout === 'ring' \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceGridFilter   = /filter: hoveredLayout === 'grid' \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceRingAttr     = /data-topo-chrome-layout-ring-halo-layers=\{hoveredLayout === 'ring' \? '2' : '0'\}/.test(src);
const sourceGridAttr     = /data-topo-chrome-layout-grid-halo-layers=\{hoveredLayout === 'grid' \? '2' : '0'\}/.test(src);

const results = {
  ring_present:        restState.ring_present,
  grid_present:        restState.grid_present,
  rest_ring_layers_0:  restState.ring_layers === '0',
  rest_grid_layers_0:  restState.grid_layers === '0',
  source_state:        sourceState,
  source_ring_handler: sourceRingHandler,
  source_grid_handler: sourceGridHandler,
  source_ring_filter:  sourceRingFilter,
  source_grid_filter:  sourceGridFilter,
  source_ring_attr:    sourceRingAttr,
  source_grid_attr:    sourceGridAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R674 chrome Layout ring/grid toggle multi-layer halo:`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
