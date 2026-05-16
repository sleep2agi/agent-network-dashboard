/* Round 280 verification: backdrop spokes retired (R93 + R240 family)
 * — 减法 cut #6.
 *
 * Pre-R280 the canvas rendered 6 <line> elements at angles 0, 30, 60,
 * 90, 120, 150° through hub center — 12 rays of a "radar" star
 * pattern, stroke opacity 0.18 (cyber) / 0.35 (light), tint shift to
 * pal.legendAccent when any pin is active (R240).
 *
 * The radial-gradient backdrop (`topo-radar`) already provides soft
 * hub-centered glow; the explicit line spokes were decorative density
 * without structural signal — the topology IS hub-and-spoke, the
 * actual hub-to-node connecting strokes already render the structure.
 *
 * Post-R280: spokes block gated with `false &&`. The 6 lines no
 * longer render; radial-gradient backdrop remains.
 *
 * Test scope:
 *   1. No element matches `[data-topo-spoke-angle]`.
 *   2. R278 working halo <animate> count still 0 (regression).
 *   3. R279 ping/pulse still absent (regression).
 *   4. R277 legend height 88 (regression).
 *   5. R275 freshness chip absent (regression).
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
await page.waitForSelector('[data-topo-panel="legend"]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const spokes        = document.querySelectorAll('[data-topo-spoke-angle]');
  const ping          = document.querySelectorAll('[data-arrival-ping]');
  const pulse         = document.querySelectorAll('[data-dispatch-pulse]');
  const freshnessChip = document.querySelector('[data-freshness-chip]');
  const legendG       = document.querySelector('[data-topo-panel="legend"]');
  const legendH       = legendG?.querySelector('rect')?.getAttribute('height') ?? null;
  const halos         = document.querySelectorAll('[data-node-halo-breath="on"]');
  let haloAnimateCount = 0;
  halos.forEach((h) => { haloAnimateCount += h.querySelectorAll('animate').length; });
  return {
    spokeCount:       spokes.length,
    pingCount:        ping.length,
    pulseCount:       pulse.length,
    freshnessPresent: freshnessChip !== null,
    legendHeight:     legendH,
    haloAnimateCount,
  };
});
await browser.close();

const results = {
  spokes_absent:                 probe.spokeCount === 0,
  r279_ping_absent:              probe.pingCount === 0,
  r279_pulse_absent:             probe.pulseCount === 0,
  r275_freshness_absent:         probe.freshnessPresent === false,
  r277_legend_height_88:         probe.legendHeight === '88',
  r278_halo_animate_count_zero:  probe.haloAnimateCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} backdrop spokes retired:`, JSON.stringify(results),
  '\n  spoke count (expect 0):',          probe.spokeCount,
  '\n  ping/pulse:', probe.pingCount, probe.pulseCount,
  '\n  freshness absent:', !probe.freshnessPresent,
  '\n  legend height:', probe.legendHeight,
  '\n  halo animate count (expect 0):', probe.haloAnimateCount);
process.exit(ok ? 0 : 1);
