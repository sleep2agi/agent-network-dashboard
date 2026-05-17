/* Round 614 — hub-core stacks drop-shadow + brightness on
 * isCoreHovered. Extends hub-cluster brightness coverage to a
 * 6th concentric element (innermost emerald r=10 disc).
 *
 * Test phases:
 *   1. mock 2 idle nodes → hub core renders
 *   2. rest (no hub hover): filter='none', brightness-attr='1',
 *      glow-attr='false'
 *   3. computed transition-property contains 'filter'
 *   4. source: stacked filter conditional + data-attrs +
 *      transition extension
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
await page.waitForSelector('[data-topo-hub-core]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-core]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-topo-hub-core-brightness'),
    glowAttr: el.getAttribute('data-topo-hub-core-glow'),
    hoveredAttr: el.getAttribute('data-topo-hub-core-hovered'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterCyber = /'drop-shadow\(0 0 2px rgba\(52, 211, 153, 0\.5\)\) brightness\(1\.15\)'/.test(src);
const sourceFilterLight = /'drop-shadow\(0 0 2px rgba\(16, 185, 129, 0\.5\)\) brightness\(1\.15\)'/.test(src);
const sourceAttr = /data-topo-hub-core-brightness=\{isCoreHovered \? '1\.15' : '1'\}/.test(src);

const results = {
  core_present:           !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_glow_false:        rest?.glowAttr === 'false',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter_cyber:    sourceFilterCyber,
  source_filter_light:    sourceFilterLight,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R614 hub-core stacked brightness (cluster 6/6 concentric):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
