/* Round 402 verification: legend pin-ring strokeWidth 1.5 → 1.75.
 * Sibling visual-weight bump (12th anchor) to R385 hub hover-ring
 * — both are stroke-only pin/hover indicators painted as r=8 / r=14
 * circles outside their target. R51 sentinel concern: 1.5 reserved
 * for offline-node detection, but selector gated to g[data-node]
 * ancestors so this legend-internal circle is invisible to probe.
 *
 * Contract:
 *   - data-legend-pin-ring-stroke-width === '1.75' (idle state too,
 *     since the attr surfaces the resolved value regardless of pin)
 *   - <circle> stroke-width attr === '1.75'
 *   - Pre-R402 invariants preserved:
 *     * r='8', fill='none', cx='16'
 *     * opacity reflects isPinned state (0 idle, 1 pinned)
 *     * data-legend-pin-ring-pinned attr present
 *   - Idle ring: opacity='0' (R181 always-mount + transition)
 *   - Pinned ring (after click): opacity='1'
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-legend-pin-ring]', { timeout: 15000 });
await page.waitForTimeout(400);

const restProbe = await page.evaluate(() => {
  const ring = document.querySelector('[data-legend-pin-ring]');
  return ring ? {
    strokeWidthAttr: ring.getAttribute('stroke-width'),
    strokeWidthData: ring.getAttribute('data-legend-pin-ring-stroke-width'),
    rAttr:           ring.getAttribute('r'),
    fillAttr:        ring.getAttribute('fill'),
    cxAttr:          ring.getAttribute('cx'),
    opacityAttr:     ring.getAttribute('opacity'),
    pinned:          ring.getAttribute('data-legend-pin-ring-pinned'),
  } : null;
});

// Click a legend row to pin it
await page.click('[data-legend-status="working"]');
await page.waitForTimeout(300);

const pinnedProbe = await page.evaluate(() => {
  const rings = Array.from(document.querySelectorAll('[data-legend-pin-ring]'));
  const pinned = rings.find((r) => r.getAttribute('data-legend-pin-ring-pinned') === 'true');
  return pinned ? {
    strokeWidthAttr: pinned.getAttribute('stroke-width'),
    opacityAttr:     pinned.getAttribute('opacity'),
    rAttr:           pinned.getAttribute('r'),
  } : null;
});

await browser.close();

const results = {
  // R402 wire: stroke-width attr + data both 1.75
  rest_strokeWidth_1_75:  restProbe?.strokeWidthAttr === '1.75',
  rest_data_1_75:         restProbe?.strokeWidthData === '1.75',
  // Pre-R402 invariants (R181 + base geometry)
  rest_r_8:               restProbe?.rAttr === '8',
  rest_fill_none:         restProbe?.fillAttr === 'none',
  rest_cx_16:             restProbe?.cxAttr === '16',
  rest_opacity_0:         restProbe?.opacityAttr === '0',           // R181 idle invariant
  rest_pinned_false:      restProbe?.pinned === 'false',
  // Pinned state preserves the bumped stroke
  pinned_strokeWidth_1_75: pinnedProbe?.strokeWidthAttr === '1.75',
  pinned_opacity_1:       pinnedProbe?.opacityAttr === '1',         // R181 pinned alpha
  pinned_r_8:             pinnedProbe?.rAttr === '8',               // geometry preserved
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend pin-ring strokeWidth 1.5 → 1.75:`, JSON.stringify(results),
  '\n  rest:   ', restProbe,
  '\n  pinned: ', pinnedProbe);
process.exit(ok ? 0 : 1);
