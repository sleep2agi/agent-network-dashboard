/* Round 668 — chrome zoom-level readout (the percent pill between
 * zoom-out and zoom-in) extends its single-axis brightness(1.15)
 * hover paint to the 2-layer drop-shadow halo vocabulary used by
 * R667 reset + fullscreen siblings. 27th anchor in multi-layer
 * halo family — 2nd chrome-control anchor.
 *
 * Source assertions:
 *   - filter expression uses pal.legendAccent tint at 0x80 + 0x40
 *     with 2+4 stride, gated on hoveredZoomLevel
 *   - data-topo-chrome-zoom-level-halo-layers data-attr toggles
 *     '2' ↔ '0' on hover
 *
 * Runtime assertions:
 *   - the readout span is present in DOM and starts at halo-layers='0'
 *     (no hover at initial render)
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
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  return el ? {
    layers:     el.getAttribute('data-topo-chrome-zoom-level-halo-layers'),
    hover:      el.getAttribute('data-topo-chrome-zoom-level-hover'),
    brightness: el.getAttribute('data-topo-chrome-zoom-level-brightness'),
  } : null;
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /hoveredZoomLevel \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceLayersAttr = /data-topo-chrome-zoom-level-halo-layers=\{hoveredZoomLevel \? '2' : '0'\}/.test(src);

const results = {
  readout_present:    !!restState,
  rest_layers_zero:   restState?.layers === '0',
  rest_hover_false:   restState?.hover === 'false',
  rest_brightness_1:  restState?.brightness === '1',
  source_filter:      sourceFilter,
  source_layers_attr: sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R668 chrome zoom-level multi-layer halo (2nd chrome-control anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
