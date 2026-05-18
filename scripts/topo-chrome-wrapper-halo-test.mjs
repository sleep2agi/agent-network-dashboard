/* Round 697 — chrome strip segmented-control wrappers (Layout /
 * nodeSize / zoom containers) gain wrapper-level multi-layer halo
 * via CSS :has(button:hover) on the 3 wrappers' data-attrs. Pre-R697
 * only individual inner buttons halo'd (R667-R675 per-button); the
 * parent wrappers stayed flat. R697 closes the chrome-strip "active
 * control group" signal at the parent scope.
 *
 * Source assertions:
 *   - globals.css :has(button:hover) rule covers all 3 wrappers
 *   - globals.css transition rule for the 3 wrappers includes filter
 *   - TopoGraph.tsx Layout wrapper has data-topo-chrome-wrapper-halo-family="layout"
 *   - TopoGraph.tsx nodeSize wrapper has data-topo-chrome-wrapper-halo-family="nodesize"
 *   - TopoGraph.tsx zoom wrapper has data-topo-chrome-wrapper-halo-family="zoom"
 *
 * Runtime assertions:
 *   - all 3 wrappers present in DOM with halo-family data-attrs
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
await page.waitForSelector('[data-topo-chrome-wrapper-halo-family]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const wrappers = Array.from(document.querySelectorAll('[data-topo-chrome-wrapper-halo-family]'));
  return wrappers.map(w => w.getAttribute('data-topo-chrome-wrapper-halo-family')).sort();
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');

const cssHoverRule = /\[data-topo-chrome-layout-trailer\]:has\(button:hover\),[\s\S]*?\[data-topo-chrome-fleet-group-trailer\]:has\(button:hover\),[\s\S]*?\[data-topo-chrome-zoom-wrapper\]:has\(button:hover\)\s*\{[\s\S]*?drop-shadow\(0 0 2px rgba\(103, 232, 249, 0\.5\)\)[\s\S]*?drop-shadow\(0 0 4px rgba\(103, 232, 249, 0\.25\)\)/.test(cssSrc);
const cssTransition = /\[data-topo-chrome-layout-trailer\],[\s\S]*?\[data-topo-chrome-fleet-group-trailer\],[\s\S]*?\[data-topo-chrome-zoom-wrapper\]\s*\{[\s\S]*?transition:[\s\S]*?filter 200ms/.test(cssSrc);
const tsxLayoutAttr  = /data-topo-chrome-wrapper-halo-family="layout"/.test(tsxSrc);
const tsxNodesizeAttr = /data-topo-chrome-wrapper-halo-family="nodesize"/.test(tsxSrc);
const tsxZoomAttr    = /data-topo-chrome-wrapper-halo-family="zoom"/.test(tsxSrc);

const expectedFamilies = ['layout', 'nodesize', 'zoom'];

const results = {
  wrappers_count:      runtimeState.length === 3,
  wrappers_families:   JSON.stringify(runtimeState) === JSON.stringify(expectedFamilies),
  css_hover_rule:      cssHoverRule,
  css_transition:      cssTransition,
  tsx_layout_attr:     tsxLayoutAttr,
  tsx_nodesize_attr:   tsxNodesizeAttr,
  tsx_zoom_attr:       tsxZoomAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R697 chrome wrapper :has() multi-layer halo (53rd anchor — 3 wrappers via CSS rule):`,
  JSON.stringify(results, null, 2),
  `\n  runtime families: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
