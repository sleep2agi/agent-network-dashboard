/* Round 564 verification: per-node alias text gains stacked filter
 * brightness(1.15) on top of R500 drop-shadow on hover. Mirrors
 * R542 pressure-seg pattern.
 *
 * Test phases:
 *   1. rest: filter = 'none', brightness-attr = '1'
 *   2. hover: filter contains BOTH drop-shadow AND brightness(1.15);
 *      brightness-attr = '1.15'
 *   3. source-side regex confirms stacked filter expression
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-alias-text="a·1"]', { timeout: 15000 });
await page.waitForTimeout(500);

const aliasSel = '[data-node-alias-text="a·1"]';
const probe = () => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    glowAttr: el.getAttribute('data-node-alias-glow'),
    brightnessAttr: el.getAttribute('data-node-alias-brightness'),
  };
}, aliasSel);

const rest = await probe();
await page.hover('g[data-node="a·1"]');
await page.waitForTimeout(400);
const hover = await probe();

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: !reducedMotion && hoveredAlias === session\.alias\s*\?\s*`drop-shadow\(0 0 2px \$\{status\.text\}80\) brightness\(1\.15\)`/.test(src);
const sourceAttr = /data-node-alias-brightness=\{!reducedMotion && hoveredAlias === session\.alias \? '1\.15' : '1'\}/.test(src);

const results = {
  rest_filter_none:           rest?.filter === 'none',
  rest_glow_false:            rest?.glowAttr === 'false',
  rest_brightness_1:          rest?.brightnessAttr === '1',
  hover_filter_has_dropshadow: /drop-shadow\(/.test(hover?.filter || ''),
  hover_filter_has_brightness: /brightness\(1\.15\)/.test(hover?.filter || ''),
  hover_glow_true:            hover?.glowAttr === 'true',
  hover_brightness_1_15:      hover?.brightnessAttr === '1.15',
  source_filter:              sourceFilter,
  source_attr:                sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R564 per-node alias text brightness(1.15) stacked on R500 drop-shadow:`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`,
  `\n  hover: ${JSON.stringify(hover)}`);
process.exit(ok ? 0 : 1);
