/* Round 375 verification: Layout-toggle wrapper rounded-md → rounded-
 * lg (6 → 8 px). Extends the R330/R331/R332 corner-radius cascade to
 * the chrome-strip layout-toggle wrapper. Pre-R375 the wrapper at
 * rounded-md (6 px) was the only chrome-strip container still using
 * the smaller corner radius — both R330 outer wrapper and R332
 * minimap sit at ≥ 8 px; R375 brings the toggle into the rounded-lg
 * tier where minimap already lives.
 *
 * Contract:
 *   - data-topo-chrome-layout-trailer element computed border-radius
 *     === '8px' (rounded-lg).
 *   - data-topo-chrome-layout-radius === 'rounded-lg'.
 *   - Pre-R375 invariants:
 *     * border still present (1 px default Tailwind)
 *     * R268 inline borderColor + 200ms border-color transition
 *     * R329 mr-0.5 spacing preserved
 *     * inline-flex + overflow-hidden preserved
 *     * Inner buttons (Ring + Grid) still mounted as flex children
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
await page.waitForSelector('[data-topo-chrome-layout-trailer]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const w = document.querySelector('[data-topo-chrome-layout-trailer]');
  const cs = w ? getComputedStyle(w) : null;
  const ring = w?.querySelector('[data-topo-chrome-layout="ring"]');
  const grid = w?.querySelector('[data-topo-chrome-layout="grid"]');
  return {
    borderRadius:    cs?.borderRadius ?? null,
    radiusData:      w?.getAttribute('data-topo-chrome-layout-radius') ?? null,
    borderWidth:     cs?.borderWidth ?? null,
    display:         cs?.display ?? null,
    overflow:        cs?.overflow ?? null,
    transition:      cs?.transition ?? null,
    cls:             w?.getAttribute('class') ?? null,
    ringPresent:     !!ring,
    gridPresent:     !!grid,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  border_radius_8px:      probe.borderRadius === '8px',                       // rounded-lg
  data_radius_lg:         probe.radiusData === 'rounded-lg',
  border_width_1px:       probe.borderWidth === '1px',
  display_inline_flex:    probe.display === 'inline-flex' || probe.display === 'flex',
  overflow_hidden:        probe.overflow === 'hidden',
  trans_has_border_color: hasTrans(probe.transition, 'border-color'),         // R268
  cls_has_mr_0_5:         /mr-0\.5/.test(probe.cls || ''),                    // R329
  ring_button_present:    probe.ringPresent,
  grid_button_present:    probe.gridPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} Layout-toggle wrapper rounded-md → rounded-lg:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
