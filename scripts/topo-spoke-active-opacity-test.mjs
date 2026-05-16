/* Round 391 verification: hub-spoke active opacity 0.7 → 0.8. An
 * "active" spoke is one whose alias has recent message traffic
 * (activeAliases is populated from buildFlowLinks(messages)). The
 * lift unifies active-spoke alpha with R370 hub hover-ring opacity
 * 0.7 → 0.8 cyber — paired canvas signals at matching alpha.
 *
 * Contract:
 *   - When the alias appears as flow-link from/to, its spoke has:
 *     * opacity attr === '0.8'
 *     * data-topo-hub-spoke-opacity === '0.8'
 *     * data-topo-hub-spoke-active === 'true'
 *   - Idle spokes (no flow traffic) unchanged:
 *     * opacity attr === '0.45'
 *     * data-topo-hub-spoke-active === 'false'
 *   - Pre-R391 invariants preserved on the active spoke:
 *     * R382 strokeLinecap='round'
 *     * R51-safe strokeWidth=2 (active)
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
// Seed a flow link between alpha and beta so their spokes become
// active; gamma stays idle. activeAliases = { alpha, beta }.
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: {
    messages: [
      { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
      { id: 'm2', from_alias: 'alpha', to_alias: 'beta', content: 'pong', created_at: fresh, network_id: 'default' },
    ],
  },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(300);

// Wait for the dashboard to ingest the seeded messages and recompute
// activeAliases. The flow-links derivation runs in a useMemo that
// depends on `messages`; allow a tick for SWR/state propagation.
await page.waitForTimeout(800);

const probe = await page.evaluate(() => {
  const spokes = Array.from(document.querySelectorAll('[data-topo-hub-spoke-active]'));
  const active = spokes.filter((s) => s.getAttribute('data-topo-hub-spoke-active') === 'true');
  const idle   = spokes.filter((s) => s.getAttribute('data-topo-hub-spoke-active') === 'false');
  const read = (el) => el ? ({
    opacityAttr:  el.getAttribute('opacity'),
    opacityData:  el.getAttribute('data-topo-hub-spoke-opacity'),
    strokeWidth:  el.getAttribute('stroke-width'),
    linecap:      el.getAttribute('stroke-linecap'),
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
  total_3_spokes:           probe.total === 3,
  // alpha + beta active (flow link)
  active_2_spokes:          probe.activeCount === 2,
  idle_1_spoke:             probe.idleCount === 1,
  // R391: active opacity '0.8' (was '0.7')
  active_opacity_0_8:       probe.activeSample?.opacityAttr === '0.8',
  active_data_0_8:          probe.activeSample?.opacityData === '0.8',
  // Idle invariant
  idle_opacity_0_45:        probe.idleSample?.opacityAttr === '0.45',
  idle_data_0_45:           probe.idleSample?.opacityData === '0.45',
  // R382 + R51-safe invariants on active spoke
  active_linecap_round:     probe.activeSample?.linecap === 'round',
  active_strokeWidth_2:     probe.activeSample?.strokeWidth === '2',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-spoke active opacity 0.7 → 0.8:`, JSON.stringify(results),
  '\n  probe:', JSON.stringify(probe, null, 2));
process.exit(ok ? 0 : 1);
