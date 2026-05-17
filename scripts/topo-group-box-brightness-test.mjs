/* Round 587 verification: group box gains stacked
 * brightness(1.15) on hover/pin. 26th anchor in per-element
 * brightness family, 19th in stacked-filter sub-pattern.
 * Stacks with R142 url(#topo-groupbox-lift) SVG filter.
 *
 * Test phases:
 *   1. mock 2 nodes with prefix-group alias → grid layout
 *      renders group box
 *   2. rest (not hovered, not pinned): filter='none' computed,
 *      brightness-attr='1', pinned='false'
 *   3. transition-property contains 'filter'
 *   4. source: filter conditional stack + data-attr
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
  // Two prefix groups so grid layout produces visible group boxes
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1'), mk('alpha·2'), mk('beta·1'), mk('beta·2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-box-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-group-box-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-group-box-brightness'),
    pinnedAttr: el.getAttribute('data-group-box-pinned'),
    liftedAttr: el.getAttribute('data-group-box-lifted'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: \(isPinned \|\| isHovered\)\s*\?\s*'url\(#topo-groupbox-lift\) brightness\(1\.15\)'\s*:\s*undefined/.test(src);
const sourceAttr = /data-group-box-brightness=\{\(isPinned \|\| isHovered\) \? '1\.15' : '1'\}/.test(src);

const results = {
  box_present:            !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_pinned_false:      rest?.pinnedAttr === 'false',
  rest_lifted_false:      rest?.liftedAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R587 group-box brightness (26th anchor, group-cluster scope):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
