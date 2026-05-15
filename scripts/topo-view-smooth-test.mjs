/* Round 168 verification: smooth viewport transition on reset/fit.
 *
 * Pre-R168 resetView/fitView snapped the <g transform> from
 * current zoom/pan to {zoom:1, x:0, y:0} in one frame. Pressing
 * `0` or clicking the hub jolted the eye.
 *
 * R168 arms a one-shot smoothView flag when resetView/fitView
 * fires; the viewport <g> reads this flag and conditionally
 * applies `transition: transform 300ms ease-out`. Auto-clears
 * 350ms later. Pan (R103 drag) and wheel zoom never set the
 * flag, so interactive view changes stay snappy.
 *
 * Test:
 *   1. Load page → idle state, smoothView=false (no transition)
 *   2. Zoom in twice via '+' to set non-default view
 *   3. Press '0' (resetView) → smoothView=true, viewport <g>
 *      has style.transition = 'transform 300ms ease-out'
 *   4. Wait 450ms → smoothView=false again, transition cleared
 *   5. Repeat with 'f' (fitView)
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-viewport]', { timeout: 10000 });
await page.waitForTimeout(400);

// Idle: smoothView=false, no transition style.
const idle = await page.evaluate(() => {
  const g = document.querySelector('[data-topo-viewport]');
  return {
    smooth: g?.getAttribute('data-topo-viewport-smooth'),
    transition: g?.style?.transition || '',
  };
});

// Zoom in twice → set non-default view
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.waitForTimeout(150);
const zoomBefore = await page.evaluate(() =>
  document.querySelector('[data-topo-chrome-zoom-level]')?.textContent?.trim());

// Press 0 (resetView) → smoothView=true. Probe within the
// 350ms window so the style is still set.
await page.keyboard.press('0');
// Small delay so React commits the state update.
await page.waitForTimeout(50);
const duringReset = await page.evaluate(() => {
  const g = document.querySelector('[data-topo-viewport]');
  return {
    smooth: g?.getAttribute('data-topo-viewport-smooth'),
    transition: g?.style?.transition || '',
  };
});

// Wait past the 350ms window
await page.waitForTimeout(450);
const afterReset = await page.evaluate(() => {
  const g = document.querySelector('[data-topo-viewport]');
  return {
    smooth: g?.getAttribute('data-topo-viewport-smooth'),
    transition: g?.style?.transition || '',
  };
});
const zoomAfter = await page.evaluate(() =>
  document.querySelector('[data-topo-chrome-zoom-level]')?.textContent?.trim());

// Now zoom in again and press 'f' (fitView) — same arming path
await page.keyboard.press('+');
await page.keyboard.press('+');
await page.waitForTimeout(150);
await page.keyboard.press('f');
await page.waitForTimeout(50);
const duringFit = await page.evaluate(() => {
  const g = document.querySelector('[data-topo-viewport]');
  return {
    smooth: g?.getAttribute('data-topo-viewport-smooth'),
    transition: g?.style?.transition || '',
  };
});

await browser.close();

const results = {
  viewport_found:           idle !== null,
  idle_smooth_false:        idle.smooth === 'false',
  idle_no_transition:       !idle.transition.includes('transform'),
  zoomed_before_reset:      zoomBefore !== '100%',
  reset_armed_smooth:       duringReset.smooth === 'true',
  reset_transition_set:     duringReset.transition.includes('transform 300ms'),
  after_reset_smooth_false: afterReset.smooth === 'false',
  after_reset_no_transition: !afterReset.transition.includes('transform'),
  reset_landed_at_100:      zoomAfter === '100%',
  fit_armed_smooth:         duringFit.smooth === 'true',
  fit_transition_set:       duringFit.transition.includes('transform 300ms'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} view smooth transition:`, JSON.stringify(results),
  `\n  idle =`, idle,
  `\n  duringReset =`, duringReset,
  `\n  afterReset =`, afterReset,
  `\n  duringFit =`, duringFit,
  `\n  zoom before/after = ${zoomBefore} → ${zoomAfter}`);
process.exit(ok ? 0 : 1);
