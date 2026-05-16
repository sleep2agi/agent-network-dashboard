/* Round 241 verification: hub-link spokes (agent→hub paths in ring
 * layout) gain a 250ms ease-out transition on stroke + stroke-width
 * + opacity so the idle↔active state flip smooths instead of snaps.
 *
 * Pre-R241 a node going active flipped three properties in lockstep
 * one-frame: stroke (gray→cyan), strokeWidth (1→2), opacity (0.45→
 * 0.7). R241 eases all three together at the same 250ms cadence.
 *
 * Cyber theme palette:
 *   pal.spokeStroke.idle   = #155e75 (dark cyan)
 *   pal.spokeStroke.active = #22d3ee (bright cyan)
 *
 * Test scope:
 *   - 4 nodes in ring layout, no messages → 4 idle spokes all
 *     showing transition wiring, data-topo-hub-spoke-active='false'
 *   - 5 messages alpha→beta → alpha + beta become active spokes
 *     (data-topo-hub-spoke-active='true'), 2 stay idle
 *   - transition style includes stroke + stroke-width + opacity at
 *     250ms (or 0.25s browser-normalised)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function setup(messages) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      sessionStorage.setItem('anet_v3_auth', '1');
      // R87 layout toggle — ring is default but ensure it's set
      // (the storage key may exist from previous test runs in grid)
      localStorage.setItem('anet-topo-layout', 'ring');
    } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-topo-hub-spoke-active]', { timeout: 10000, state: 'attached' });
  await page.waitForTimeout(300);
  return page;
}

const probeAll = (page) => page.evaluate(() => {
  const spokes = Array.from(document.querySelectorAll('[data-topo-hub-spoke-active]'));
  return spokes.map((s) => ({
    active:     s.getAttribute('data-topo-hub-spoke-active'),
    strokeAttr: s.getAttribute('stroke'),
    strokeWidth: s.getAttribute('stroke-width'),
    opacityAttr: s.getAttribute('opacity'),
    transition: s.style.transition,
  }));
});

// Scenario A: 4 nodes, no messages → all idle
const pageA = await setup([]);
const idleSpokes = await probeAll(pageA);
await pageA.close();

// Scenario B: 5-msg alpha→beta flow → alpha + beta active
const now = Date.now();
const msgs = [];
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
const pageB = await setup(msgs);
const activeSpokes = await probeAll(pageB);
await pageB.close();
await browser.close();

const hasProp = (s, prop) => new RegExp(`${prop}\\s+(?:250ms|0\\.25s)`).test(s || '');
const hasFullTransition = (s) =>
  hasProp(s, 'stroke') && hasProp(s, 'stroke-width') && hasProp(s, 'opacity');

const activeCount = activeSpokes.filter(s => s.active === 'true').length;

const results = {
  idle_four_spokes:       idleSpokes.length === 4,
  idle_all_inactive:      idleSpokes.every(s => s.active === 'false'),
  idle_all_have_transition: idleSpokes.every(s => hasFullTransition(s.transition)),
  idle_all_stroke_1:      idleSpokes.every(s => s.strokeWidth === '1'),
  idle_all_opacity_045:   idleSpokes.every(s => s.opacityAttr === '0.45'),

  active_four_spokes:     activeSpokes.length === 4,
  active_two_active:      activeCount === 2,
  active_two_inactive:    activeSpokes.length - activeCount === 2,
  active_all_have_transition: activeSpokes.every(s => hasFullTransition(s.transition)),
  // Active spokes have strokeWidth='2' and opacity='0.7'
  active_active_stroke_2: activeSpokes.filter(s => s.active === 'true').every(s => s.strokeWidth === '2'),
  active_active_opacity_07: activeSpokes.filter(s => s.active === 'true').every(s => s.opacityAttr === '0.7'),
  // Inactive spokes still at 1/0.45
  active_inactive_stable: activeSpokes.filter(s => s.active === 'false').every(s => s.strokeWidth === '1' && s.opacityAttr === '0.45'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub spoke ease:`, JSON.stringify(results),
  '\n  idle:  ',   idleSpokes.map(s => ({ a: s.active, w: s.strokeWidth, o: s.opacityAttr })),
  '\n  active:',   activeSpokes.map(s => ({ a: s.active, w: s.strokeWidth, o: s.opacityAttr })));
process.exit(ok ? 0 : 1);
