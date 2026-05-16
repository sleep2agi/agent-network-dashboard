/* Round 366 verification: group label member-count tspan fontWeight
 * 400 → 500. Sibling polish to R363 recent-row alias text fw 400 →
 * 500 + R364 legend-row label fw 400 → 500. Closes the per-row
 * 'count is fw 500 against label-tier fw 700' pattern at the
 * group-label scope (grid layout cluster mark).
 *
 * Hierarchy snapshot post-R366 across 3 row surfaces:
 *   recent  count(hot/cold)  fw 700/600  (R320)
 *   recent  alias            fw 500      (R363)
 *   legend  count            fw 600      (R309)
 *   legend  label            fw 500      (R364)
 *   group   name             fw 700      (legacy)
 *   group   count            fw 500      (R366, this round)
 *
 * Contract (cyber, grid layout — group label only appears in grid):
 *   - Each rendered [data-group-label-count] tspan has
 *     font-weight === '500'.
 *   - data-group-label-count-font-weight === '500'.
 *   - Pre-R366 invariants:
 *     * dx="6" + fontSize="11" + tabular-nums
 *     * R229 fill-inherit (no explicit fill on tspan)
 *     * data-group-label-count-value still surfaces the count
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // Pre-select grid layout (R106 cluster algorithm + group labels).
    localStorage.setItem('anet-layout', JSON.stringify('grid'));
  } catch {}
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
  // Multiple alpha/beta nodes → cluster groups render with member counts.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1'), mk('alpha-2'), mk('alpha-3'),
    mk('beta-1'),  mk('beta-2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// In case grid layout didn't take from localStorage, click the grid toggle.
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 15000 });
const layoutActive = await page.getAttribute('[data-topo-chrome-layout="grid"]', 'data-topo-chrome-layout-active');
if (layoutActive !== 'true') {
  await page.click('[data-topo-chrome-layout="grid"]');
}
await page.waitForSelector('[data-group-label-count]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const tspans = Array.from(document.querySelectorAll('[data-group-label-count]'));
  return tspans.map(el => {
    const cs = getComputedStyle(el);
    return {
      key:            el.getAttribute('data-group-label-count'),
      fontWeightAttr: el.getAttribute('font-weight'),
      fontWeightData: el.getAttribute('data-group-label-count-font-weight'),
      fontSizeAttr:   el.getAttribute('font-size'),
      countValue:     el.getAttribute('data-group-label-count-value'),
      fontVariant:    cs.fontVariantNumeric,
      explicitFill:   el.getAttribute('fill'),  // R229: should be null (inherit)
    };
  });
});

await browser.close();

const allOk = probe.length > 0 && probe.every(r =>
  r.fontWeightAttr === '500'
  && r.fontWeightData === '500'
  && r.fontSizeAttr === '11'
  && /tabular-nums/.test(r.fontVariant || '')
  && (r.countValue || '').length > 0
  && r.explicitFill === null     // R229 fill-inherit invariant
);

const results = {
  rows_rendered:        probe.length >= 1,
  all_rows_fw_500:      probe.every(r => r.fontWeightAttr === '500'),
  all_rows_data_500:    probe.every(r => r.fontWeightData === '500'),
  all_rows_fontsize_11: probe.every(r => r.fontSizeAttr === '11'),
  all_rows_tabular:     probe.every(r => /tabular-nums/.test(r.fontVariant || '')),
  all_rows_have_count:  probe.every(r => (r.countValue || '').length > 0),
  all_rows_fill_inherit: probe.every(r => r.explicitFill === null),
};
const ok = allOk && Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-label count fw 400 → 500:`, JSON.stringify(results),
  '\n  rows:', probe.map(r => ({ key: r.key, fw: r.fontWeightAttr, count: r.countValue })));
process.exit(ok ? 0 : 1);
