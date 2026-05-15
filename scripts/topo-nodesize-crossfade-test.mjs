/* Round 171 verification: nodeSize change (S/M/L) picks up the
 * R170 crossfade pattern.
 *
 * Pre-R171 clicking S → L (or any non-active button) in the
 * chrome node-size segment re-derived every node's radius +
 * label sizing + (in grid) cell spacing in one paint frame.
 * Wholesale visual shift, no easing.
 *
 * R171 introduces nodeSizeSwitching one-shot flag (parallel
 * to R170 layoutSwitching). pickNodeScale arms it for 400ms
 * UNLESS the picked scale matches the current one (clicking
 * the already-active button bails early). The viewport <g>
 * opacity dims to 0.45 via the same `(layoutSwitching ||
 * nodeSizeSwitching)` OR expression.
 *
 * Test:
 *   1. Idle: nodeSize-switching='false', opacity=1, M active
 *   2. Click 'S' → flag='true', opacity='0.45', S now active
 *   3. Wait 450ms → flag='false', opacity='1', S still active
 *   4. Click 'S' again (same as current) → no flag arm (bail)
 *   5. Click 'L' → flag='true' again
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // Default M (0.84) per the React useState — explicitly clear any
    // saved value so the test starts at a known state.
    localStorage.removeItem('anet-topo-nodescale');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-viewport]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-nodesize="S"]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const g = document.querySelector('[data-topo-viewport]');
  const sBtn = document.querySelector('[data-topo-chrome-nodesize="S"]');
  const mBtn = document.querySelector('[data-topo-chrome-nodesize="M"]');
  const lBtn = document.querySelector('[data-topo-chrome-nodesize="L"]');
  return {
    nodeSizeSwitching: g?.getAttribute('data-topo-viewport-nodesize-switching'),
    opacity:           g?.style?.opacity || '',
    transition:        g?.style?.transition || '',
    s_active:          sBtn?.getAttribute('data-topo-chrome-nodesize-active'),
    m_active:          mBtn?.getAttribute('data-topo-chrome-nodesize-active'),
    l_active:          lBtn?.getAttribute('data-topo-chrome-nodesize-active'),
  };
});

const idle = await probe();

// Click S → flag arms, opacity drops
await page.locator('[data-topo-chrome-nodesize="S"]').click();
await page.waitForTimeout(50);
const duringS = await probe();

// Wait past 400ms window
await page.waitForTimeout(450);
const afterS = await probe();

// Click S again (same as current) → no fire, no fade
await page.locator('[data-topo-chrome-nodesize="S"]').click();
await page.waitForTimeout(50);
const sameS = await probe();

// Click L (different from S) → flag arms again
await page.locator('[data-topo-chrome-nodesize="L"]').click();
await page.waitForTimeout(50);
const duringL = await probe();

await page.waitForTimeout(450);
const afterL = await probe();

await browser.close();

const results = {
  viewport_found:                idle !== null,
  idle_flag_false:               idle.nodeSizeSwitching === 'false',
  idle_opacity_1:                idle.opacity === '1' || idle.opacity === '',
  idle_has_opacity_transition:   idle.transition.includes('opacity 250ms'),
  idle_M_active:                 idle.m_active === 'true',
  idle_S_inactive:               idle.s_active === 'false',
  idle_L_inactive:               idle.l_active === 'false',

  S_armed_flag:                  duringS.nodeSizeSwitching === 'true',
  S_armed_opacity_0p45:          duringS.opacity === '0.45',
  S_active_after_click:          duringS.s_active === 'true',
  S_M_deactivated:               duringS.m_active === 'false',

  after_S_flag_false:            afterS.nodeSizeSwitching === 'false',
  after_S_opacity_1:             afterS.opacity === '1',
  after_S_still_S_active:        afterS.s_active === 'true',

  sameS_no_arm:                  sameS.nodeSizeSwitching === 'false',
  sameS_opacity_stable:          sameS.opacity === '1',

  L_armed_flag:                  duringL.nodeSizeSwitching === 'true',
  L_armed_opacity_0p45:          duringL.opacity === '0.45',
  L_active_after_click:          duringL.l_active === 'true',
  L_S_deactivated:               duringL.s_active === 'false',

  after_L_flag_false:            afterL.nodeSizeSwitching === 'false',
  after_L_opacity_1:             afterL.opacity === '1',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} nodesize crossfade:`, JSON.stringify(results),
  `\n  idle     =`, idle,
  `\n  during S =`, duringS,
  `\n  after  S =`, afterS,
  `\n  same   S =`, sameS,
  `\n  during L =`, duringL,
  `\n  after  L =`, afterL);
process.exit(ok ? 0 : 1);
