/* Round 52 verification: clicking the central hub triggers fitView() and
 * shows a click-ripple. The hub was previously decoration; now it's the
 * "re-center" affordance for users who don't know the `f` shortcut.
 *
 * Steps:
 *  - Zoom + pan the topology to a non-default view (Cmd+= twice + drag).
 *    Confirm the zoom group's transform shifted off identity.
 *  - Click the hub. Assert:
 *      1. the zoom group's transform returns to a fitted state (zoom and
 *         translate change), i.e. the view changed back toward identity-
 *         or-fit;
 *      2. a transient ripple <circle> shows up at the hub center, then
 *         vanishes within ~800ms.
 *  - Confirm the hub's <title> mentions "click to fit view".
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['alpha', 'beta', 'gamma'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-topo-hub]', { timeout: 30000 });
await page.waitForTimeout(500);

// Read the hub <title> to verify the hint text.
const hubTitle = await page.evaluate(() => {
  return document.querySelector('g[data-topo-hub] title')?.textContent || '';
});

// Find the zoom/pan wrapper <g> (the one whose transform attribute holds
// the scale + translate string). The TopoGraph wraps all canvas content
// in a <g> with transform="translate(x, y) scale(zoom)" at the panel root.
// Grab the first child <g> under the SVG that carries a `transform` with
// a `scale(` token — that's our zoom group.
const readTransform = () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  for (const g of svg.querySelectorAll(':scope > g')) {
    const t = g.getAttribute('transform') || '';
    if (t.includes('scale(')) return t;
  }
  return null;
});

const baseTransform = await readTransform();

// Nudge zoom by simulating Ctrl+= twice via keyboard shortcut. The
// keymap maps '+' to zoomBy; press 'Equal' with the right modifier so
// browsers see '+'.
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.waitForTimeout(150);
const zoomedTransform = await readTransform();

// Confirm the zoom transform actually changed.
const zoomChanged = baseTransform !== zoomedTransform;

// Click the hub center. Locator-based click hits the union bbox edge and
// gets intercepted by the SVG panel rect (which must keep pointer events
// for canvas pan). Sample the inner core circle (r=10 at viewBox 500,330)
// via getScreenCTM and click that on-screen point directly.
const hubCenter = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const core = [...svg.querySelectorAll('g[data-topo-hub] circle')].find(
    c => c.getAttribute('r') === '10'
  );
  if (!core) return null;
  const ctm = core.getScreenCTM();
  const cx = +core.getAttribute('cx');
  const cy = +core.getAttribute('cy');
  return { x: cx * ctm.a + cy * ctm.c + ctm.e, y: cx * ctm.b + cy * ctm.d + ctm.f };
});
if (!hubCenter) { console.log('❌ hub core circle not found'); process.exit(1); }
await page.mouse.click(hubCenter.x, hubCenter.y);
await page.waitForTimeout(150);
const afterClickTransform = await readTransform();
const ripplePresent = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  // The click ripple is a <circle> with stroke-width="2" + an <animate>.
  const ripples = [...svg.querySelectorAll('circle')].filter(c => {
    const sw = c.getAttribute('stroke-width');
    return sw === '2' && c.querySelector('animate[attributeName="r"]');
  });
  return ripples.length > 0;
});

await page.waitForTimeout(800);
const rippleGone = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const ripples = [...svg.querySelectorAll('circle')].filter(c => {
    const sw = c.getAttribute('stroke-width');
    return sw === '2' && c.querySelector('animate[attributeName="r"]');
  });
  return ripples.length === 0;
});

await browser.close();

const results = {
  hubTitleHasFitHint: /click to fit view/i.test(hubTitle),
  zoomShifted: zoomChanged,
  hubClickRestoredView: afterClickTransform !== zoomedTransform,
  ripplePresentDuringClick: ripplePresent,
  rippleClearsAfter600ms: rippleGone,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub click fit:`, JSON.stringify(results),
  `\n  hubTitle=${JSON.stringify(hubTitle)}`,
  `\n  base    =${baseTransform}`,
  `\n  zoomed  =${zoomedTransform}`,
  `\n  fitBack =${afterClickTransform}`);
process.exit(ok ? 0 : 1);
