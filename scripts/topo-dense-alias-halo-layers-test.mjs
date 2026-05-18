/* Round 680 — dense plain-text alias (the >16-node fallback label)
 * extends from group-hover:-translate-y geometry-only to 2-layer
 * drop-shadow at status.primary tint with 2+4 stride, alpha 80/40.
 * Closes the dense-mode alias hover signature parity with normal-
 * mode card label (R645). 39th anchor in family — first dense-mode
 * anchor.
 *
 * Source assertions:
 *   - filter uses status.primary at 0x80 + 0x40 with 2+4 stride,
 *     gated on hoveredAlias === session.alias
 *   - data-node-dense-alias-text-halo-layers attr toggles '2' ↔ '0'
 *   - transition extends with 'filter 200ms ease-out'
 *
 * Runtime assertions:
 *   - dense alias labels present (>16 nodes)
 *   - all rest: halo-layers='0'
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
  // 18 nodes triggers dense fallback (>16 nodes)
  await route.fulfill({ response: r, json: { ...b, sessions: Array.from({ length: 18 }, (_, i) => mk(`a·${i + 1}`)) } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-dense-alias-text-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-node-dense-alias-text]')).map(el => ({
    alias:  el.getAttribute('data-node-dense-alias-text'),
    layers: el.getAttribute('data-node-dense-alias-text-halo-layers'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter      = /filter: hoveredAlias === session\.alias\s*\?\s*`drop-shadow\(0 0 2px \$\{status\.primary\}80\) drop-shadow\(0 0 4px \$\{status\.primary\}40\)`/.test(src);
const sourceLayersAttr  = /data-node-dense-alias-text-halo-layers=\{hoveredAlias === session\.alias \? '2' : '0'\}/.test(src);
const sourceTransition  = /transition: 'transform 200ms ease-out, fill 300ms ease-out, filter 200ms ease-out'/.test(src);

const restAllZero = restState.every(e => e.layers === '0');

const results = {
  dense_aliases_present: restState.length >= 10,    // 18 nodes should yield ~18 dense labels
  rest_all_layers_zero:  restAllZero,
  source_filter:         sourceFilter,
  source_layers_attr:    sourceLayersAttr,
  source_transition:     sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R680 dense plain-text alias multi-layer halo (first dense-mode anchor):`,
  JSON.stringify(results, null, 2),
  `\n  count: ${restState.length}, sample: ${JSON.stringify(restState.slice(0, 3))}`);
process.exit(ok ? 0 : 1);
