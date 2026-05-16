/* Round 385 verification: hub hover-ring strokeWidth 1.5 → 1.75.
 * Sibling visual-weight bump (11th anchor) to R367 edge-badge rest
 * stroke 1 → 1.25. The ring is only visible during hub hover
 * (opacity=0 rest), so this manifests as a thicker hover-state
 * ring on the canvas focal point.
 *
 * Contract:
 *   - [data-topo-hub-hover-ring] stroke-width attr === '1.75'.
 *   - data-topo-hub-hover-ring-stroke-width === '1.75'.
 *   - Pre-R385 invariants on the same circle:
 *     * R177 r=14 (rest) / 17 (hover)
 *     * R253 stroke = isLight ? '#059669' : '#10b981'
 *     * R370 opacity 0 (rest) / 0.8 cyber on hover
 *     * pointerEvents:none
 *   - Stays clear of R51 sentinel strokeWidth 3 (1.75 < 3).
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
await page.waitForSelector('[data-topo-hub-hover-ring]', { timeout: 15000 });
await page.waitForTimeout(300);

const restProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-hub-hover-ring]');
  return {
    strokeWidthAttr: r?.getAttribute('stroke-width') ?? null,
    strokeWidthData: r?.getAttribute('data-topo-hub-hover-ring-stroke-width') ?? null,
    rAttr:           r?.getAttribute('r') ?? null,
    opacityAttr:     r?.getAttribute('opacity') ?? null,
    strokeAttr:      r?.getAttribute('stroke') ?? null,
  };
});

// Hover hub to verify visible state.
await page.hover('[data-topo-hub]');
await page.waitForTimeout(300);
const hoverProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-hub-hover-ring]');
  return {
    strokeWidthAttr: r?.getAttribute('stroke-width') ?? null,
    rAttr:           r?.getAttribute('r') ?? null,
    opacityAttr:     r?.getAttribute('opacity') ?? null,
  };
});

await browser.close();

const results = {
  rest_stroke_width_1_75:    restProbe.strokeWidthAttr === '1.75',
  rest_data_stroke_1_75:     restProbe.strokeWidthData === '1.75',
  rest_r_14:                 restProbe.rAttr === '14',                  // R177 rest
  rest_opacity_0:            restProbe.opacityAttr === '0',
  rest_stroke_cyber:         restProbe.strokeAttr === '#10b981',        // R253 cyber
  hover_stroke_width_1_75:   hoverProbe.strokeWidthAttr === '1.75',     // strokeWidth doesn't change with hover
  hover_r_17:                hoverProbe.rAttr === '17',                 // R177 hover lift
  hover_opacity_0_8:         hoverProbe.opacityAttr === '0.8',          // R370 cyber bump
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub hover-ring strokeWidth 1.5 → 1.75:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
