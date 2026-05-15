/* Round 159 verification: hub <g> gains keyboard a11y.
 *
 * R151-R157 a11y sweep covered nodes, group labels, edge badges,
 * recent rows, legend rows, chrome buttons, minimap, chip-row.
 * R158 named the canvas root. The hub <g> — the most visually
 * prominent interactive element on the canvas (R39 enlarged,
 * R43 tooltip, R52 click-to-fitView, R115 hover ring) — was the
 * only major interactive R151-R157 skipped.
 *
 * R159 closes that gap with the same standard pattern:
 *   role="button"
 *   tabIndex={0}
 *   aria-label="Network hub · N online · K working · M links — Enter to fit view"
 *   className="anet-topo-svg-focus" (R156 cyan focus ring)
 *   onKeyDown(Enter/Space) → fitView() + ripple
 *
 * Test:
 *   1. Mock 3 working + 2 idle sessions + zoom in (so fit-to-view
 *      has a visible effect — zoom level moves away from 100%)
 *   2. Assert role / tabIndex / aria-label / className on hub
 *   3. Focus hub + Enter → zoom resets to 100%
 *   4. Confirm aria-label mentions counts + Enter
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // R159 hub is gated to layout === 'ring' (line 2946 — grid uses
    // group boxes, no central hub). Force ring.
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-a1', 'working'), mk('agents-a2', 'working'), mk('agents-a3', 'working'),
    mk('infra-b1', 'idle'), mk('infra-b2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 5, { timeout: 30000 });
await page.waitForSelector('[data-topo-hub]', { timeout: 10000 });
await page.waitForTimeout(400);

// Probe ARIA before any interaction
const probe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub]');
  if (!el) return null;
  return {
    tagName:   el.tagName.toLowerCase(),
    role:      el.getAttribute('role'),
    tabIndex:  el.getAttribute('tabindex'),
    ariaLabel: el.getAttribute('aria-label'),
    className: el.getAttribute('class') || '',
  };
});

// Zoom in twice so fitView has a visible effect
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.waitForTimeout(250);
const zoomBefore = await page.evaluate(() =>
  document.querySelector('[data-topo-chrome-zoom-level]')?.textContent?.trim());

// Focus hub + Enter → fitView resets zoom to 100%
await page.locator('[data-topo-hub]').focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(350);
const zoomAfter = await page.evaluate(() =>
  document.querySelector('[data-topo-chrome-zoom-level]')?.textContent?.trim());

await browser.close();

const label = probe?.ariaLabel || '';
const results = {
  hub_found:               probe !== null,
  is_g:                    probe?.tagName === 'g',
  role_button:             probe?.role === 'button',
  tabIndex_0:              probe?.tabIndex === '0',
  label_mentions_online:   /5 online/.test(label),
  label_mentions_working:  /3 working/.test(label),
  label_mentions_enter:    /Enter to fit view/.test(label),
  has_focus_class:         (probe?.className || '').includes('anet-topo-svg-focus'),
  zoomedBefore:            zoomBefore !== '100%',
  enter_resetsZoom:        zoomAfter === '100%',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub a11y:`, JSON.stringify(results),
  `\n  probe=`, probe,
  `\n  zoomBefore=${zoomBefore}  zoomAfter=${zoomAfter}`);
process.exit(ok ? 0 : 1);
