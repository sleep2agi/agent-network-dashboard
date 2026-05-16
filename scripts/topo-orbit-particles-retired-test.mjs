/* Round 276 verification: outer-ring orbit particles retired by default.
 *
 * R50 introduced 4 cyan particles orbiting r=330 (outer ring edge) at
 * 16s revolution. R131 added busy-bucket speed (workingCount → 16/14/
 * 12/10s). R216 added busy-bucket opacity (0.5/0.7/0.85/1.0).
 *
 * Pre-R276 the orbit family rendered 4 <g data-topo-orbit-bucket=...>
 * groups whenever the canvas was non-light theme. Each particle was a
 * 2.2-2.8 px cyan circle with animateTransform rotation, opacity gated
 * by busy bucket.
 *
 * The orbit family encoded workingCount busyness via speed + opacity,
 * but that signal was ALREADY conveyed by:
 *   · hub halo opacity breath (R244 / R84)
 *   · hub digit workingCount text (R130)
 *   · pressure-bar working/idle/offline ratio (R31)
 *
 * Info-redundant decoration. For a static Twitter screenshot, 4 small
 * dots at the canvas outer edge contributed to "乱" without
 * proportional signal. R276 gates the render block with `false &&` so
 * the code remains in place (commented context + rollback-friendly)
 * but nothing renders.
 *
 * Test scope:
 *   1. No element matches `[data-topo-orbit-bucket]` in DOM (orbit
 *      particles absent).
 *   2. No element matches `[data-topo-orbit-opacity]` (R216 attr).
 *   3. R275 freshness chip still absent at fresh state (regression —
 *      simplification family continues).
 *   4. R273 Layout toggle Grid inactive has hover:text-cyan-300
 *      (regression).
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
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 10000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const orbits        = document.querySelectorAll('[data-topo-orbit-bucket]');
  const orbitsOpacity = document.querySelectorAll('[data-topo-orbit-opacity]');
  const freshnessChip = document.querySelector('[data-freshness-chip]');
  const grid          = document.querySelector('[data-topo-chrome-layout="grid"]');
  return {
    orbitCount:         orbits.length,
    orbitOpacityCount:  orbitsOpacity.length,
    freshnessPresent:   freshnessChip !== null,
    gridClasses:        grid ? grid.className.toString() : null,
  };
});
await browser.close();

const results = {
  orbit_bucket_absent:                probe.orbitCount === 0,
  orbit_opacity_absent:               probe.orbitOpacityCount === 0,
  r275_freshness_absent_at_fresh:     probe.freshnessPresent === false,
  r273_grid_has_cyan_hover_text:      (probe.gridClasses || '').includes('hover:text-cyan-300'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} orbit particles retired:`, JSON.stringify(results),
  '\n  orbit count (expect 0):',         probe.orbitCount,
  '\n  orbit-opacity count (expect 0):', probe.orbitOpacityCount,
  '\n  freshness chip absent (R275):',   !probe.freshnessPresent);
process.exit(ok ? 0 : 1);
