/* Round 419 verification: hub-spoke idle opacity 0.45 → 0.50.
 * Stale-state legibility lift family 9th anchor — idle spokes
 * read more confidently while the active/idle contrast ratio
 * stays clear (0.8/0.50 = 1.6×).
 *
 * Contract:
 *   - Seed a flow alpha→beta so 2 spokes become active, 1 idle
 *   - Idle spoke:
 *     * opacity attr === '0.5'
 *     * data-topo-hub-spoke-opacity === '0.5'
 *     * data-topo-hub-spoke-active === 'false'
 *     * R46 className 'anet-topo-spoke-flow' preserved
 *   - Active spoke (R391/R415 invariants):
 *     * opacity '0.8'
 *     * strokeWidth '2.25'
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
    opacity:         el.getAttribute('opacity'),
    opacityData:     el.getAttribute('data-topo-hub-spoke-opacity'),
    strokeWidth:     el.getAttribute('stroke-width'),
    className:       el.getAttribute('class'),
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
  // Setup: 2 active + 1 idle
  total_3_spokes:            probe.total === 3,
  active_2:                  probe.activeCount === 2,
  idle_1:                    probe.idleCount === 1,
  // R419: idle opacity '0.5'
  idle_opacity_0_5:          probe.idleSample?.opacity === '0.5',
  idle_data_0_5:             probe.idleSample?.opacityData === '0.5',
  // R46 idle className preserved
  idle_has_flow_class:       probe.idleSample?.className?.includes('anet-topo-spoke-flow') === true,
  // R391/R415 active invariants
  active_opacity_0_8:        probe.activeSample?.opacity === '0.8',
  active_strokeWidth_2_25:   probe.activeSample?.strokeWidth === '2.25',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-spoke idle opacity 0.45 → 0.50:`, JSON.stringify(results),
  '\n  active:', probe.activeSample,
  '\n  idle:  ', probe.idleSample);
process.exit(ok ? 0 : 1);
