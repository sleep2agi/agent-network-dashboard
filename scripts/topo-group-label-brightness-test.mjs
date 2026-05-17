/* Round 571 verification: group-label parent text gains stacked
 * filter brightness(1.15) on top of R479/R538 drop-shadow on
 * isPinned || isHovered. 8th anchor in per-element brightness
 * family.
 *
 * Test phases:
 *   1. mock 6 'alpha·' prefix → 1 prefix group renders in grid
 *   2. rest: filter='none', brightness-attr='1', glow='false'
 *   3. source-side regex confirms stacked filter expression
 *      (drop-shadow + brightness) at both isPinned and isHovered
 *      branches
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
    mk('alpha·1'), mk('alpha·2'), mk('alpha·3'),
    mk('alpha·4'), mk('alpha·5'), mk('alpha·6'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label="alpha·"]', { timeout: 15000 });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-group-label="alpha·"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-group-label-brightness'),
    glowAttr: el.getAttribute('data-group-label-glow'),
    pinnedAttr: el.getAttribute('data-group-label-pinned'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourcePinFilter = /filter: isPinned\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) brightness\(1\.15\)`/.test(src);
const sourceHoverFilter = /isHovered\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}4d\) brightness\(1\.15\)`/.test(src);
const sourceAttr = /data-group-label-brightness=\{\(isPinned \|\| isHovered\) \? '1\.15' : '1'\}/.test(src);

const results = {
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_glow_false:        rest?.glowAttr === 'false',
  rest_pinned_false:      rest?.pinnedAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_pin_filter:      sourcePinFilter,
  source_hover_filter:    sourceHoverFilter,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R571 group-label parent text brightness stacked w/ drop-shadow (8th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
