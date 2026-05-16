/* Round 279 verification: arrival ping + dispatch pulse SMIL retired
 * (R75 + R76 + R228 + R231 + R252 family) — 减法 cut #5.
 *
 * Per active flow edge the pre-R279 SMIL family was:
 *   particle (R50 animateMotion along curve path)         ← KEPT
 *   arrival ping (R75 circle + r/opacity animate)         ← RETIRED
 *   dispatch pulse (R76 circle + r/opacity animate)       ← RETIRED
 *
 * For a 5-edge fleet that's 5×3 = 15 simultaneous SMIL on edges
 * alone, pre-R279. The particle (a moving dot along the path) is the
 * primary "data flowing from A → B" visual signal; the ping + pulse
 * are secondary "arrival/dispatch confirmation" that the moving
 * particle already conveys. R279 culls ping + pulse, keeps particle.
 *
 * Net: -10 SMIL animations for a 5-edge fleet. Combined with R276
 * (-4 orbit) and R278 (-4 working halo), the canvas motion budget
 * is now: 1 hub breath + N particles per active edge, that's it.
 *
 * Test scope:
 *   1. No element matches `[data-arrival-ping]` (R75 retired).
 *   2. No element matches `[data-dispatch-pulse]` (R76 retired).
 *   3. Particles still present (`[data-edge-particle]` or equivalent).
 *   4. R275 freshness chip absent (regression).
 *   5. R276 orbit absent (regression).
 *   6. R277 legend height 88 (regression).
 *   7. R278 working halo <animate> count 0 (regression).
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
// 5 distinct flow pairs so particles + (formerly) ping/pulse mount
// on multiple edges with link.count >= 3 (the dispatch-pulse gate
// pre-R279).
const now = Date.now();
const msgs = [];
for (let pair = 0; pair < 5; pair++) {
  for (let i = 0; i < 5; i++) {
    const from = ['alpha','beta','gamma','delta'][pair % 4];
    const to   = ['beta','gamma','delta','alpha'][pair % 4];
    msgs.push({
      id: `m${pair}-${i}`, from_alias: from, to_alias: to, content: 'hi',
      network_id: 'default',
      created_at: new Date(now - (1000 + pair * 200 + i * 50)).toISOString(),
    });
  }
}
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-panel="legend"]', { timeout: 10000 });
await page.waitForSelector('[data-edge-particle]',       { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const ping     = document.querySelectorAll('[data-arrival-ping]');
  const pulse    = document.querySelectorAll('[data-dispatch-pulse]');
  const particle = document.querySelectorAll('[data-edge-particle]');
  const freshnessChip = document.querySelector('[data-freshness-chip]');
  const orbits   = document.querySelectorAll('[data-topo-orbit-bucket]');
  const legendG  = document.querySelector('[data-topo-panel="legend"]');
  const legendH  = legendG?.querySelector('rect')?.getAttribute('height') ?? null;
  const halos    = document.querySelectorAll('[data-node-halo-breath="on"]');
  let haloAnimateCount = 0;
  halos.forEach((h) => { haloAnimateCount += h.querySelectorAll('animate').length; });
  return {
    pingCount:        ping.length,
    pulseCount:       pulse.length,
    particleCount:    particle.length,
    freshnessPresent: freshnessChip !== null,
    orbitCount:       orbits.length,
    legendHeight:     legendH,
    haloAnimateCount,
  };
});
await browser.close();

const results = {
  arrival_ping_absent:           probe.pingCount === 0,
  dispatch_pulse_absent:         probe.pulseCount === 0,
  particles_still_present:       probe.particleCount > 0,
  r275_freshness_absent:         probe.freshnessPresent === false,
  r276_orbit_absent:             probe.orbitCount === 0,
  r277_legend_height_88:         probe.legendHeight === '88',
  r278_halo_animate_count_zero:  probe.haloAnimateCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge ping/pulse retired:`, JSON.stringify(results),
  '\n  arrival ping count (expect 0):',  probe.pingCount,
  '\n  dispatch pulse count (expect 0):', probe.pulseCount,
  '\n  particle count (expect > 0):',     probe.particleCount,
  '\n  freshness absent:', !probe.freshnessPresent,
  '\n  orbit count (expect 0):', probe.orbitCount,
  '\n  legend height:', probe.legendHeight,
  '\n  halo animate count (expect 0):', probe.haloAnimateCount);
process.exit(ok ? 0 : 1);
