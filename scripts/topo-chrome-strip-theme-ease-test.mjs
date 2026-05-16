/* Round 264 verification: chrome strip wrappers + zoom level readout
 * pick up theme-toggle transitions — close R263's R254-holdover sweep.
 *
 * Pre-R264 the chrome strip's STRUCTURAL pieces had theme-driven
 * inline styles but no transition coverage:
 *
 *   nodeSize wrapper   (line ~6603): bg + borderColor inline, no transition
 *   zoom wrapper       (line ~6666): bg + borderColor inline, no transition
 *   zoom level readout (line ~6711): color + border-x inline, no transition
 *
 * Reset + fullscreen buttons already had `transition-colors` className
 * covering their bg/border/color theme swaps. Inner S/M/L and -/+
 * buttons same. So inner buttons eased smoothly through theme but the
 * surrounding wrappers + readout SNAPPED — a layered hard-cut where
 * the bordered container hard-flipped under the eased buttons inside.
 *
 * R264 adds 200ms theme transitions to all three structural pieces.
 *
 * Test scope:
 *   1. nodeSize wrapper transition contains background-color + border-color.
 *   2. zoom wrapper (data-topo-chrome-zoom-wrapper) same.
 *   3. zoom level readout transition contains color + border-color.
 *   4. R263 wrapper invariant: top-level wrapper transition still has
 *      box-shadow (regression).
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
await page.waitForSelector('[data-topo-chrome-fleet-group-trailer]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-zoom-wrapper]',        { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-zoom-level]',          { timeout: 10000 });
await page.waitForSelector('[data-topo-wrapper]',                    { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const nodeSize     = document.querySelector('[data-topo-chrome-fleet-group-trailer]');
  const zoom         = document.querySelector('[data-topo-chrome-zoom-wrapper]');
  const zoomLevel    = document.querySelector('[data-topo-chrome-zoom-level]');
  const wrapper      = document.querySelector('[data-topo-wrapper]');
  return {
    nodeSizeTransition:  nodeSize  ? nodeSize.style.transition  : null,
    zoomTransition:      zoom      ? zoom.style.transition      : null,
    zoomLevelTransition: zoomLevel ? zoomLevel.style.transition : null,
    wrapperTransition:   wrapper   ? wrapper.style.transition   : null,
  };
});
await browser.close();

const has = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  nodesize_present:                    probe.nodeSizeTransition !== null,
  nodesize_has_bg_color_200:           has(probe.nodeSizeTransition, 'background-color'),
  nodesize_has_border_color_200:       has(probe.nodeSizeTransition, 'border-color'),

  zoom_present:                        probe.zoomTransition !== null,
  zoom_has_bg_color_200:               has(probe.zoomTransition, 'background-color'),
  zoom_has_border_color_200:           has(probe.zoomTransition, 'border-color'),

  zoom_level_present:                  probe.zoomLevelTransition !== null,
  zoom_level_has_color_200:            has(probe.zoomLevelTransition, '(?<!background-|border-)color'),
  zoom_level_has_border_color_200:     has(probe.zoomLevelTransition, 'border-color'),

  r263_wrapper_box_shadow_200:         has(probe.wrapperTransition, 'box-shadow'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome strip theme ease:`, JSON.stringify(results),
  '\n  nodeSize:   ', probe.nodeSizeTransition,
  '\n  zoom:       ', probe.zoomTransition,
  '\n  zoomLevel:  ', probe.zoomLevelTransition,
  '\n  wrapper:    ', probe.wrapperTransition);
process.exit(ok ? 0 : 1);
