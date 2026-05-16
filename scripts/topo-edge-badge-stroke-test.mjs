/* Round 367 verification: edge midpoint badge rest stroke-width
 * 1 → 1.25. Sibling visual-weight bump (7th canvas anchor in the
 * R287/R295/R359/R360/R361/R365/R367 family).
 *
 * Cold edge badges gain ~25 % stroke presence. Stays clear of the
 * R51 overlap-test sentinel values (1.5 / 3 reserved for node
 * strokes — the test selector is gated to g[data-node] ancestors
 * so this edge-internal circle is invisible to that probe anyway).
 * R188 transition list 'stroke-width 300ms ease-out' still smoothes
 * the hot/pin flip — now 1.25 → 2 instead of 1 → 2.
 *
 * Contract (cyber, fixture with cold flow):
 *   - Edge badge circle stroke-width attr === '1.25'.
 *   - data-edge-badge-stroke-width-rest === '1.25'.
 *   - data-edge-badge-lifted === 'false' (rest, not hovered/pinned).
 *   - data-edge-badge-text-pin === 'false' (cold flow, link.count<10).
 *   - Inline transition contains 'stroke-width' (R188 preserved).
 *   - Pre-R367 invariants: r=9 (cold, R164), fill=pal.legendBox.fill,
 *     stroke=pal.flowEdge (cold), opacity 0.82 (cyber).
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
// 1 message → 1 cold flow (count=1, well below R129 isHot=10).
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
  // Probe the cold/rest edge badge circle (the parent of data-edge-badge-text
  // is the <g> wrapping circle + text; we want the circle sibling).
  const circle = document.querySelector('[data-edge-badge-stroke-width-rest]');
  const cs = circle ? getComputedStyle(circle) : null;
  // Find the text in the same group to check pin state.
  const grp = circle?.parentElement;
  const text = grp?.querySelector('[data-edge-badge-text]');
  return {
    strokeWidthAttr: circle?.getAttribute('stroke-width') ?? null,
    strokeWidthData: circle?.getAttribute('data-edge-badge-stroke-width-rest') ?? null,
    liftedAttr:      circle?.getAttribute('data-edge-badge-lifted') ?? null,
    rAttr:           circle?.getAttribute('r') ?? null,
    opacityAttr:     circle?.getAttribute('opacity') ?? null,
    transition:      cs?.transition ?? null,
    pinAttr:         text?.getAttribute('data-edge-badge-text-pin') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  stroke_width_1_25:    probe.strokeWidthAttr === '1.25',
  data_stroke_1_25:     probe.strokeWidthData === '1.25',
  lifted_false_rest:    probe.liftedAttr === 'false',
  r_9_cold:             probe.rAttr === '9',                   // R164 cold
  opacity_0_82_cyber:   probe.opacityAttr === '0.82',          // R251 cyber theme
  trans_has_strokew:    hasTrans(probe.transition, 'stroke-width'),  // R188
  cold_flow_not_hot:    probe.pinAttr === 'false',             // R220 isHot/isPinned both false
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge badge stroke 1 → 1.25:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
