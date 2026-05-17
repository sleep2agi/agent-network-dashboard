/* Round 544 verification: group filter pill gains cyan-accent drop-
 * shadow when rendered (pin-active visual). Sibling to R543 status pill.
 *
 * Test strategy: source-canonical because group-label click via Playwright
 * is impractical (banked R538/R544 lesson — SVG hit-test intercept).
 * Source regex confirms the wiring; rest-state DOM probe confirms pill
 * is absent when unpinned (baseline behavior unchanged).
 *
 * Test phases:
 *   1. unpinned (default): no [data-active-filter="group"] element
 *   2. source-side regex confirms filter wired with pal.legendAccent
 *      via color-mix 60% syntax
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
    mk('alpha·1', 'working'), mk('alpha·2', 'working'),
    mk('beta·1', 'idle'),    mk('beta·2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(500);

const unpinned = await page.evaluate(() =>
  document.querySelector('[data-active-filter="group"]') !== null
);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterWired =
  /filter: `drop-shadow\(0 0 3px color-mix\(in srgb, \$\{pal\.legendAccent\} 60%, transparent\)\)`,/.test(src);

// Confirm we edited the GROUP pill specifically (data-active-filter="group")
// — look for the filter wiring within the group-pill scope by matching
// the surrounding setPinnedGroup handler.
const groupPillScope = src.match(/onClick=\{\(\) => setPinnedGroup\(null\)\}[\s\S]{0,2500}/)?.[0] || '';
const groupPillHasFilter = /filter: `drop-shadow\(0 0 3px color-mix\(in srgb, \$\{pal\.legendAccent\} 60%, transparent\)\)`,/.test(groupPillScope);

const results = {
  unpinned_pill_absent:    unpinned === false,
  source_filter_wired:     sourceFilterWired,
  source_group_pill_scope: groupPillHasFilter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R544 group filter pill glow (source-canonical):`,
  JSON.stringify(results, null, 2),
  '\n  unpinned absent:', unpinned);
process.exit(ok ? 0 : 1);
