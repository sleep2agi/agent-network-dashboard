/* Round 612 — legend-row tint rect brightness on hover/pin.
 * 3rd panel-tier sibling. Closes the panel-row tint rect
 * brightness trio (group / recent / legend) at full parity.
 *
 * Test phases:
 *   1. mock 2 idle nodes → legend rows render
 *   2. rest: filter='none', brightness-attr='1', tinted='none'
 *   3. computed transition-property contains 'filter'
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
await page.waitForSelector('[data-legend-row-tint-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const els = document.querySelectorAll('[data-legend-row-tint-brightness]');
  if (!els.length) return null;
  const el = els[0];
  const cs = getComputedStyle(el);
  return {
    count: els.length,
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-legend-row-tint-brightness'),
    tintedAttr: el.getAttribute('data-legend-row-tinted'),
    transitionAttr: el.getAttribute('data-legend-row-tint-transition'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: \(hoveredStatus === row\.key \|\| isPinned\)\s*\?\s*'brightness\(1\.15\)'\s*:\s*undefined/.test(src);
const sourceAttr = /data-legend-row-tint-brightness=\{\(hoveredStatus === row\.key \|\| isPinned\) \? '1\.15' : '1'\}/.test(src);
const sourceTransition = /transition: 'fill 200ms ease-out, opacity 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  tint_present:           !!rest,
  count_ge_3:             (rest?.count ?? 0) >= 3,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_tinted_none:       rest?.tintedAttr === 'none',
  transition_attr:        rest?.transitionAttr === '200ms',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R612 legend-row tint rect brightness (panel trio closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
