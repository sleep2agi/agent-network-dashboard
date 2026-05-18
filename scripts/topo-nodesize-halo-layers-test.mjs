/* Round 675 — chrome nodeSize S/M/L segmented trio gains multi-layer
 * halo on hover via new hoveredNodeSize state ('S'|'M'|'L'|null).
 * Pre-R675 the trio had only Tailwind hover:brightness-[1.15] (R598).
 * Post-R675 inline filter uses the same 2+4 stride at pal.legendAccent
 * tint as R667/R668/R673/R674 chrome-control siblings. With R675 the
 * chrome strip is FULLY halo-extended across ALL 10 interactive
 * controls.
 *
 * 34th anchor in multi-layer halo family (triplet sibling extension).
 *
 * Source assertions:
 *   - useState<'S'|'M'|'L'|null>
 *   - mouse handlers wire lbl into the value-typed setter w/ leave-guard
 *   - inline filter uses pal.legendAccent 2+4 stride alpha 80/40
 *   - data-topo-chrome-nodesize-halo-layers attr toggles '2'/'0'
 *
 * Runtime assertions:
 *   - all 3 buttons (S/M/L) present
 *   - rest state: halo-layers='0' on all
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
await page.waitForSelector('[data-topo-chrome-nodesize-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-topo-chrome-nodesize]')).map(el => ({
    lbl:    el.getAttribute('data-topo-chrome-nodesize'),
    layers: el.getAttribute('data-topo-chrome-nodesize-halo-layers'),
    active: el.getAttribute('data-topo-chrome-nodesize-active'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceState         = /const \[hoveredNodeSize, setHoveredNodeSize\] = useState<'S' \| 'M' \| 'L' \| null>\(null\);/.test(src);
const sourceMouseHandlers = /onMouseEnter=\{\(\) => setHoveredNodeSize\(lbl\)\}/.test(src) &&
                            /onMouseLeave=\{\(\) => setHoveredNodeSize\(\(prev\) => prev === lbl \? null : prev\)\}/.test(src);
const sourceFilter        = /filter: hoveredNodeSize === lbl \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceLayersAttr    = /data-topo-chrome-nodesize-halo-layers=\{hoveredNodeSize === lbl \? '2' : '0'\}/.test(src);

const trio = restState.map(e => e.lbl).join(',');
const trioComplete  = ['S', 'M', 'L'].every(k => restState.some(e => e.lbl === k));
const restAllZero   = restState.every(e => e.layers === '0');

const results = {
  trio_complete:        trioComplete,
  three_buttons:        restState.length === 3,
  rest_all_layers_zero: restAllZero,
  source_state:         sourceState,
  source_handlers:      sourceMouseHandlers,
  source_filter:        sourceFilter,
  source_layers_attr:   sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R675 chrome nodeSize S/M/L multi-layer halo (completes chrome strip 10/10):`,
  JSON.stringify(results, null, 2),
  `\n  trio: ${trio}\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
