/* Round 589 verification: recent-signal panel count <text>
 * root gains filter brightness(1.15) on hoveredPanel ===
 * 'recent'. 28th anchor in per-element brightness family.
 * Sibling to R588 at legend panel — closes panel-pair
 * brightness symmetry at the header-count scope.
 *
 * Test phases:
 *   1. mock 1 flow message → recent-signal panel renders count
 *   2. rest (no panel hover): filter='none', brightness-attr='1'
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
// recent-signal panel renders only when flowLinks.length > 0
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-panel-count-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-count-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-recent-panel-count-brightness'),
    letterSpacingAttr: el.getAttribute('data-recent-panel-count-letter-spacing'),
    textContent: el.textContent,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: hoveredPanel === 'recent' \? 'brightness\(1\.15\)' : undefined/.test(src);
const sourceAttr = /data-recent-panel-count-brightness=\{hoveredPanel === 'recent' \? '1\.15' : '1'\}/.test(src);
const sourceTransition = /transition: 'letter-spacing 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  count_present:          !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_letter_spacing:    rest?.letterSpacingAttr === '0.2',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R589 recent-panel-count brightness (28th anchor, panel-pair symmetry closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
