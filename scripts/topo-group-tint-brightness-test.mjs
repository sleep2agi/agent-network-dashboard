/* Round 610 — group label tint rect gains filter brightness(1.15)
 * on (pinnedGroup === box.key || hoveredGroupLabel === box.key).
 * Same gate as the existing fill swap.
 *
 * Test phases:
 *   1. mock 2 prefix-group nodes → grid layout renders tint rects
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
    localStorage.setItem('anet-topo-layout', 'grid');
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1'), mk('alpha·2'), mk('beta·1'), mk('beta·2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label-tint-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-group-label-tint-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-group-label-tint-brightness'),
    tintedAttr: el.getAttribute('data-group-label-tinted'),
    transitionAttr: el.getAttribute('data-group-label-tint-transition'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: \(pinnedGroup === box\.key \|\| hoveredGroupLabel === box\.key\)\s*\?\s*'brightness\(1\.15\)'\s*:\s*undefined/.test(src);
const sourceAttr = /data-group-label-tint-brightness=\{\(pinnedGroup === box\.key \|\| hoveredGroupLabel === box\.key\) \? '1\.15' : '1'\}/.test(src);
const sourceTransition = /transition: 'fill 200ms ease-out, opacity 200ms ease-out, x 200ms ease-out, width 200ms ease-out, rx 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  tint_present:           !!rest,
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
console.log(`${ok ? '✅' : '❌'} R610 group-label tint rect brightness (pin/hover panel tier):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
