/* Round 350 verification: chrome reset-button icon gains a hover-
 * rotate preview of the R184 click-spin. Pre-R350 hovering the reset
 * button only changed the button bg (white/5); the icon stayed still.
 * R350 nudges the icon -8° on hover — tactile hint that this button
 * rotates the icon on click. Gated on !resetSpinning so anet-reset-
 * spin keyframe still owns transform during its 450 ms run.
 * 350th-round milestone polish.
 *
 * Contract:
 *   - Rest: icon transform 'rotate(0deg)' (no rotation), transformOrigin
 *     'center'.
 *   - Hover: icon transform 'rotate(-8deg)'.
 *   - Inline transition contains 'transform'.
 *   - data-topo-chrome-reset-hover toggles on container; data-topo-
 *     chrome-reset-icon-hover mirrors on the icon (only when !spinning).
 *   - Pre-R350 invariants: R288 strokeWidth=2.5 + R184 anet-reset-spin
 *     className gate intact (no spin running at rest).
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-reset]', { timeout: 15000 });
await page.waitForTimeout(300);

// Rest probe.
const restProbe = await page.evaluate(() => {
  const btn = document.querySelector('[data-topo-chrome-reset]');
  const ico = document.querySelector('[data-topo-chrome-reset-icon]');
  const cs  = ico ? getComputedStyle(ico) : null;
  return {
    btnHover:     btn?.getAttribute('data-topo-chrome-reset-hover') ?? null,
    icoHover:     ico?.getAttribute('data-topo-chrome-reset-icon-hover') ?? null,
    icoTransform: cs?.transform ?? null,
    icoTransition: cs?.transition ?? null,
    icoStrokeW:   ico?.getAttribute('stroke-width') ?? null,
    spinClass:    ico?.getAttribute('class') ?? null,
  };
});

// Hover the reset button.
await page.hover('[data-topo-chrome-reset]');
await page.waitForTimeout(300);
const hoverProbe = await page.evaluate(() => {
  const btn = document.querySelector('[data-topo-chrome-reset]');
  const ico = document.querySelector('[data-topo-chrome-reset-icon]');
  const cs  = ico ? getComputedStyle(ico) : null;
  return {
    btnHover:     btn?.getAttribute('data-topo-chrome-reset-hover') ?? null,
    icoHover:     ico?.getAttribute('data-topo-chrome-reset-icon-hover') ?? null,
    icoTransform: cs?.transform ?? null,
  };
});

await browser.close();

const hasTrans = (s) => /transform\s+\d*\.?\d*s|transform\s+\d+ms/i.test(s || '');
// computed transform 'none' or a matrix near identity at rest.
const isRestTransform = (t) => t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t || '') ||
  /matrix\(0\.999/i.test(t || '') /* tiny rounding tolerance */;
// computed transform for -8deg ≈ matrix(0.990, -0.139, 0.139, 0.990, 0, 0).
const isHoverTransform = (t) => /matrix\(0\.99/i.test(t || '') && /-0\.13/i.test(t || '');

const results = {
  rest_btn_false:      restProbe.btnHover === 'false',
  rest_ico_false:      restProbe.icoHover === 'false',
  rest_no_rotation:    isRestTransform(restProbe.icoTransform),
  trans_has_transform: hasTrans(restProbe.icoTransition),
  rest_strokew_2_5:    restProbe.icoStrokeW === '2.5',     // R288
  rest_no_spin_class:  !/anet-reset-spin/.test(restProbe.spinClass || ''),
  hover_btn_true:      hoverProbe.btnHover === 'true',
  hover_ico_true:      hoverProbe.icoHover === 'true',
  hover_rotated:       isHoverTransform(hoverProbe.icoTransform),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} reset icon hover-rotate:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
