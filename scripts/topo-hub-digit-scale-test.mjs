/* Round 209 verification: hub workingCount digit scales 1.0 → 1.08
 * on hub hover, matching R177's ring r 14→17 grow. Closes the
 * "hub responds to hover" gesture across both structural pieces
 * (ring + digit) instead of just the ring.
 *
 * Pre-R209 hovering the hub:
 *   ring  · r 14 → 17       (R177)
 *   digit · scale 1.0       (no change — planted at centre)
 * R209 propagates the gesture to the digit so ring + digit rise
 * together.
 *
 * Test (cyber dark, 4 working sessions):
 *   1. data-topo-hub-working-count='4' digit element present.
 *   2. Idle: data-...-hovered='false', computed transform scale 1.0.
 *   3. Transition includes 'transform 200ms ease-out'.
 *   4. transform-box: fill-box + transform-origin: center are set
 *      (the SVG transform-anchor idiom shared with R184/R186).
 *   5. Hover g[data-topo-hub] — wait past 240ms.
 *   6. data-...-hovered='true', computed transform scale ≈ 1.08
 *      (Chrome computes scale(1.08) as matrix(1.08,0,0,1.08,0,0)
 *      or similar — extract the scale factor via the matrix).
 *   7. Move away, wait — back to hovered='false' + scale 1.0.
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
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-hub-working-count]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

// Parse CSS computed transform (matrix form or none/identity) → scale x.
function extractScale(transform) {
  if (!transform || transform === 'none') return 1;
  let m = transform.match(/matrix\(\s*([\-\d.]+)/);
  if (m) return +m[1];
  m = transform.match(/scale\(\s*([\-\d.]+)/);
  if (m) return +m[1];
  return 1;
}

const probe = async () => page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-working-count]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    count:           el.getAttribute('data-topo-hub-working-count'),
    hovered:         el.getAttribute('data-topo-hub-working-count-hovered'),
    transform:       cs.transform,
    transformBox:    cs.transformBox,
    transformOrigin: cs.transformOrigin,
    transition:      el.style.transition,
  };
});

const idle = await probe();

await page.hover('g[data-topo-hub]');
await page.waitForTimeout(260);
const hovered = await probe();

await page.mouse.move(0, 0);
await page.waitForTimeout(260);
const settled = await probe();

await browser.close();

const idleScale    = extractScale(idle?.transform);
const hoverScale   = extractScale(hovered?.transform);
const settledScale = extractScale(settled?.transform);

const near = (got, want, tol = 0.03) => Math.abs(got - want) < tol;

const results = {
  digit_present:                !!idle,
  count_4:                      idle?.count === '4',
  idle_hovered_false:           idle?.hovered === 'false',
  idle_scale_1:                 near(idleScale, 1.0),
  transition_has_transform:     /transform\s+(?:200ms|0\.2s)/.test(idle?.transition || ''),
  transform_box_fill_box:       idle?.transformBox === 'fill-box',
  // With transform-box: fill-box, Chrome resolves 'center' against the
  // digit's own bbox into pixel values (e.g. '3.47826px 6.52174px' for
  // an "4" glyph) — that's the correct fill-box anchor. Accept either
  // keyword 'center' / '50%' OR resolved pixels (not '0 0' which would
  // indicate fill-box didn't resolve).
  transform_origin_anchored:    /center|50%|\d+(?:\.\d+)?px\s+\d+(?:\.\d+)?px/.test(idle?.transformOrigin || '')
                                && idle?.transformOrigin !== '0px 0px'
                                && idle?.transformOrigin !== '0 0',

  hover_hovered_true:           hovered?.hovered === 'true',
  hover_scale_1p08:             near(hoverScale, 1.08),
  hover_scale_grew:             hoverScale > idleScale + 0.02,

  settled_hovered_false:        settled?.hovered === 'false',
  settled_scale_back:           near(settledScale, 1.0),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub digit scale:`, JSON.stringify(results),
  `\n  idle:`,    idle,    `\n   idleScale:`,    idleScale,
  `\n  hovered:`, hovered, `\n   hoverScale:`,   hoverScale,
  `\n  settled:`, settled, `\n   settledScale:`, settledScale);
process.exit(ok ? 0 : 1);
