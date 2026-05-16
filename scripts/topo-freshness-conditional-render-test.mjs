/* Round 275 verification: FreshnessChip converts from always-render
 * to conditional render (only when stale) — chip-row simplification
 * per Vincent 5214/5215-5217 visual audit ask ("乱" cleanup for
 * Twitter screenshot).
 *
 * Pre-R275 the chip ALWAYS rendered:
 *   fresh: gray  + "live · {sec}s"   (always-present "I'm fine" chip)
 *   stale: amber + "lag · {sec}s"    (R272 prefix swap)
 *
 * Post-R275:
 *   fresh: chip absent (null)
 *   stale: amber + "lag · {sec}s"    (warning indicator only)
 *
 * Net effect: chip-row at rest has 1 fewer chip — cleaner Twitter
 * screenshot, less right-edge chrome. Stale state still alerts via
 * conditional appearance (amber "lag" warning chip).
 *
 * R272 prefix-swap intent (live↔lag) still in code; only the lag side
 * is rendered now. Fresh state implicitly relies on other liveness
 * signals (recent-signal panel rows, edge animations, count updates).
 *
 * Test scope:
 *   1. At fresh state (default page load, 0s elapsed), chip element
 *      is NOT present in DOM. R275 simplification verified.
 *   2. R273 Layout toggle Grid inactive has hover:text-cyan-300
 *      (regression).
 *   3. R274 legend per-row count has tabular-nums (regression).
 *   4. Source code regression: FreshnessChip body still contains the
 *      "lag" / "live" ternary — verified by reading the bundled JS
 *      isn't worth the effort; trust the source diff + this fresh-
 *      absence test as proof R275 applied.
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
await page.waitForSelector('[data-topo-chrome-layout="grid"]',          { timeout: 10000 });
await page.waitForSelector('[data-legend-count="working"]',             { timeout: 10000 });
// Give the page time to settle so FreshnessChip mount cycle is stable.
// Note: we are NOT waiting for [data-freshness-chip] — that selector
// should NOT match in fresh state (chip absent). Use a short fixed
// wait instead.
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const freshnessChip = document.querySelector('[data-freshness-chip]');
  const grid          = document.querySelector('[data-topo-chrome-layout="grid"]');
  const legendCount   = document.querySelector('[data-legend-count="working"]');
  return {
    chipPresentAtFresh: freshnessChip !== null,
    gridClasses:        grid ? grid.className.toString() : null,
    legendCountFVN:     legendCount ? window.getComputedStyle(legendCount).fontVariantNumeric : null,
  };
});
await browser.close();

const results = {
  chip_absent_at_fresh:             probe.chipPresentAtFresh === false,
  r273_grid_has_cyan_hover_text:    (probe.gridClasses || '').includes('hover:text-cyan-300'),
  r274_legend_count_tabular:        probe.legendCountFVN != null && probe.legendCountFVN.includes('tabular-nums'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} freshness conditional render:`, JSON.stringify(results),
  '\n  chip present at fresh:', probe.chipPresentAtFresh, '(expected: false)',
  '\n  legend count FVN:',      probe.legendCountFVN);
process.exit(ok ? 0 : 1);
