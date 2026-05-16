/* Round 347 verification: zoom-level readout in the chrome strip
 * gains a hover-state letter-spacing tween 0 → 0.5 px. Extends the
 * R344/R345 hover-letter-spacing family from panel/footer surfaces
 * into the HTML chrome strip. The readout is sandwiched between
 * zoom-out / zoom-in buttons; hovering it spreads digits 0.5 px,
 * signalling "this is alive". tabular-nums + minWidth: 46 from R225
 * lock the column so the tween doesn't shove neighbouring controls.
 *
 * Contract:
 *   - Rest: zoom-level letter-spacing 0 (or 'normal' / '0px').
 *   - Hover: letter-spacing 0.5px.
 *   - data-topo-chrome-zoom-level-hover toggles false → true.
 *   - transition list contains 'letter-spacing'.
 *   - Pre-R347 invariants intact: R264 color + border-color transitions
 *     preserved; tabular-nums + minWidth=46 still applied.
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
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 15000 });
await page.waitForTimeout(400);

const restProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  const cs = el ? getComputedStyle(el) : null;
  return {
    ls:           cs?.letterSpacing ?? null,
    transition:   cs?.transition ?? null,
    hoverAttr:    el?.getAttribute('data-topo-chrome-zoom-level-hover') ?? null,
    minWidth:     cs?.minWidth ?? null,
    fontVariant:  cs?.fontVariantNumeric ?? null,
  };
});

await page.hover('[data-topo-chrome-zoom-level]');
await page.waitForTimeout(250);
const hoverProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  const cs = el ? getComputedStyle(el) : null;
  return {
    ls:        cs?.letterSpacing ?? null,
    hoverAttr: el?.getAttribute('data-topo-chrome-zoom-level-hover') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');
const isRestLs = (v) => v === 'normal' || v === '0px' || v === '0' || v === null;

const results = {
  rest_ls_zero:           isRestLs(restProbe.ls),
  rest_hover_attr_false:  restProbe.hoverAttr === 'false',
  trans_has_letterspacing: hasTrans(restProbe.transition, 'letter-spacing'),
  trans_has_color:        hasTrans(restProbe.transition, 'color'),     // R264 preserved
  trans_has_border:       hasTrans(restProbe.transition, 'border-color'),
  min_width_46:           restProbe.minWidth === '46px',
  tabular_nums:           /tabular-nums/.test(restProbe.fontVariant || ''),
  hover_ls_0_5:           hoverProbe.ls === '0.5px',
  hover_attr_true:        hoverProbe.hoverAttr === 'true',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} zoom level hover letter-spacing:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
