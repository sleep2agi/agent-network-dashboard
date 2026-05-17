/* Round 562 verification: legend-row swatch lifts r + drop-shadow
 * when operator hovers a node alias whose status matches the row's
 * tier. 5th anchor in inspection-overrides-encoding family.
 *
 * Mock: alpha·1 (working) + alpha·2 (idle) + alpha·3 (offline).
 * Hover alpha·1 → 'working' legend swatch should lift; idle +
 * offline swatches stay at rest.
 *
 * Test phases:
 *   1. rest: all 3 swatches r=6, filter=none, attr='false'
 *   2. hover alpha·1 (working) → working swatch r=7, filter contains
 *      drop-shadow with green hex; idle + offline unchanged
 *   3. hover alpha·2 (idle) → idle swatch lifts, others rest
 *   4. hover alpha·3 (offline) → offline swatch lifts, others rest
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
await page.waitForSelector('[data-legend-swatch="working"]', { timeout: 15000 });
await page.waitForTimeout(500);

const probeSwatch = (key) => page.evaluate((k) => {
  const el = document.querySelector(`[data-legend-swatch="${k}"]`);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    r: cs.r,
    filter: cs.filter,
    state: el.getAttribute('data-legend-swatch-state'),
    matching: el.getAttribute('data-legend-swatch-member-alias-matching') === 'true',
    glow: el.getAttribute('data-legend-swatch-glow') === 'true',
  };
}, key);

const restWorking = await probeSwatch('working');
const restIdle    = await probeSwatch('idle');
const restOffline = await probeSwatch('offline');

// Hover working node
await page.hover('g[data-node="alpha·1"]');
await page.waitForTimeout(400);
const hoverWorkingWorking = await probeSwatch('working');
const hoverWorkingIdle    = await probeSwatch('idle');
const hoverWorkingOffline = await probeSwatch('offline');

// Move away to reset
await page.mouse.move(0, 0);
await page.waitForTimeout(300);

// Hover idle node
await page.hover('g[data-node="alpha·2"]');
await page.waitForTimeout(400);
const hoverIdleIdle = await probeSwatch('idle');

// Move away and hover offline node
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.hover('g[data-node="alpha·3"]');
await page.waitForTimeout(400);
const hoverOfflineOffline = await probeSwatch('offline');

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFlag = /const isMemberAliasMatching = hoveredAliasRowKey === row\.key;/.test(src);
const sourceLifted = /const isSwatchLifted = isLifted \|\| isMemberAliasMatching;/.test(src);
const sourceR = /r: isSwatchLifted \? '7px' : '6px'/.test(src);
const sourceFilter = /filter: isSwatchLifted/.test(src);
const sourceAttr = /data-legend-swatch-member-alias-matching=/.test(src);

const results = {
  // Rest state — all swatches r=6, no glow
  rest_working_r_6:         restWorking?.r === '6px',
  rest_working_filter_none: restWorking?.filter === 'none',
  rest_working_matching_false: restWorking?.matching === false,
  rest_idle_r_6:            restIdle?.r === '6px',
  rest_offline_r_6:         restOffline?.r === '6px',
  // Hover working node → working swatch lifts; idle + offline stay
  hover_working_w_r_7:      hoverWorkingWorking?.r === '7px',
  hover_working_w_matching: hoverWorkingWorking?.matching === true,
  hover_working_w_glow:     /drop-shadow\(/.test(hoverWorkingWorking?.filter || ''),
  hover_working_i_r_6:      hoverWorkingIdle?.r === '6px',
  hover_working_o_r_6:      hoverWorkingOffline?.r === '6px',
  // Hover idle node → idle swatch lifts
  hover_idle_i_r_7:         hoverIdleIdle?.r === '7px',
  hover_idle_i_matching:    hoverIdleIdle?.matching === true,
  // Hover offline node → offline swatch lifts
  hover_offline_o_r_7:      hoverOfflineOffline?.r === '7px',
  hover_offline_o_matching: hoverOfflineOffline?.matching === true,
  // Source
  source_flag:    sourceFlag,
  source_lifted:  sourceLifted,
  source_r:       sourceR,
  source_filter:  sourceFilter,
  source_attr:    sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R562 legend-swatch inspection-overrides-encoding (5th anchor):`,
  JSON.stringify(results, null, 2),
  '\n  rest working:', JSON.stringify(restWorking),
  '\n  rest idle:', JSON.stringify(restIdle),
  '\n  rest offline:', JSON.stringify(restOffline),
  '\n  hover alpha·1 (working) → working:', JSON.stringify(hoverWorkingWorking),
  '\n  hover alpha·2 (idle)    → idle:',    JSON.stringify(hoverIdleIdle),
  '\n  hover alpha·3 (offline) → offline:', JSON.stringify(hoverOfflineOffline));
process.exit(ok ? 0 : 1);
