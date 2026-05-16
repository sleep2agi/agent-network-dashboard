/* Round 274 verification: legend per-row count text gains tabular-nums.
 *
 * Pre-R274 the legend per-row count at x=215 used fontFamily="monospace"
 * (typically tabular by nature) but NO explicit fontVariantNumeric:
 * 'tabular-nums'. The recent-signal panel header flow-count (R225)
 * AND the group-label pip strip (R230) both explicitly set tabular-
 * nums for digit-width stability across 9→10 / 99→100 thresholds.
 *
 * R274 closes the consistency gap: legend per-row counts now also
 * carry fontVariantNumeric: 'tabular-nums'. Belt-and-suspenders for
 * monospace fonts where some implementations have subtle digit-pair
 * variance.
 *
 * Test scope:
 *   1. Working row count text has computed fontVariantNumeric ===
 *      'tabular-nums'.
 *   2. Idle row count text same.
 *   3. Offline row count text same.
 *   4. R273 Layout toggle Grid inactive has hover:text-cyan-300
 *      (regression).
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
  const mk = (alias, status = 'working') => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Mix of statuses so all 3 legend row counts have non-zero values
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'), mk('beta', 'idle'),
    mk('gamma', 'idle'),    mk('delta', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-legend-count="working"]', { timeout: 10000 });
await page.waitForSelector('[data-legend-count="idle"]',    { timeout: 10000 });
await page.waitForSelector('[data-legend-count="offline"]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const working = document.querySelector('[data-legend-count="working"]');
  const idle    = document.querySelector('[data-legend-count="idle"]');
  const offline = document.querySelector('[data-legend-count="offline"]');
  const grid    = document.querySelector('[data-topo-chrome-layout="grid"]');
  return {
    workingFVN: working ? window.getComputedStyle(working).fontVariantNumeric : null,
    idleFVN:    idle    ? window.getComputedStyle(idle).fontVariantNumeric    : null,
    offlineFVN: offline ? window.getComputedStyle(offline).fontVariantNumeric : null,
    gridClasses: grid    ? grid.className.toString() : null,
  };
});
await browser.close();

const isTabular = (v) => v != null && v.includes('tabular-nums');

const results = {
  working_count_tabular:        isTabular(probe.workingFVN),
  idle_count_tabular:           isTabular(probe.idleFVN),
  offline_count_tabular:        isTabular(probe.offlineFVN),
  r273_grid_has_cyan_hover_text: (probe.gridClasses || '').includes('hover:text-cyan-300'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend count tabular-nums:`, JSON.stringify(results),
  '\n  working FVN:', probe.workingFVN,
  '\n  idle FVN:   ', probe.idleFVN,
  '\n  offline FVN:', probe.offlineFVN);
process.exit(ok ? 0 : 1);
