/* Round 603 — edge-badge CIRCLE stacks brightness(1.15) onto
 * R534/R480 drop-shadow on hover/pin/hot. 5th hover axis on
 * the badge ring; brings circle brightness to parity with the
 * R570 digit brightness within the same edge-badge unit.
 *
 * Test phases:
 *   1. mock 1 message → 1 flowLink → edge-badge renders
 *   2. rest: filter='none', brightness-attr='1'
 *   3. computed transition-property contains 'filter'
 *   4. source: stacked filter conditional includes brightness +
 *      data-attr extension
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-badge-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-edge-badge-brightness'),
    glowAttr: el.getAttribute('data-edge-badge-glow'),
    liftedAttr: el.getAttribute('data-edge-badge-lifted'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: \(isHoveredEdge \|\| isPinned\)\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}99\) brightness\(1\.15\)`\s*:\s*isHot\s*\?\s*`drop-shadow\(0 0 3px \$\{hotStroke\}80\) brightness\(1\.15\)`\s*:\s*undefined/.test(src);
const sourceAttr = /data-edge-badge-brightness=\{\(isHoveredEdge \|\| isPinned \|\| isHot\) \? '1\.15' : '1'\}/.test(src);

const results = {
  badge_present:          !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_glow_false:        rest?.glowAttr === 'false',
  rest_lifted_false:      rest?.liftedAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R603 edge-badge circle brightness (5th axis, ring↔digit parity):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
