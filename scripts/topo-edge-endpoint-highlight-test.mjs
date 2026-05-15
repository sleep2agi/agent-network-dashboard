/* Round 49 verification: hovering a flow edge highlights its two endpoint
 * nodes and dims the rest — the reverse direction of R40 (node→edges) so
 * "who is this edge between" reads at a glance without the tooltip.
 *
 * Sessions: alpha, beta, gamma, delta. Messages: alpha→beta + gamma→delta.
 * - Before hover: all 4 nodes at base opacity (~1.0).
 * - Hover alpha→beta hitbox: alpha + beta opacity ≥ 0.6, gamma + delta
 *   drop below 0.4 (composed via `hoveredEdgeEndpoints`).
 * - Move off the edge: opacities return to base.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

// The dashboard chrome (sidebar + header + stats row) pushes the topology
// SVG well below the fold at width 1280. Height 1500 fits the whole canvas
// so SVG-local coordinates map to in-viewport screen coordinates.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    // Ring layout places nodes around the SVG center and edges curve through
    // it — well inside the 1280x900 viewport. Grid layout pushes the lower-
    // row edges below the fold and breaks locator.hover positioning.
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['alpha', 'beta', 'gamma', 'delta'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
const now = new Date().toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { from_alias: 'alpha', to_alias: 'beta',  content: 'm', created_at: now },
  { from_alias: 'gamma', to_alias: 'delta', content: 'm', created_at: now },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(600);

const opacities = () => page.evaluate(() => {
  const out = {};
  for (const a of ['alpha', 'beta', 'gamma', 'delta']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    out[a] = g ? +(g.style.opacity || '1') : null;
  }
  return out;
});

const before = await opacities();

// Hover the alpha→beta edge hitbox. The hitbox is a curved <path> with
// `pointer-events: stroke`, so the cursor only triggers events when it
// sits on the stroke itself — the bbox centroid is inside an empty region.
// Sample a real point at half the path's length via getPointAtLength and
// convert SVG-local coordinates to screen via getScreenCTM, then move the
// physical mouse there.
const target = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  for (const g of svg.querySelectorAll(':scope > g > g')) {
    const t = g.querySelector('path[data-edge-hitbox] title');
    if (t && /^alpha → beta/.test(t.textContent || '')) {
      const hb = g.querySelector('path[data-edge-hitbox]');
      const pt = hb.getPointAtLength(hb.getTotalLength() / 2);
      const ctm = hb.getScreenCTM();
      return { x: pt.x * ctm.a + pt.y * ctm.c + ctm.e, y: pt.x * ctm.b + pt.y * ctm.d + ctm.f };
    }
  }
  return null;
});
if (!target) { console.log('❌ no alpha→beta hitbox found'); process.exit(1); }
console.log('  hover target:', target);
// Move twice — first to an empty spot, then to the curve point — so the
// browser registers a pointermove from "elsewhere" to the hitbox stroke.
await page.mouse.move(10, 10);
await page.mouse.move(target.x, target.y);
await page.waitForTimeout(350);
const during = await opacities();

// Move far away — over an empty corner — so no node/edge is hovered.
await page.mouse.move(20, 20);
await page.waitForTimeout(250);
const after = await opacities();

await browser.close();
const baseOk = (o) => o >= 0.55;   // online nodes at base ~1.0; allow 0.6 floor
const dimOk  = (o) => o !== null && o < 0.4;
const results = {
  beforeBaseAll: baseOk(before.alpha) && baseOk(before.beta) && baseOk(before.gamma) && baseOk(before.delta),
  hoverKeepsEndpoints: baseOk(during.alpha) && baseOk(during.beta),
  hoverDimsNonEndpoints: dimOk(during.gamma) && dimOk(during.delta),
  releaseRestoresAll: baseOk(after.alpha) && baseOk(after.beta) && baseOk(after.gamma) && baseOk(after.delta),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-endpoint highlight:`, JSON.stringify(results),
  `\n  before=`, before, `\n  during=`, during, `\n  after=`, after);
process.exit(ok ? 0 : 1);
