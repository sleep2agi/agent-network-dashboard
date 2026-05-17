/* Round 563 verification: pressure-bar segment lights up (R210
 * brightness + R542 drop-shadow) when operator hovers a node alias
 * whose status matches the segment's tier. 6th anchor in
 * inspection-overrides-encoding family.
 *
 * Mock: alpha·1 (working) + alpha·2 (idle) + alpha·3 (offline).
 * Hover alpha·1 → 'working' segment lights up; idle + offline rest.
 *
 * Test phases:
 *   1. rest: all 3 segments filter='none', lit='false'
 *   2. hover alpha·1 (working) → working seg filter contains
 *      brightness(1.2) and drop-shadow with green hex; idle +
 *      offline stay at rest
 *   3. hover alpha·2 (idle) → idle seg lit
 *   4. hover alpha·3 (offline) → offline seg lit
 *   5. source-side regex confirms wiring
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('alpha·3', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-pressure-seg="working"]', { timeout: 15000 });
await page.waitForTimeout(500);

const probeSeg = (key) => page.evaluate((k) => {
  const el = document.querySelector(`[data-pressure-seg="${k}"]`);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    matching: el.getAttribute('data-pressure-seg-member-alias-matching') === 'true',
    lit: el.getAttribute('data-pressure-seg-lit') === 'true',
    hovered: el.getAttribute('data-pressure-seg-hovered') === 'true',
  };
}, key);

const restWorking = await probeSeg('working');
const restIdle    = await probeSeg('idle');
const restOffline = await probeSeg('offline');

// Hover working node
await page.hover('g[data-node="alpha·1"]');
await page.waitForTimeout(400);
const hoverWorkingW = await probeSeg('working');
const hoverWorkingI = await probeSeg('idle');
const hoverWorkingO = await probeSeg('offline');

await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.hover('g[data-node="alpha·2"]');
await page.waitForTimeout(400);
const hoverIdleI = await probeSeg('idle');

await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.hover('g[data-node="alpha·3"]');
await page.waitForTimeout(400);
const hoverOfflineO = await probeSeg('offline');

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceTierKey = /const hoveredAliasTierKey: 'working' \| 'idle' \| 'offline' \| null/.test(src);
const sourceMatching = /const isMemberAliasMatching = hoveredAliasTierKey === key;/.test(src);
const sourceLit = /const isSegLit = hoveredStatus === key \|\| isMemberAliasMatching;/.test(src);
const sourceFilter = /filter: isSegLit \? `brightness\(1\.2\) drop-shadow\(0 0 2px \$\{color\}99\)` : undefined/.test(src);
const sourceAttr = /data-pressure-seg-member-alias-matching=/.test(src);

const results = {
  rest_working_filter_none: restWorking?.filter === 'none',
  rest_working_lit_false:   restWorking?.lit === false,
  rest_idle_filter_none:    restIdle?.filter === 'none',
  rest_offline_filter_none: restOffline?.filter === 'none',
  // Hover working node → working seg lit
  hover_working_w_lit:      hoverWorkingW?.lit === true,
  hover_working_w_matching: hoverWorkingW?.matching === true,
  hover_working_w_brightness: /brightness\(1\.2\)/.test(hoverWorkingW?.filter || ''),
  hover_working_w_dropshadow: /drop-shadow\(/.test(hoverWorkingW?.filter || ''),
  // idle + offline segments stay at rest
  hover_working_i_lit_false:  hoverWorkingI?.lit === false,
  hover_working_o_lit_false:  hoverWorkingO?.lit === false,
  // Hover idle node → idle seg lit
  hover_idle_i_lit:         hoverIdleI?.lit === true,
  hover_idle_i_matching:    hoverIdleI?.matching === true,
  // Hover offline node → offline seg lit
  hover_offline_o_lit:      hoverOfflineO?.lit === true,
  hover_offline_o_matching: hoverOfflineO?.matching === true,
  // Source
  source_tier_key: sourceTierKey,
  source_matching: sourceMatching,
  source_lit:      sourceLit,
  source_filter:   sourceFilter,
  source_attr:     sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R563 pressure-seg inspection-overrides-encoding (6th anchor):`,
  JSON.stringify(results, null, 2),
  '\n  rest working:', JSON.stringify(restWorking),
  '\n  hover alpha·1 (working) → working:', JSON.stringify(hoverWorkingW),
  '\n  hover alpha·2 (idle) → idle:', JSON.stringify(hoverIdleI),
  '\n  hover alpha·3 (offline) → offline:', JSON.stringify(hoverOfflineO));
process.exit(ok ? 0 : 1);
