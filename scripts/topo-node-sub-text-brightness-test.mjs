/* Round 567 verification: node sub-text gains filter brightness(1.15)
 * on hover. Joins R501/R558/R564 per-node hover-brightness family
 * at 6th anchor.
 *
 * Test phases:
 *   1. rest: filter='none', brightness-attr='1'
 *   2. hover the node group → filter='brightness(1.15)';
 *      brightness-attr='1.15'
 *   3. transition-property contains 'filter'
 *   4. source-side regex confirms wiring
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
await page.waitForSelector('[data-node-sub-text="a·1"]', { timeout: 15000 });
await page.waitForTimeout(500);

const subSel = '[data-node-sub-text="a·1"]';
const probe = () => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-node-sub-text-brightness'),
    hoveredAttr: el.getAttribute('data-node-sub-text-hovered'),
  };
}, subSel);

const rest = await probe();
await page.hover('g[data-node="a·1"]');
await page.waitForTimeout(400);
const hover = await probe();

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: !reducedMotion && hoveredAlias === session\.alias\s*\?\s*'brightness\(1\.15\)'\s*:\s*undefined/.test(src);
const sourceAttr = /data-node-sub-text-brightness=\{!reducedMotion && hoveredAlias === session\.alias \? '1\.15' : '1'\}/.test(src);
const sourceTransition = /transition: 'fill 300ms ease-out, letter-spacing 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  hover_filter_1_15:      /brightness\(1\.15\)/.test(hover?.filter || ''),
  hover_brightness_1_15:  hover?.brightnessAttr === '1.15',
  hover_hovered_true:     hover?.hoveredAttr === 'true',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R567 node sub-text brightness(1.15) on hover:`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`,
  `\n  hover: ${JSON.stringify(hover)}`);
process.exit(ok ? 0 : 1);
