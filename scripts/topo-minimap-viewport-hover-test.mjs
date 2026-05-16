/* Round 346 verification: minimap viewport rect gains a hover-state
 * affordance — strokeWidth 1.5 → 1.75 + opacity 0.9 → 1.0 when the
 * user enters the minimap container. The minimap is a recenter click-
 * target (role=button at line ~7810), but pre-R346 the only hover hint
 * was `cursor: crosshair`. R346 lifts the viewport rect to mark "this
 * is the recenter target and it's alive". Sibling polish to R332
 * minimap rounded-md → rounded-lg corner family — that round refined
 * geometry, this one gives the viewport indicator inside the geometry
 * a hover state.
 *
 * Contract:
 *   - Rest: viewport rect stroke-width=1.5, opacity=0.9.
 *   - Hover container: stroke-width=1.75, opacity=1.
 *   - Inline transition list contains 'stroke-width' AND 'opacity'.
 *   - data-topo-minimap-hovered toggles 'false' → 'true' on enter.
 *   - data-topo-minimap-viewport-hover mirrors hover state on the rect.
 *   - Pre-R346 invariants intact: rect still data-topo-minimap-viewport,
 *     R287 stroke=1.5 rest value, R199 smoothView transition list
 *     extended (not replaced).
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
    mk('alpha-1'), mk('alpha-2'), mk('alpha-3'),
    mk('beta-1'),  mk('beta-2'),  mk('beta-3'),
    mk('gamma-1'), mk('gamma-2'), mk('gamma-3'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// Minimap only mounts when view is non-default (zoom !== 1 or pan).
// Click zoom-in to trigger mount.
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 15000 });
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(200);
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-viewport]', { timeout: 5000 });
await page.waitForTimeout(400);

// Rest probe.
const restProbe = await page.evaluate(() => {
  const rect = document.querySelector('[data-topo-minimap-viewport]');
  const container = document.querySelector('[data-topo-minimap]');
  return {
    strokeWidth:    rect?.getAttribute('stroke-width') ?? null,
    opacity:        rect?.getAttribute('opacity') ?? null,
    transition:     rect ? getComputedStyle(rect).transition : null,
    rectHoverAttr:  rect?.getAttribute('data-topo-minimap-viewport-hover') ?? null,
    contHoverAttr:  container?.getAttribute('data-topo-minimap-hovered') ?? null,
  };
});

// Hover the minimap container.
await page.hover('[data-topo-minimap]');
await page.waitForTimeout(250);
const hoverProbe = await page.evaluate(() => {
  const rect = document.querySelector('[data-topo-minimap-viewport]');
  const container = document.querySelector('[data-topo-minimap]');
  return {
    strokeWidth:    rect?.getAttribute('stroke-width') ?? null,
    opacity:        rect?.getAttribute('opacity') ?? null,
    rectHoverAttr:  rect?.getAttribute('data-topo-minimap-viewport-hover') ?? null,
    contHoverAttr:  container?.getAttribute('data-topo-minimap-hovered') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  rest_sw_1_5:         restProbe.strokeWidth === '1.5',
  rest_op_0_9:         restProbe.opacity === '0.9',
  rest_cont_false:     restProbe.contHoverAttr === 'false',
  rest_rect_false:     restProbe.rectHoverAttr === 'false',
  trans_has_strokew:   hasTrans(restProbe.transition, 'stroke-width'),
  trans_has_opacity:   hasTrans(restProbe.transition, 'opacity'),
  hover_sw_1_75:       hoverProbe.strokeWidth === '1.75',
  hover_op_1:          hoverProbe.opacity === '1',
  hover_cont_true:     hoverProbe.contHoverAttr === 'true',
  hover_rect_true:     hoverProbe.rectHoverAttr === 'true',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap viewport hover affordance:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
