/* Round 613 — per-node label card stacks brightness(1.15)
 * onto R142's hover drop-shadow. 4th paint axis on the card's
 * hover signature. Same banked R582/R583 stacked-filter pattern.
 *
 * Test phases:
 *   1. mock 2 idle nodes → label cards render
 *   2. rest: filter contains rest drop-shadow but NO brightness,
 *      brightness-attr='1'
 *   3. computed transition-property contains 'filter'
 *   4. source: stacked filter conditional + data-attr
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
await page.waitForSelector('[data-node-label-card-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-label-card-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-node-label-card-brightness'),
    elevationAttr: el.getAttribute('data-node-label-card-elevation'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceCyberStack = /'drop-shadow\(0 4px 12px rgba\(0,0,0,0\.60\)\) brightness\(1\.15\)'/.test(src);
const sourceLightStack = /'drop-shadow\(0 3px 8px rgba\(15,23,42,0\.20\)\) brightness\(1\.15\)'/.test(src);
const sourceAttr = /data-node-label-card-brightness=\{!reducedMotion && hoveredAlias === session\.alias \? '1\.15' : '1'\}/.test(src);

const results = {
  card_present:           !!rest,
  // At rest: rest-tier drop-shadow but no brightness
  rest_has_drop_shadow:   /drop-shadow/.test(rest?.filter || ''),
  rest_no_brightness:     !/brightness/.test(rest?.filter || ''),
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_elevation_idle:    rest?.elevationAttr === 'idle',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_cyber_stack:     sourceCyberStack,
  source_light_stack:     sourceLightStack,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R613 label card stacked brightness (4-axis hover paint signature):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
