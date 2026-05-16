/* Round 256 verification: recent-signal panel footer breathing room.
 *
 * Pre-R256 the panel was 230×84 with the footer "+ N more flows" text
 * baseline at y=82, fontSize 8. CSS textDecoration:underline (on hover)
 * renders ~3-4px below baseline → y ≈ 85-86, BELOW the panel rect
 * bottom y=84. The hover affordance literally extended past the panel
 * chrome.
 *
 * R256 grows the panel rect from height 84 → 88 (+4 px), keeping
 * footer y=82 and every interior layout coordinate untouched. The
 * underline now sits at y≈85-86 inside an 88-tall panel — 2-3 px of
 * clear room below it, the textDecoration tucks INSIDE the panel
 * border instead of clipping past it.
 *
 * Test scope:
 *   1. Panel rect height === 88 (DOM-side ground truth).
 *   2. Footer baseline y === 82 (didn't shift — only the panel grew).
 *   3. Footer bbox bottom (baseline + descender + reserve for
 *      underline) < panel rect bottom y. Use getBBox on the text
 *      element and verify it sits inside the rect.
 *   4. Fleet of >3 flows so footer mounts visible (R221 always-mount
 *      + opacity gate; gated visible at flowLinks.length > 3).
 *   5. Underline on hover stays inside the panel — hover, wait for
 *      transition, measure underline location via the element's
 *      bounding rect vs the panel's bounding rect.
 *
 * Geometric check (sanity): panel corner (16+230, 16+88) = (246, 104).
 *   Distance to canvas center (500, 330) = √(254² + 226²) ≈ 339.99.
 *   Outermost ring radius is 325; corner clears the ring (> 325 → ok).
 *   Panel still tucked outside any node.
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

// Mock sessions: 4 working agents (alpha/beta/gamma/delta)
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

// 5 messages across 5 distinct flow pairs so flowLinks.length === 5
// (> 3 → footer mounts visible, the "+ 2 more flows" hint).
const now = Date.now();
const msgs = [
  { id: 'm0', from_alias: 'alpha', to_alias: 'beta',  content: 'hi 1', network_id: 'default', created_at: new Date(now - 1000).toISOString() },
  { id: 'm1', from_alias: 'beta',  to_alias: 'gamma', content: 'hi 2', network_id: 'default', created_at: new Date(now - 1500).toISOString() },
  { id: 'm2', from_alias: 'gamma', to_alias: 'delta', content: 'hi 3', network_id: 'default', created_at: new Date(now - 2000).toISOString() },
  { id: 'm3', from_alias: 'delta', to_alias: 'alpha', content: 'hi 4', network_id: 'default', created_at: new Date(now - 2500).toISOString() },
  { id: 'm4', from_alias: 'alpha', to_alias: 'gamma', content: 'hi 5', network_id: 'default', created_at: new Date(now - 3000).toISOString() },
];
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-panel-more-nav]', { timeout: 10000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const panelG = document.querySelector('[data-topo-panel="recent"]');
  const rect   = panelG?.querySelector('rect');
  const footer = document.querySelector('[data-recent-panel-more]');
  const tx = panelG?.getAttribute('transform').match(/translate\(([\d.]+),\s*([\d.]+)\)/);
  const panelTopY = tx ? +tx[2] : null;
  const rectH = rect ? +rect.getAttribute('height') : null;
  const footerY = footer ? +footer.getAttribute('y') : null;
  // Use getBoundingClientRect for both — getBBox on text inside a
  // transformed <g> with opacity transition can return zero on some
  // browser stacks (rev-checked against earlier R203/R215 idioms).
  // Client-rect math gives consistent ground truth.
  const rectCR   = rect   ? rect.getBoundingClientRect()   : null;
  const footerCR = footer ? footer.getBoundingClientRect() : null;
  return {
    panelTopY, rectH, footerY,
    rectCR_bottom:   rectCR   ? rectCR.bottom   : null,
    footerCR_bottom: footerCR ? footerCR.bottom : null,
  };
});

// Hover the footer + measure underline-region overflow vs panel
await page.locator('[data-recent-panel-more-nav]').hover();
await page.waitForTimeout(250);

const hoverProbe = await page.evaluate(() => {
  const panelG = document.querySelector('[data-topo-panel="recent"]');
  const rect   = panelG?.querySelector('rect');
  const footer = document.querySelector('[data-recent-panel-more]');
  return {
    hovered: footer?.getAttribute('data-recent-panel-more-hovered'),
    textDecoration: footer ? window.getComputedStyle(footer).textDecorationLine : null,
    rectClientBottom: rect?.getBoundingClientRect().bottom ?? null,
    footerClientBottom: footer?.getBoundingClientRect().bottom ?? null,
  };
});
await browser.close();

// At rest: footer's client-rect bottom should sit at or above (less than)
// the panel rect's client-rect bottom. Allow 1px sub-pixel slop.
const restClearance  = (probe.rectCR_bottom != null && probe.footerCR_bottom != null)
  ? (probe.rectCR_bottom - probe.footerCR_bottom) : null;

// Hover-state: same check, but the underline-on-hover would have shifted
// the visible bottom downward by the underline's offset. Verifies it
// still tucks INSIDE the panel chrome.
const hoverClearance = (hoverProbe.rectClientBottom != null && hoverProbe.footerClientBottom != null)
  ? (hoverProbe.rectClientBottom - hoverProbe.footerClientBottom) : null;

const results = {
  panel_height_88:                 probe.rectH === 88,
  footer_y_unchanged_at_82:        probe.footerY === 82,
  rest_footer_inside_panel:        restClearance != null && restClearance >= -1,
  rest_footer_breathing_room:      restClearance != null && restClearance >= 2,  // at least 2px clear at rest
  hover_state_fires:               hoverProbe.hovered === 'true',
  hover_underline_applied:         hoverProbe.textDecoration?.includes('underline') === true,
  hover_footer_inside_panel:       hoverClearance != null && hoverClearance >= -1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent panel footer breath:`, JSON.stringify(results),
  '\n  panelRectH:', probe.rectH, 'footerY:', probe.footerY,
  '\n  rest clearance:', restClearance, 'px (rect bottom', probe.rectCR_bottom, 'footer bottom', probe.footerCR_bottom, ')',
  '\n  hover clearance:', hoverClearance, 'px (rect bottom', hoverProbe.rectClientBottom, 'footer bottom', hoverProbe.footerClientBottom, ')',
  '\n  hover textDecoration:', hoverProbe.textDecoration);
process.exit(ok ? 0 : 1);
