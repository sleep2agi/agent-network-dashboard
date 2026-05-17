/* Round 467 verification: root svg gains `data-topo-any-pinned`
 * aggregate pin attr — sibling to R466 data-topo-any-hover.
 * Composed from 4 pin state vars (pinnedStatus, pinnedGroup,
 * pinnedVendor, pinnedEdgeKey). Together they form a 2-bit
 * inspection-mode signal on the canvas root.
 *
 * Contract:
 *   - at rest: data-topo-any-pinned === 'false'
 *   - click a group-label hitbox: attr flips to 'true'
 *   - press Escape (R62/R63/R88/R116 universal-cancel): back to 'false'
 *   - source-file conditional wired
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('beta·1',  'working'),
    mk('beta·2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[data-topo-any-pinned]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAttr = () => page.evaluate(() =>
  document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-any-pinned')
);

const restValue = await readAttr();

// Click group-label hitbox → pinnedGroup flips
await page.click('[data-group-label-hit]');
await page.waitForTimeout(300);
const pinnedValue = await readAttr();

// Esc → universal cancel
await page.mouse.move(500, 400); // move off the hitbox so Esc isn't swallowed
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const restAgainValue = await readAttr();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasAttr        = /data-topo-any-pinned=\{/.test(src);
const sourceCombines4Vars  = /pinnedStatus \|\| pinnedGroup \|\| pinnedVendor \|\| pinnedEdgeKey/.test(src);

await browser.close();

const results = {
  rest_is_false:        restValue === 'false',
  click_flips_true:     pinnedValue === 'true',
  esc_resets_false:     restAgainValue === 'false',
  source_attr_wired:    sourceHasAttr,
  source_4_vars:        sourceCombines4Vars,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} data-topo-any-pinned aggregate:`, JSON.stringify(results),
  '\n  rest:', restValue, '/ pinned:', pinnedValue, '/ esc:', restAgainValue);
process.exit(ok ? 0 : 1);
