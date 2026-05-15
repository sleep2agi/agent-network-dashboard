/* Round 157 verification: minimap a11y completion.
 *
 * Pre-R157 the R30 minimap had role="img" (wrong — it's clickable)
 * + aria-label but no tabIndex / onKeyDown. Mouse users could
 * click to recenter; keyboard-only users couldn't reach or
 * activate it.
 *
 * R157 closes the gap with the standard pattern (R116/R139/R140/
 * R151/R152):
 *   role="button"
 *   tabIndex={0}
 *   aria-label="Topology minimap — click to recenter, Enter to reset view"
 *   onKeyDown(Enter/Space) → resetView()
 *   anet-topo-chip-focus className (R155 cyan outline)
 *
 * Test:
 *   1. Force the canvas off-default via zoom (so minimap renders)
 *   2. Verify role / tabIndex / aria-label / class on the minimap
 *   3. Press Enter on focused minimap → view resets (zoom back to 100%)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForTimeout(400);

// Initial: zoom is 100%, minimap not rendered (gated to non-default view)
const minimapBefore = await page.locator('[data-topo-minimap]').count();

// Press + (zoom in) twice to render the minimap
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.waitForTimeout(250);

const probe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-minimap]');
  if (!el) return null;
  return {
    role:       el.getAttribute('role'),
    tabIndex:   el.getAttribute('tabindex'),
    ariaLabel:  el.getAttribute('aria-label'),
    title:      el.getAttribute('title'),
    className:  el.getAttribute('class') || '',
    zoomLevel:  document.querySelector('[data-topo-chrome-zoom-level]')?.textContent?.trim(),
  };
});

// Focus minimap + Enter → reset view (zoom back to 100%)
await page.locator('[data-topo-minimap]').focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const afterEnter = await page.evaluate(() => ({
  zoomLevel: document.querySelector('[data-topo-chrome-zoom-level]')?.textContent?.trim(),
  minimapHidden: !document.querySelector('[data-topo-minimap]'),
}));

await browser.close();

const results = {
  minimap_hiddenAtDefault: minimapBefore === 0,
  minimap_renderedAfterZoom: probe !== null,
  role_button:             probe?.role === 'button',
  tabIndex_0:              probe?.tabIndex === '0',
  ariaLabel_mentionsEnter: (probe?.ariaLabel || '').includes('Enter'),
  title_mentionsEnter:     (probe?.title || '').includes('Enter'),
  hasFocusClass:           (probe?.className || '').includes('anet-topo-chip-focus'),
  zoomedBeforeReset:       probe?.zoomLevel !== '100%',
  enter_resetsZoom:        afterEnter.zoomLevel === '100%',
  enter_hidesMinimap:      afterEnter.minimapHidden === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap a11y:`, JSON.stringify(results),
  `\n  before count=${minimapBefore}`,
  `\n  probe=`, probe,
  `\n  afterEnter=`, afterEnter);
process.exit(ok ? 0 : 1);
