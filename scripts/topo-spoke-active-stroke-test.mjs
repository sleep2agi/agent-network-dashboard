/* Round 415 verification: hub-spoke active strokeWidth 2 → 2.25.
 * Visual-weight bump family 14th anchor — active-spoke stroke
 * thickens to match its role as the focal connection. Pairs with
 * R391 opacity 0.7 → 0.8 so the same active path lifts both
 * stroke AND opacity in concert.
 *
 * Contract:
 *   - Seed a flow link so a node becomes active (R243 isActive gate)
 *   - The active spoke <path>:
 *     * stroke-width attr === '2.25'
 *     * data-topo-hub-spoke-stroke-width-active === '2.25'
 *     * data-topo-hub-spoke-opacity === '0.8' (R391 invariant)
 *     * stroke-linecap === 'round' (R382 invariant)
 *   - Idle spokes (no flow): stroke-width === '1' (R415 doesn't touch idle)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
// Seed flow alpha→beta so alpha + beta spokes become active
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-spoke-active]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const spokes = Array.from(document.querySelectorAll('[data-topo-hub-spoke-active]'));
  const active = spokes.filter((s) => s.getAttribute('data-topo-hub-spoke-active') === 'true');
  const idle   = spokes.filter((s) => s.getAttribute('data-topo-hub-spoke-active') === 'false');
  const read = (el) => el ? ({
    strokeWidth:     el.getAttribute('stroke-width'),
    strokeWidthData: el.getAttribute('data-topo-hub-spoke-stroke-width-active'),
    opacity:         el.getAttribute('opacity'),
    opacityData:     el.getAttribute('data-topo-hub-spoke-opacity'),
    linecap:         el.getAttribute('stroke-linecap'),
  }) : null;
  return {
    total:        spokes.length,
    activeCount:  active.length,
    idleCount:    idle.length,
    activeSample: read(active[0]),
    idleSample:   read(idle[0]),
  };
});

await browser.close();

const results = {
  // 3 spokes total (alpha, beta, gamma)
  total_3_spokes:            probe.total === 3,
  // alpha + beta active (flow link)
  active_2_spokes:           probe.activeCount === 2,
  idle_1_spoke:              probe.idleCount === 1,
  // R415: active strokeWidth '2.25'
  active_strokeWidth_2_25:   probe.activeSample?.strokeWidth === '2.25',
  active_data_2_25:          probe.activeSample?.strokeWidthData === '2.25',
  // R391 opacity invariant
  active_opacity_0_8:        probe.activeSample?.opacity === '0.8',
  // R382 linecap invariant
  active_linecap_round:      probe.activeSample?.linecap === 'round',
  // Idle invariant: strokeWidth '1' (R415 doesn't touch idle)
  idle_strokeWidth_1:        probe.idleSample?.strokeWidth === '1',
  idle_opacity_0_45:         probe.idleSample?.opacity === '0.45',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-spoke active strokeWidth 2 → 2.25:`, JSON.stringify(results),
  '\n  active:', probe.activeSample,
  '\n  idle:  ', probe.idleSample);
process.exit(ok ? 0 : 1);
