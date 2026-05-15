/* Round 164 verification: edge midpoint count badge gains
 * hover-lift (6th surface in the hover-elevation idiom family).
 *
 * Pre-R164 the badge had R122 hover→edge-brighten propagation
 * but the badge itself stayed static (r=9, strokeWidth=1 or 2).
 * The hover-elevation family covered nodes/panels/group boxes/
 * recent rows/legend rows but not the canvas edge badges.
 *
 * R164:
 *   r = (isHoveredEdge || isPinned) ? 10.5 : 9
 *   transition r 180ms ease-out
 *   data-edge-badge-lifted = 'true' | 'false'
 *
 * Pin still keeps its R121 stroke change (legendHeadline +
 * width 2). Hover and pin share the radius lift.
 *
 * Test:
 *   1. Mock 4 msgs on alpha→beta (R100 threshold = count >= 3)
 *   2. Probe idle radius = 9
 *   3. Hover the edge line → badge r = 10.5
 *   4. Mouseleave → r = 9 again
 *   5. Click badge → pin, r = 10.5 + stroke change
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 4 sessions so alpha and beta sit 90° apart on the ring
  // (not 180° apart — which would put alpha→beta midpoint
  // exactly on the hub at 500,330 and let the hub's r=18
  // halo intercept the badge hover). gamma + delta are
  // filler with no flows; the only edge badge that renders
  // is alpha↔beta.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

const now = Date.now();
const msgs = [];
for (let i = 0; i < 4; i++) {
  msgs.push({ id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (10000 + i * 500)).toISOString() });
}
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000 });
await page.waitForTimeout(400);

// Probe idle state
const idle = await page.evaluate(() => {
  const g = document.querySelector('[data-edge-count-badge]');
  if (!g) return null;
  const c = g.querySelector('circle');
  return {
    r: parseFloat(c.getAttribute('r')),
    lifted: c.getAttribute('data-edge-badge-lifted'),
    stroke: c.getAttribute('stroke'),
    strokeWidth: parseFloat(c.getAttribute('stroke-width')),
  };
});

// Hover the badge (it also propagates to hoveredEdgeKey)
await page.locator('[data-edge-count-badge]').hover();
await page.waitForTimeout(300);
const hovered = await page.evaluate(() => {
  const g = document.querySelector('[data-edge-count-badge]');
  if (!g) return null;
  const c = g.querySelector('circle');
  return {
    r: parseFloat(c.getAttribute('r')),
    lifted: c.getAttribute('data-edge-badge-lifted'),
  };
});

// Move cursor away to a known empty area
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const idleAgain = await page.evaluate(() => {
  const g = document.querySelector('[data-edge-count-badge]');
  if (!g) return null;
  const c = g.querySelector('circle');
  return {
    r: parseFloat(c.getAttribute('r')),
    lifted: c.getAttribute('data-edge-badge-lifted'),
  };
});

// Click badge → pin
await page.locator('[data-edge-count-badge]').click({ force: true });
await page.waitForTimeout(300);
// Move away to clear hover, then probe pinned state.
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const pinned = await page.evaluate(() => {
  const g = document.querySelector('[data-edge-count-badge]');
  if (!g) return null;
  const c = g.querySelector('circle');
  return {
    r: parseFloat(c.getAttribute('r')),
    lifted: c.getAttribute('data-edge-badge-lifted'),
    strokeWidth: parseFloat(c.getAttribute('stroke-width')),
    pinnedAttr: g.getAttribute('data-edge-count-badge-pinned'),
  };
});

await browser.close();

const results = {
  idle_r_9:               idle && Math.abs(idle.r - 9) < 0.01,
  idle_lifted_false:      idle && idle.lifted === 'false',
  idle_strokeWidth_1:     idle && idle.strokeWidth === 1,
  hover_r_10p5:           hovered && Math.abs(hovered.r - 10.5) < 0.01,
  hover_lifted_true:      hovered && hovered.lifted === 'true',
  idle_again_r_9:         idleAgain && Math.abs(idleAgain.r - 9) < 0.01,
  idle_again_lifted_false: idleAgain && idleAgain.lifted === 'false',
  pinned_r_10p5:          pinned && Math.abs(pinned.r - 10.5) < 0.01,
  pinned_lifted_true:     pinned && pinned.lifted === 'true',
  pinned_strokeWidth_2:   pinned && pinned.strokeWidth === 2,
  pinned_attr_true:       pinned && pinned.pinnedAttr === 'true',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge lift:`, JSON.stringify(results),
  `\n  idle =`, idle,
  `\n  hovered =`, hovered,
  `\n  idleAgain =`, idleAgain,
  `\n  pinned =`, pinned);
process.exit(ok ? 0 : 1);
