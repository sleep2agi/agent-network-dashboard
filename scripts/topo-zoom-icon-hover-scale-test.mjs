/* Round 352 verification: zoom-out + zoom-in icons gain group-hover:
 * scale-110 — sibling to R350 reset hover-rotate. Pre-R352 hovering
 * the zoom buttons only changed the bg (white/5); the icons stayed
 * still. R352 lifts each icon 10 % on hover for a tactile "this
 * button does something" cue. Pure-CSS via Tailwind `group` parent +
 * `group-hover:scale-110` on the svg + `transition-transform
 * duration-200 ease-out`. CSS-animation precedence keeps R186
 * anet-chrome-pop owning transform during the 220 ms click pop;
 * group-hover scale-110 picks up smoothly afterward.
 *
 * Contract:
 *   - Rest: both zoom icons computed transform 'matrix(1, 0, 0, 1, 0, 0)'
 *     (or 'none').
 *   - Hover zoom-out button: zoom-out icon transform matrix(1.1, 0, 0,
 *     1.1, 0, 0).
 *   - Hover zoom-in button: zoom-in icon transform matrix(1.1, 0, 0,
 *     1.1, 0, 0).
 *   - Inline transition on both icons contains 'transform'.
 *   - Pre-R352 invariants: data-topo-chrome-zoom-{out,in}-icon attrs
 *     intact, R288 strokeWidth=2.5 preserved, anet-chrome-pop class
 *     absent at rest.
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
await page.waitForSelector('[data-topo-chrome-zoom-out-icon]', { timeout: 15000 });
await page.waitForSelector('[data-topo-chrome-zoom-in-icon]',  { timeout: 5000 });
await page.waitForTimeout(300);

// Tailwind 4 compiles scale-110 to the modern CSS `scale` property
// (not legacy `transform: scale()`), so we probe both — `transform`
// stays at identity matrix and `scale` carries the 1.1 value.
const restProbe = await page.evaluate(() => {
  const oico = document.querySelector('[data-topo-chrome-zoom-out-icon]');
  const iico = document.querySelector('[data-topo-chrome-zoom-in-icon]');
  const ocs  = oico ? getComputedStyle(oico) : null;
  const ics  = iico ? getComputedStyle(iico) : null;
  return {
    outScale:      ocs?.scale ?? null,
    outTransition: ocs?.transition ?? null,
    outStrokeW:    oico?.getAttribute('stroke-width') ?? null,
    outClass:      oico?.getAttribute('class') ?? null,
    inScale:       ics?.scale ?? null,
    inTransition:  ics?.transition ?? null,
    inStrokeW:     iico?.getAttribute('stroke-width') ?? null,
    inClass:       iico?.getAttribute('class') ?? null,
  };
});

// Hover zoom-out button.
await page.hover('[data-topo-chrome-zoom-out]');
await page.waitForTimeout(300);
const zoomOutHover = await page.evaluate(() => {
  const ico = document.querySelector('[data-topo-chrome-zoom-out-icon]');
  return { scale: ico ? getComputedStyle(ico).scale : null };
});

// Hover zoom-in button.
await page.hover('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(300);
const zoomInHover = await page.evaluate(() => {
  const ico = document.querySelector('[data-topo-chrome-zoom-in-icon]');
  return { scale: ico ? getComputedStyle(ico).scale : null };
});

await browser.close();

const isRestScale = (s) => s === 'none' || s === '1' || s === '1 1' || s === null;
const isHoverScale110 = (s) => s === '1.1' || s === '1.1 1.1';
const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  rest_out_scale_1:     isRestScale(restProbe.outScale),
  rest_in_scale_1:      isRestScale(restProbe.inScale),
  out_trans_has_scale:  hasTrans(restProbe.outTransition, 'scale') || hasTrans(restProbe.outTransition, 'transform'),
  in_trans_has_scale:   hasTrans(restProbe.inTransition, 'scale')  || hasTrans(restProbe.inTransition, 'transform'),
  out_strokew_2_5:      restProbe.outStrokeW === '2.5',
  in_strokew_2_5:       restProbe.inStrokeW === '2.5',
  out_no_pop:           !/anet-chrome-pop/.test(restProbe.outClass || ''),
  in_no_pop:            !/anet-chrome-pop/.test(restProbe.inClass || ''),
  hover_out_scale_110:  isHoverScale110(zoomOutHover.scale),
  hover_in_scale_110:   isHoverScale110(zoomInHover.scale),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} zoom icons hover-scale:`, JSON.stringify(results),
  '\n  rest:           ', restProbe,
  '\n  hover zoom-out: ', zoomOutHover,
  '\n  hover zoom-in:  ', zoomInHover);
process.exit(ok ? 0 : 1);
