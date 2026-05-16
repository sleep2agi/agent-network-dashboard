/* Round 255 verification: chrome-strip semantic gap.
 *
 * Pre-R255 the bottom-right chrome strip had all 4 groups at uniform
 * gap-1.5 (6px):
 *   [ S | M | L ] 6px [ - | % | + ] 6px [ reset ] 6px [ fullscreen ]
 *
 * R255 doubles the gap before the first view-control group via ml-1.5
 * on the zoom container — stacks on top of parent's gap-1.5 (6+6=12px):
 *   [ S | M | L ]   12px   [ - | % | + ] 6px [ reset ] 6px [ fullscreen ]
 *                         ↑
 *                         semantic boundary: fleet | view
 *
 * Test scope:
 *   1. Both data attrs resolve to elements.
 *   2. Gap between fleet group's right edge and view group's left edge
 *      is ≥ 11px (allowing 1px sub-pixel rounding from 12px target).
 *   3. Gap between adjacent view-control elements (zoom→reset, reset→
 *      fullscreen) stays at ~6px (the parent gap-1.5) — confirms the
 *      ml-1.5 didn't accidentally widen ALL gaps.
 *   4. Vertical alignment preserved — both groups still share the same
 *      Y center (chrome strip didn't get visually broken).
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
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-fleet-group-trailer]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-view-group-leader]',  { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const fleet      = document.querySelector('[data-topo-chrome-fleet-group-trailer]');
  const view       = document.querySelector('[data-topo-chrome-view-group-leader]');
  const reset      = document.querySelector('[data-topo-chrome-reset]');
  const fullscreen = document.querySelector('[data-topo-chrome-fullscreen]');
  const r = (el) => el ? el.getBoundingClientRect() : null;
  return {
    fleet:      r(fleet),
    view:       r(view),
    reset:      r(reset),
    fullscreen: r(fullscreen),
  };
});
await browser.close();

const gapFleetToView = probe.view  && probe.fleet      ? probe.view.left      - probe.fleet.right      : null;
const gapViewToReset = probe.reset && probe.view       ? probe.reset.left     - probe.view.right       : null;
const gapResetToFull = probe.fullscreen && probe.reset ? probe.fullscreen.left - probe.reset.right     : null;
const yAlignedFleetView   = probe.fleet && probe.view ? Math.abs((probe.fleet.top  + probe.fleet.height / 2)
                                                              - (probe.view.top   + probe.view.height  / 2)) : null;

const results = {
  fleet_present:               probe.fleet !== null,
  view_present:                probe.view  !== null,
  reset_present:               probe.reset !== null,
  fullscreen_present:          probe.fullscreen !== null,

  // Doubled gap fleet→view: target 12px, accept ≥11 for sub-pixel
  fleet_to_view_gap_doubled:   gapFleetToView != null && gapFleetToView >= 11,

  // Adjacent view-control gaps stay at ~6px (the parent gap-1.5).
  // Accept 5-9px window for sub-pixel + Tailwind v4 token drift.
  view_to_reset_gap_unchanged: gapViewToReset != null && gapViewToReset >= 5 && gapViewToReset <= 9,
  reset_to_full_gap_unchanged: gapResetToFull != null && gapResetToFull >= 5 && gapResetToFull <= 9,

  // Vertical center alignment preserved (≤1px slop).
  y_aligned_fleet_view:        yAlignedFleetView != null && yAlignedFleetView <= 1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome strip semantic gap:`, JSON.stringify(results),
  '\n  gaps: fleet→view =', gapFleetToView, 'view→reset =', gapViewToReset, 'reset→full =', gapResetToFull,
  '\n  yAlignedΔ:', yAlignedFleetView);
process.exit(ok ? 0 : 1);
