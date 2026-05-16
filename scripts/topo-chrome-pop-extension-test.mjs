/* Round 249 verification: chrome-pop click animation extends from
 * the existing zoom-in/zoom-out pair to ring/grid layout toggle +
 * fullscreen buttons. Whole chrome strip now speaks one click
 * vocabulary instead of zoom-only-pops + silent-everything-else.
 *
 * Per button, on click:
 *   data-topo-chrome-{key}-popping flips 'false' → 'true' for ~240ms
 *   className gains 'anet-chrome-pop' for the same window
 *
 * Test scope:
 *   - Ring layout button: click → data-topo-chrome-layout-ring-popping='true' (within 100ms)
 *   - Grid layout button: click → data-topo-chrome-layout-grid-popping='true'
 *   - Fullscreen button: click → data-topo-chrome-fullscreen-popping='true'
 *
 * Hard-to-test trap: chromePopping is transient (240ms TTL). Probe
 * immediately after Playwright click resolves. Wait full 240ms after
 * for the second probe — must be 'false' again.
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
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-fullscreen]', { timeout: 10000 });
await page.waitForTimeout(300);

const testButton = async (clickSelector, poppingAttr, label) => {
  // Click + immediately read state. The chromePopping setState is
  // synchronous within the click handler, so the DOM should reflect
  // 'true' on the next React commit (very soon after click resolves).
  await page.locator(clickSelector).click();
  // Probe quickly — within the 240ms window
  await page.waitForTimeout(50);
  const duringPop = await page.locator(clickSelector).getAttribute(poppingAttr);
  const classDuring = await page.locator(clickSelector).getAttribute('class');
  // Wait for the pop to clear
  await page.waitForTimeout(300);
  const afterPop = await page.locator(clickSelector).getAttribute(poppingAttr);
  const classAfter = await page.locator(clickSelector).getAttribute('class');
  return {
    label,
    duringAttr:   duringPop,
    duringClass:  /anet-chrome-pop/.test(classDuring || ''),
    afterAttr:    afterPop,
    afterClass:   /anet-chrome-pop/.test(classAfter || ''),
  };
};

const ring = await testButton('[data-topo-chrome-layout="ring"]', 'data-topo-chrome-layout-ring-popping', 'ring');
const grid = await testButton('[data-topo-chrome-layout="grid"]', 'data-topo-chrome-layout-grid-popping', 'grid');
// For fullscreen, browser context may not honour requestFullscreen in
// headless mode — wrap in try/catch on the page side. Test only the
// data attr + className.
const fullscreen = await testButton('[data-topo-chrome-fullscreen]', 'data-topo-chrome-fullscreen-popping', 'fullscreen');

await browser.close();

const ok_each = (b) =>
  b.duringAttr === 'true' && b.duringClass === true &&
  b.afterAttr === 'false' && b.afterClass === false;

const results = {
  ring_pops_on_click:        ok_each(ring),
  grid_pops_on_click:        ok_each(grid),
  fullscreen_pops_on_click:  ok_each(fullscreen),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome-pop extension:`, JSON.stringify(results),
  '\n  ring:      ', ring,
  '\n  grid:      ', grid,
  '\n  fullscreen:', fullscreen);
process.exit(ok ? 0 : 1);
