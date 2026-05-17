/* Round 586 verification: runtime badge outer <g> stacks
 * brightness(1.15) onto the R559 drop-shadow on node hover.
 * 25th anchor in per-element brightness family, 18th in
 * stacked-filter sub-pattern.
 *
 * Test phases:
 *   1. mock 2 idle nodes → runtime badges render
 *   2. rest: filter='none' on outer <g> (no hover), brightness-attr='1'
 *   3. transition-property contains 'filter'
 *   4. source: filter string contains 'brightness(1.15)' stacked
 *      onto drop-shadow + data-attr
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
await page.waitForSelector('[data-runtime-badge-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-runtime-badge-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-runtime-badge-brightness'),
    glowAttr: el.getAttribute('data-runtime-badge-glow'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: isNodeActive\s*\?\s*`drop-shadow\(0 0 2px \$\{rt\.color\}99\) brightness\(1\.15\)`\s*:\s*undefined/.test(src);
const sourceAttr = /data-runtime-badge-brightness=\{isNodeActive \? '1\.15' : '1'\}/.test(src);

const results = {
  badge_present:          !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_glow_false:        rest?.glowAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R586 runtime-badge brightness (25th anchor, badge 4-axis closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
