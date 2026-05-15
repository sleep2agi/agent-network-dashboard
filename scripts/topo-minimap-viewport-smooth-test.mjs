/* Round 199 verification: minimap viewport rect transitions x/y/w/h
 * during R169 smoothView (discrete zoom +/− and reset). Closes the
 * rhythm-mismatch R198 just fixed for minimap dots — now extended to
 * the rectangle that frames them.
 *
 * Pre-R199 a click on zoom-in crossfaded the main canvas over R168's
 * 280ms but the minimap viewport rect snap-cut to its new dimensions
 * in one frame. R199 gates a `transition: x/y/w/h 280ms` on
 * smoothView=true so discrete zooms ease the rect smoothly. Drag-pan
 * and wheel-zoom (smoothView=false) keep snappy response — a
 * persistent transition during drag would lag the cursor by 280ms.
 *
 * Test:
 *   1. Open page with 4 sessions, zoom in once to mount minimap.
 *   2. Idle (smoothView=false): rect has
 *      data-topo-minimap-viewport-smooth='false', style.transition='none'.
 *   3. Click zoom-in again → smoothView arms to 'true' for ~350ms.
 *   4. Within 100ms of click: probe rect →
 *      data-topo-minimap-viewport-smooth='true', style.transition
 *      includes 'x 280ms', 'y 280ms', 'width 280ms', 'height 280ms'.
 *   5. Wait past 400ms → smoothView clears → back to 'false', no
 *      transition.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 10000 });
await page.waitForTimeout(300);

// First zoom-in mounts the minimap. Wait past the 350ms smoothView
// timer so the minimap rect is at idle state (smooth='false') before
// we probe.
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(450);
await page.waitForSelector('[data-topo-minimap-viewport]', { timeout: 5000 });

const probe = async () => page.evaluate(() => {
  const el = document.querySelector('[data-topo-minimap-viewport]');
  if (!el) return null;
  return {
    smooth:     el.getAttribute('data-topo-minimap-viewport-smooth'),
    transition: el.style.transition,
    x:          parseFloat(el.getAttribute('x') || ''),
    y:          parseFloat(el.getAttribute('y') || ''),
    w:          parseFloat(el.getAttribute('width')  || ''),
    h:          parseFloat(el.getAttribute('height') || ''),
  };
});

const idle = await probe();

// Click zoom-in once more — arms smoothView for ~350ms — and probe
// within the arming window.
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(80);  // well inside the 350ms arming window
const armed = await probe();

await page.waitForTimeout(420);  // past 350ms timer + transition
const settled = await probe();

await browser.close();

const hasAllAxes = (s) =>
  /\bx\s+(?:280ms|0\.28s)/.test(s || '') &&
  /\by\s+(?:280ms|0\.28s)/.test(s || '') &&
  /\bwidth\s+(?:280ms|0\.28s)/.test(s || '') &&
  /\bheight\s+(?:280ms|0\.28s)/.test(s || '');

const results = {
  idle_smooth_false:           idle?.smooth === 'false',
  idle_transition_none:        idle?.transition === 'none' || idle?.transition === '',
  idle_has_dimensions:         idle && Number.isFinite(idle.x) && Number.isFinite(idle.w) && idle.w > 0,

  armed_smooth_true:           armed?.smooth === 'true',
  armed_transition_present:    !!armed?.transition && armed.transition !== 'none',
  armed_transition_has_all:    hasAllAxes(armed?.transition),

  settled_smooth_false:        settled?.smooth === 'false',
  settled_transition_none:     settled?.transition === 'none' || settled?.transition === '',

  // R199 actually changed dimensions between idle (zoom 120%) and
  // settled (zoom 144% after second click), or x/y diverged.
  zoom_changed_dimensions:     idle && settled && (
    Math.abs(idle.w - settled.w) > 1 ||
    Math.abs(idle.h - settled.h) > 1 ||
    Math.abs(idle.x - settled.x) > 1 ||
    Math.abs(idle.y - settled.y) > 1
  ),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap viewport smooth:`, JSON.stringify(results),
  `\n  idle:`,    idle,
  `\n  armed:`,   armed,
  `\n  settled:`, settled);
process.exit(ok ? 0 : 1);
