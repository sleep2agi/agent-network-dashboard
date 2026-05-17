/* Round 585 verification: edge endpoint emphasis ring gains
 * filter brightness(1.15) when isEndpoint activates. 24th
 * anchor in per-element brightness family, fourth edge-tier
 * paint layer (rail R581 + curve R582 + particle R583 +
 * endpoint-ring R585).
 *
 * Test phases:
 *   1. mock 2 idle nodes, 0 messages → endpoint rings render
 *      (opacity=0 at rest, isEndpoint=false)
 *   2. rest: filter='none', brightness-attr='1', active='false'
 *   3. transition-property contains 'filter'
 *   4. source: filter conditional + data-attr + transition extension
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
await page.waitForSelector('[data-edge-endpoint-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-endpoint-ring]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-edge-endpoint-ring-brightness'),
    activeAttr: el.getAttribute('data-edge-endpoint-active'),
    opacity: cs.opacity,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: isEndpoint \? 'brightness\(1\.15\)' : undefined/.test(src);
const sourceAttr = /data-edge-endpoint-ring-brightness=\{isEndpoint \? '1\.15' : '1'\}/.test(src);
const sourceTransition = /transition: 'opacity 180ms ease-out, stroke-width 180ms ease-out, r 180ms ease-out, filter 180ms ease-out'/.test(src);

const results = {
  ring_present:           !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_active_false:      rest?.activeAttr === 'false',
  rest_opacity_zero:      parseFloat(rest?.opacity || '1') === 0,
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R585 endpoint-ring brightness (24th anchor, edge-tier 4/4):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
