/* Round 388 verification: hover-detail panel body lines fw 400 → 500.
 * Small-text fw lift family (6th anchor) after R363 recent-row
 * alias, R364 legend-row label, R366 group-label count tspan, R368
 * +N footer, R373 pressure-bar kicker. Lifts the three fontSize=9
 * body lines (runtime, host, task) in the on-hover product card to
 * font-weight=500 so they read consistently bolder against the
 * cyber-theme backdrop.
 *
 * Contract:
 *   - On hover, the hover-detail card mounts and:
 *     * Each fontSize=9 body line has font-weight attr === '500'
 *     * Each carries data-topo-hover-detail-body-fw === '500'
 *     * Tier structure preserved:
 *       - y=16 vendor headline at fw=700 unchanged
 *       - y=32 model subhead has no fw attr (preserved)
 *   - Task line keeps opacity 0.7 (R388 doesn't touch it)
 *   - The 3 body lines render at fontSize=9 (R388 doesn't touch size)
 *
 * Fixture: 2 idle sessions so hover-detail mounts cleanly without
 * the dense-layout >16-node gate. Computed font-weight is asserted
 * to be '500' as the browser-canonical resolution of the SVG attr.
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(300);
await page.hover('g[data-node]');
await page.waitForSelector('[data-topo-hover-detail]', { timeout: 5000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const card = document.querySelector('[data-topo-hover-detail]');
  if (!card) return null;
  const texts = Array.from(card.querySelectorAll('text'));
  const lines = texts.map((t) => ({
    y:           t.getAttribute('y'),
    fontSize:    t.getAttribute('font-size'),
    fwAttr:      t.getAttribute('font-weight'),
    fwData:      t.getAttribute('data-topo-hover-detail-body-fw'),
    fwComputed:  getComputedStyle(t).fontWeight,
    opacityAttr: t.getAttribute('opacity'),
  }));
  return { lines };
});

await browser.close();

const byY = Object.fromEntries((probe?.lines || []).map((l) => [l.y, l]));

const results = {
  // y=16 vendor headline unchanged at fw=700
  vendor_y16_fw700:           byY['16']?.fwAttr === '700',
  // y=32 model subhead — no R388 attrs (size 10 differentiation)
  model_y32_size_10:          byY['32']?.fontSize === '10',
  model_y32_no_body_fw_attr:  byY['32']?.fwData === null || byY['32']?.fwData === undefined,
  // y=48 runtime body — R388 lifts to fw=500
  runtime_y48_size_9:         byY['48']?.fontSize === '9',
  runtime_y48_fw500:          byY['48']?.fwAttr === '500',
  runtime_y48_data_500:       byY['48']?.fwData === '500',
  runtime_y48_computed_500:   byY['48']?.fwComputed === '500',
  // y=64 host body — R388 lifts to fw=500
  host_y64_size_9:            byY['64']?.fontSize === '9',
  host_y64_fw500:             byY['64']?.fwAttr === '500',
  host_y64_data_500:          byY['64']?.fwData === '500',
  host_y64_computed_500:      byY['64']?.fwComputed === '500',
  // y=80 task body — R388 lifts to fw=500, opacity 0.7 preserved
  task_y80_size_9:            byY['80']?.fontSize === '9',
  task_y80_fw500:             byY['80']?.fwAttr === '500',
  task_y80_data_500:          byY['80']?.fwData === '500',
  task_y80_opacity_07:        byY['80']?.opacityAttr === '0.7',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hover-detail body lines fw 400 → 500:`, JSON.stringify(results),
  '\n  lines:', JSON.stringify(probe?.lines, null, 2));
process.exit(ok ? 0 : 1);
