/* Round 592 verification: +N more flows footer <text> gains
 * filter brightness(1.15) on hoveredRecentMore. 31st anchor
 * in per-element brightness family. Closes 6-axis hover
 * signature on the panel's primary nav affordance.
 *
 * Test phases:
 *   1. mock 5 flow messages → footer renders ("+ 2 more flows")
 *   2. rest (no hover): filter='none', brightness-attr='1'
 *   3. transition-property contains 'filter'
 *   4. source: filter conditional + data-attr + transition extension
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

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
    created_at: new Date(Date.now() - 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 60 * 1000).toISOString(),
    last_seen_at: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'), mk('a·3'), mk('a·4'),
    mk('b·1'), mk('b·2'),
  ] } });
});
// 5 flowLinks → footer "+2 more flows"
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'm1', created_at: new Date(now - 10*1000).toISOString() },
  { from_alias: 'a·2', to_alias: 'a·3', content: 'm2', created_at: new Date(now - 20*1000).toISOString() },
  { from_alias: 'a·3', to_alias: 'a·4', content: 'm3', created_at: new Date(now - 30*1000).toISOString() },
  { from_alias: 'b·1', to_alias: 'b·2', content: 'm4', created_at: new Date(now - 40*1000).toISOString() },
  { from_alias: 'a·1', to_alias: 'b·1', content: 'm5', created_at: new Date(now - 50*1000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-panel-more-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-more-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-recent-panel-more-brightness'),
    hoveredAttr: el.getAttribute('data-recent-panel-more-hovered'),
    moreAttr: el.getAttribute('data-recent-panel-more'),
    textContent: el.textContent,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: hoveredRecentMore \? 'brightness\(1\.15\)' : undefined/.test(src);
const sourceAttr = /data-recent-panel-more-brightness=\{hoveredRecentMore \? '1\.15' : '1'\}/.test(src);
const sourceTransition = /transition: 'opacity 200ms ease-out, fill 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  footer_present:         !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  more_count_2:           rest?.moreAttr === '2',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R592 more-footer brightness (31st anchor, 6-axis hover signature):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
