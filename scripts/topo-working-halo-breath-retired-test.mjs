/* Round 278 verification: working halo breath SMIL retired (R112 +
 * R226 + R244 family) — 减法 cut #4.
 *
 * Pre-R278 each working node's halo <circle r=radius+8> contained a
 * <animate attributeName="opacity" ...> child that pulsed
 * 0.73→0.92→0.73 (cyber 0.53→0.78→0.53) at 3s cycle, R226-staggered
 * per-node by (nodeIdx * 0.37) % 3, R244 spline-eased.
 *
 * For a 4-working fleet that's 4 simultaneous SMIL breaths competing
 * with the hub-halo breath (R244 hub) for the "fleet busyness" visual
 * signal. The signal is info-redundant: hub-halo breath already
 * conveys "alive and busy"; per-node halo breath duplicates at 4×
 * volume. Working nodes are also distinguished by their halo COLOR
 * (R12 status trio green halo), so identity stays without motion.
 *
 * Post-R278 the SMIL animate is gated `false &&` — halo opacity stays
 * at the base value via the parent circle's opacity attr (no breath).
 * Working node halos visible but static.
 *
 * Test scope:
 *   1. No `<animate>` child inside working node halos (the
 *      <circle r=radius+8 ...>). Probe by looking for animate inside
 *      circles tagged data-node-halo-breath='on'.
 *   2. Halo circles still PRESENT (info preserved — just static).
 *   3. R275 freshness chip absent at fresh (regression).
 *   4. R276 orbit particles absent (regression).
 *   5. R277 legend panel height === 88 (regression).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-node-halo-breath]', { timeout: 10000 });
await page.waitForSelector('[data-topo-panel="legend"]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  // Working node halos — they should still exist (info preserved)
  // but should NOT contain <animate> children (SMIL retired).
  const halos = document.querySelectorAll('[data-node-halo-breath="on"]');
  let animateChildCount = 0;
  halos.forEach((h) => {
    animateChildCount += h.querySelectorAll('animate').length;
  });
  const freshnessChip = document.querySelector('[data-freshness-chip]');
  const orbits        = document.querySelectorAll('[data-topo-orbit-bucket]');
  const legendG       = document.querySelector('[data-topo-panel="legend"]');
  const legendH       = legendG?.querySelector('rect')?.getAttribute('height') ?? null;
  return {
    haloCount:           halos.length,
    haloAnimateCount:    animateChildCount,
    freshnessPresent:    freshnessChip !== null,
    orbitCount:          orbits.length,
    legendHeight:        legendH,
  };
});
await browser.close();

const results = {
  halos_still_present:               probe.haloCount >= 4,
  halo_animate_count_zero:           probe.haloAnimateCount === 0,
  r275_freshness_absent:             probe.freshnessPresent === false,
  r276_orbit_absent:                 probe.orbitCount === 0,
  r277_legend_height_88:             probe.legendHeight === '88',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} working halo breath retired:`, JSON.stringify(results),
  '\n  halo count (expect >=4):',           probe.haloCount,
  '\n  halo <animate> children (expect 0):', probe.haloAnimateCount,
  '\n  freshness absent:', !probe.freshnessPresent,
  '\n  orbit count (expect 0):', probe.orbitCount,
  '\n  legend height:', probe.legendHeight);
process.exit(ok ? 0 : 1);
