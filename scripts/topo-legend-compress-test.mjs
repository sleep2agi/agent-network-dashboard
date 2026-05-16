/* Round 277 verification: legend panel compress 104 → 88, matching the
 * recent-signal panel's height post-R256. Row stride 24 → 18.
 *
 * Pre-R277:
 *   Panel: 224×104, rx=8
 *   Row 1 (working): y0=32, y1=36
 *   Row 2 (idle):    y0=56, y1=60
 *   Row 3 (offline): y0=80, y1=84
 *   Flow-arrow:      M140,80 Q164,56 196,80 (endpoints y=80)
 *
 * Post-R277:
 *   Panel: 224×88, rx=8
 *   Row 1 (working): y0=32, y1=36  (anchored — R271 hitbox y=21 invariant)
 *   Row 2 (idle):    y0=50, y1=54  (-6)
 *   Row 3 (offline): y0=68, y1=72  (-12)
 *   Flow-arrow:      M140,68 Q164,44 196,68 (tracks new offline cy)
 *
 * Net: legend panel takes ~15% less vertical chrome; panel pair
 * (recent-signal 88 + legend 88) now share the same height. Third
 * 减法 cut after R275 (FreshnessChip conditional) + R276 (orbit
 * particles retired).
 *
 * Test scope:
 *   1. Legend panel rect height === 88.
 *   2. Recent-signal panel rect height === 88 (regression — R256 invariant).
 *   3. Working row hitbox y === 21 (R271 invariant: row.y0=32 unchanged).
 *   4. Flow-arrow path starts with "M140,68" (tracks new offline cy=68).
 *   5. R275 freshness chip absent at fresh (regression).
 *   6. R276 orbit particles absent (regression).
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
await page.waitForSelector('[data-topo-panel="legend"]',         { timeout: 10000 });
await page.waitForSelector('[data-topo-panel="recent"]',         { timeout: 10000 });
await page.waitForSelector('[data-legend-status="working"] rect', { timeout: 10000 });
await page.waitForSelector('[data-legend-flow-arrow]',           { timeout: 10000 });
await page.waitForTimeout(300);

// Hover working row to materialize the tinted hitbox rect for the
// y=21 invariant check (R271). Without hover the rect carries the
// same y attr but tint fills are transparent.
await page.locator('[data-legend-status="working"]').hover();
await page.waitForTimeout(150);

const probe = await page.evaluate(() => {
  const legendG       = document.querySelector('[data-topo-panel="legend"]');
  const recentG       = document.querySelector('[data-topo-panel="recent"]');
  const workingRow    = document.querySelector('[data-legend-status="working"]');
  const workingHitbox = workingRow ? workingRow.querySelector('rect') : null;
  const flowArrow     = document.querySelector('[data-legend-flow-arrow]');
  const freshnessChip = document.querySelector('[data-freshness-chip]');
  const orbits        = document.querySelectorAll('[data-topo-orbit-bucket]');
  return {
    legendHeight:   legendG?.querySelector('rect')?.getAttribute('height') ?? null,
    recentHeight:   recentG?.querySelector('rect')?.getAttribute('height') ?? null,
    workingHitboxY: workingHitbox ? +workingHitbox.getAttribute('y') : null,
    flowArrowD:     flowArrow ? flowArrow.getAttribute('d') : null,
    freshnessPresent: freshnessChip !== null,
    orbitCount:     orbits.length,
  };
});
await browser.close();

const results = {
  legend_height_88:              probe.legendHeight === '88',
  recent_height_88_regression:   probe.recentHeight === '88',
  r271_working_hitbox_y_21:      probe.workingHitboxY === 21,
  flow_arrow_starts_at_y68:      probe.flowArrowD === 'M140,68 Q164,44 196,68',
  r275_freshness_absent:         probe.freshnessPresent === false,
  r276_orbit_absent:             probe.orbitCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend compress:`, JSON.stringify(results),
  '\n  legend height:', probe.legendHeight,
  '\n  recent height:', probe.recentHeight,
  '\n  working hitbox y:', probe.workingHitboxY,
  '\n  flow arrow d:', probe.flowArrowD,
  '\n  orbit count:', probe.orbitCount);
process.exit(ok ? 0 : 1);
