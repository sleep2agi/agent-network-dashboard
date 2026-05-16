/* Round 371 verification: edge-badge cyber opacity 0.82 → 0.85.
 * Sibling theme-consistency polish to R370 hub hover-ring (cyber
 * 0.7 → 0.8). R251 designed the badge at 0.82 (cyber) / 0.95 (light)
 * — a 13 % delta. R371 narrows to 10 %, bringing cyber closer to
 * light theme's 0.95 floor. Light stays at 0.95.
 *
 * Contract (cyber):
 *   - Edge badge circle opacity attr === '0.85'.
 *   - data-edge-badge-opacity === '0.85'.
 *   - Pre-R371 invariants:
 *     * R164 r=9 (cold)
 *     * R367 strokeWidth=1.25 (cold rest)
 *     * R251 transition list (fill + opacity 200ms + r + stroke
 *       300ms) intact
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b') ] } });
});
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-badge-stroke-width-rest]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const circle = document.querySelector('[data-edge-badge-stroke-width-rest]');
  const cs = circle ? getComputedStyle(circle) : null;
  return {
    opacityAttr:     circle?.getAttribute('opacity') ?? null,
    opacityData:     circle?.getAttribute('data-edge-badge-opacity') ?? null,
    rAttr:           circle?.getAttribute('r') ?? null,
    strokeWidthAttr: circle?.getAttribute('stroke-width') ?? null,
    transition:      cs?.transition ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  opacity_attr_0_85:    probe.opacityAttr === '0.85',
  data_opacity_0_85:    probe.opacityData === '0.85',
  r_9_cold:             probe.rAttr === '9',                  // R164 cold
  stroke_width_1_25:    probe.strokeWidthAttr === '1.25',     // R367
  trans_has_opacity:    hasTrans(probe.transition, 'opacity'),
  trans_has_fill:       hasTrans(probe.transition, 'fill'),
  trans_has_strokew:    hasTrans(probe.transition, 'stroke-width'),
  trans_has_r:          hasTrans(probe.transition, 'r'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge cyber opacity 0.82 → 0.85:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
