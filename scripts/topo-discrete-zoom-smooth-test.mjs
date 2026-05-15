/* Round 169 verification: keyboard '+'/'−' and chrome zoom in/out
 * buttons arm the R168 smoothView transition.
 *
 * R168 introduced one-shot smoothView arming on resetView/fitView.
 * R169 extends the same arming to the three other DISCRETE zoom
 * surfaces (one keypress / button-click = one 1.2× step):
 *   keyboard '+' / '=' / '−' / '_'
 *   chrome zoom-in / zoom-out buttons
 *
 * Wheel zoom stays direct (every tick = live, no transition lag).
 * Wrapper:
 *   const zoomByDiscrete = (factor) => {
 *     setSmoothView(true);
 *     setTimeout(() => setSmoothView(false), 350);
 *     zoomBy(factor);
 *   };
 *
 * Test:
 *   1. Idle:        smooth=false, no transition
 *   2. Press '+':   smooth=true, transition 'transform 300ms ease-out'
 *                   zoom 100% → 120%
 *   3. Wait 450ms:  smooth=false, transition cleared
 *   4. Click chrome zoom-in button: smooth=true again (same path)
 *   5. Press '−':   smooth=true, zoom back toward 100%
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

const probeViewport = () => page.evaluate(() => {
  const g = document.querySelector('[data-topo-viewport]');
  return {
    smooth: g?.getAttribute('data-topo-viewport-smooth'),
    transition: g?.style?.transition || '',
  };
});
const probeZoom = () => page.evaluate(() =>
  document.querySelector('[data-topo-chrome-zoom-level]')?.textContent?.trim());

const idle = await probeViewport();
const zoomIdle = await probeZoom();

// Press '+' → keyboard zoom-in. Probe within the 350ms window.
await page.keyboard.press('+');
await page.waitForTimeout(50);
const duringKbZoomIn = await probeViewport();
const zoomAfterKb = await probeZoom();

// Wait past the 350ms window
await page.waitForTimeout(450);
const afterKbZoomIn = await probeViewport();

// Click chrome zoom-in button → same arming path
await page.locator('[data-topo-chrome-zoom-in]').click();
await page.waitForTimeout(50);
const duringChromeZoomIn = await probeViewport();
const zoomAfterChromeIn = await probeZoom();

// Wait past window then press '−' (keyboard zoom-out)
await page.waitForTimeout(450);
await page.keyboard.press('-');
await page.waitForTimeout(50);
const duringKbZoomOut = await probeViewport();
const zoomAfterKbOut = await probeZoom();

await browser.close();

const results = {
  viewport_found:                  idle !== null,
  idle_smooth_false:               idle.smooth === 'false',
  idle_no_transition:              !idle.transition.includes('transform'),
  idle_zoom_100:                   zoomIdle === '100%',

  kb_plus_armed_smooth:            duringKbZoomIn.smooth === 'true',
  kb_plus_transition_set:          duringKbZoomIn.transition.includes('transform 300ms'),
  kb_plus_zoom_increased:          zoomAfterKb !== '100%',

  after_kb_smooth_cleared:         afterKbZoomIn.smooth === 'false',
  after_kb_no_transition:          !afterKbZoomIn.transition.includes('transform'),

  chrome_in_armed_smooth:          duringChromeZoomIn.smooth === 'true',
  chrome_in_transition_set:        duringChromeZoomIn.transition.includes('transform 300ms'),
  chrome_in_zoom_increased:        zoomAfterChromeIn !== zoomAfterKb,

  kb_minus_armed_smooth:           duringKbZoomOut.smooth === 'true',
  kb_minus_transition_set:         duringKbZoomOut.transition.includes('transform 300ms'),
  kb_minus_zoom_decreased:         zoomAfterKbOut !== zoomAfterChromeIn,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} discrete zoom smooth:`, JSON.stringify(results),
  `\n  idle =`, idle, `zoom=${zoomIdle}`,
  `\n  '+' fired =`, duringKbZoomIn, `zoom=${zoomAfterKb}`,
  `\n  after '+' =`, afterKbZoomIn,
  `\n  chrome-in fired =`, duringChromeZoomIn, `zoom=${zoomAfterChromeIn}`,
  `\n  '-' fired =`, duringKbZoomOut, `zoom=${zoomAfterKbOut}`);
process.exit(ok ? 0 : 1);
