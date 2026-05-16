/* Round 268 verification: Layout toggle border unified with chrome
 * strip's theme-aware borderColor.
 *
 * Pre-R268 the Layout toggle's wrapper + Grid button's internal
 * divider used hardcoded `border-gray-500/25` (Tailwind pale gray,
 * fixed in both themes). The bottom-right chrome strip's analogous
 * wrappers (nodeSize, zoom) used pal.containerBorder (cyber
 * #2a2a4a dark indigo ↔ light #e3e6eb pale gray).
 *
 * Visible mismatch in cyber theme: Layout toggle border read as pale
 * gray-500/25 (rgba 107,114,128,0.25) while chrome strip borders read
 * as darker indigo `#2a2a4a` — two different border colors on
 * visually-analogous segmented controls. R268 replaces the hardcoded
 * class with inline pal.containerBorder + a border-color transition.
 *
 * Test scope:
 *   1. Layout toggle wrapper rgb(border-color) matches nodeSize
 *      wrapper rgb(border-color) — both use pal.containerBorder.
 *   2. Layout toggle wrapper has border-color transition (200ms).
 *   3. Grid button's left border color matches the wrapper's
 *      border color.
 *   4. R260 chip-row semantic gap intact: gap toggle→working ≥ 11.
 *   5. R267 title-block leading-tight regression: kicker still has
 *      the class.
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
await page.waitForSelector('[data-topo-chrome-layout-trailer]',     { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-fleet-group-trailer]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-layout="grid"]',       { timeout: 10000 });
await page.waitForSelector('[data-topo-section-kicker]',             { timeout: 10000 });
await page.waitForSelector('[data-working-chip]',                    { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const layoutWrapper = document.querySelector('[data-topo-chrome-layout-trailer]');
  const nodeSize     = document.querySelector('[data-topo-chrome-fleet-group-trailer]');
  const gridButton   = document.querySelector('[data-topo-chrome-layout="grid"]');
  const kicker       = document.querySelector('[data-topo-section-kicker]');
  const working      = document.querySelector('[data-working-chip]');
  const layoutStyle  = layoutWrapper ? window.getComputedStyle(layoutWrapper) : null;
  const nodeSizeStyle = nodeSize     ? window.getComputedStyle(nodeSize)      : null;
  const gridStyle    = gridButton    ? window.getComputedStyle(gridButton)    : null;
  return {
    layoutBorderColor:      layoutStyle  ? layoutStyle.borderTopColor : null,
    layoutTransition:       layoutWrapper ? layoutWrapper.style.transition : null,
    nodeSizeBorderColor:    nodeSizeStyle ? nodeSizeStyle.borderTopColor : null,
    gridBorderLeftColor:    gridStyle    ? gridStyle.borderLeftColor   : null,
    kickerHasLeadingTight:  kicker?.classList.contains('leading-tight') ?? false,
    toggleRight:            layoutWrapper ? layoutWrapper.getBoundingClientRect().right : null,
    workingLeft:            working ? working.getBoundingClientRect().left : null,
  };
});
await browser.close();

const has = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');
const gapToggleToWorking = (probe.toggleRight != null && probe.workingLeft != null)
  ? (probe.workingLeft - probe.toggleRight) : null;

const results = {
  layout_border_matches_nodesize:        probe.layoutBorderColor != null
                                          && probe.layoutBorderColor === probe.nodeSizeBorderColor,
  layout_has_border_color_transition:    has(probe.layoutTransition, 'border-color'),
  grid_button_border_matches_wrapper:    probe.gridBorderLeftColor != null
                                          && probe.gridBorderLeftColor === probe.layoutBorderColor,
  r260_chip_row_gap_intact:              gapToggleToWorking != null && gapToggleToWorking >= 11,
  r267_kicker_has_leading_tight:         probe.kickerHasLeadingTight,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} layout toggle border unify:`, JSON.stringify(results),
  '\n  layout    borderTop:', probe.layoutBorderColor,
  '\n  nodeSize  borderTop:', probe.nodeSizeBorderColor,
  '\n  grid btn  borderLeft:', probe.gridBorderLeftColor,
  '\n  layout transition:', probe.layoutTransition,
  '\n  toggle→working gap:', gapToggleToWorking);
process.exit(ok ? 0 : 1);
