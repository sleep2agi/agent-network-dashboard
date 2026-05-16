/* Round 270 verification: chrome strip TOGGLE buttons align inactive
 * hover-bg to the Layout toggle's R163 cyan-preview pattern.
 *
 * Pre-R270:
 *   Layout Ring/Grid inactive:  'hover:bg-cyan-500/5 active:bg-cyan-500/15'   ← R163 cyan preview
 *   nodeSize S/M/L inactive:    'hover:bg-white/5 active:bg-white/10'         ← neutral white
 *   fullscreen inactive:        'hover:bg-white/5 active:bg-white/10'         ← neutral white
 *   zoom -/+ + reset:            'hover:bg-white/5 active:bg-white/10'         ← actions, no state
 *
 * The TOGGLES (Layout, nodeSize, fullscreen) split into two hover vocabularies:
 * Layout uses cyan-preview, the others use neutral white. R270 unifies the
 * other toggles to the cyan-preview pattern so all chrome TOGGLES preview
 * their active state on hover. Pure ACTIONS (zoom, reset) stay white.
 *
 * Test scope:
 *   1. nodeSize INACTIVE button(s) have 'hover:bg-cyan-500/5' class. With
 *      nodeScale=1 (L active), S and M are inactive — probe one of them.
 *   2. nodeSize ACTIVE button still has 'hover:bg-cyan-500/20' (unchanged).
 *   3. Fullscreen INACTIVE has 'hover:bg-cyan-500/5' (we're not in fullscreen).
 *   4. Pure ACTIONS (zoom-out, reset) STILL use 'hover:bg-white/5' (regression).
 *   5. R268 layout toggle border still uses pal.containerBorder (regression).
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
await page.waitForSelector('[data-topo-chrome-nodesize="S"]',  { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-nodesize="L"]',  { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-fullscreen]',    { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-zoom-out]',      { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-reset]',         { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-layout-trailer]',{ timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  // With default state, nodeScale=1 → L active, S+M inactive.
  const s = document.querySelector('[data-topo-chrome-nodesize="S"]');
  const m = document.querySelector('[data-topo-chrome-nodesize="M"]');
  const l = document.querySelector('[data-topo-chrome-nodesize="L"]');
  const fullscreen = document.querySelector('[data-topo-chrome-fullscreen]');
  const zoomOut    = document.querySelector('[data-topo-chrome-zoom-out]');
  const reset      = document.querySelector('[data-topo-chrome-reset]');
  const layoutWrap = document.querySelector('[data-topo-chrome-layout-trailer]');
  return {
    sClasses:           s          ? s.className.toString()          : null,
    mClasses:           m          ? m.className.toString()          : null,
    lClasses:           l          ? l.className.toString()          : null,
    fullscreenClasses:  fullscreen ? fullscreen.className.toString() : null,
    zoomOutClasses:     zoomOut    ? zoomOut.className.toString()    : null,
    resetClasses:       reset      ? reset.className.toString()      : null,
    layoutBorderColor:  layoutWrap ? window.getComputedStyle(layoutWrap).borderTopColor : null,
  };
});
await browser.close();

const has = (s, cls) => (s || '').includes(cls);

// nodeScale defaults to 0.84 (M is active). S and L are inactive.
const results = {
  // Inactive nodeSize buttons (S + L when M is default-active) → cyan hover
  s_inactive_has_cyan_hover:      has(probe.sClasses, 'hover:bg-cyan-500/5'),
  l_inactive_has_cyan_hover:      has(probe.lClasses, 'hover:bg-cyan-500/5'),
  // Active nodeSize (M @ 0.84 default) → unchanged cyan-500/20 hover (active variant)
  m_active_has_cyan20_hover:      has(probe.mClasses, 'hover:bg-cyan-500/20'),
  // No more white/5 on inactive nodeSize
  s_inactive_no_white_hover:      !has(probe.sClasses, 'hover:bg-white/5'),
  // Fullscreen INACTIVE (not in fullscreen) picks up cyan hover
  fullscreen_inactive_has_cyan:   has(probe.fullscreenClasses, 'hover:bg-cyan-500/5'),
  fullscreen_no_white_hover:      !has(probe.fullscreenClasses, 'hover:bg-white/5'),
  // Pure ACTIONS stay white
  zoom_out_keeps_white_hover:     has(probe.zoomOutClasses, 'hover:bg-white/5'),
  reset_keeps_white_hover:        has(probe.resetClasses,   'hover:bg-white/5'),
  // R268 regression: layout border still uses pal.containerBorder
  r268_layout_border_unified:     probe.layoutBorderColor === 'rgb(42, 42, 74)',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} toggle inactive cyan hover:`, JSON.stringify(results),
  '\n  S classes:',          probe.sClasses,
  '\n  L (active):',          probe.lClasses,
  '\n  fullscreen (inactive):', probe.fullscreenClasses,
  '\n  zoom-out:',            probe.zoomOutClasses,
  '\n  reset:',               probe.resetClasses,
  '\n  layout border:',       probe.layoutBorderColor);
process.exit(ok ? 0 : 1);
