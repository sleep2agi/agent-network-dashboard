/* Round 355 verification: filter pin pills (status / group / vendor)
 * gain pure-CSS group-hover lift of their inner opacity-70 spans
 * (prefix `filter:` + count `· N`) to 100 % on pill hover. Marks the
 * whole pill as scan-it interactive without layout reflow (opacity
 * is paint-only). The R335 prefix-opacity tier + R323 count-opacity
 * tier are preserved at rest; both ease to 100 % on pill hover.
 *
 * Contract (cyber, status filter pinned to 'working'):
 *   - Rest: filter-prefix + filter-pill-count computed opacity 0.7.
 *   - Hover pill: both spans computed opacity 1.
 *   - Inline transition contains 'opacity'.
 *   - Pre-R355 invariants:
 *     * R335 prefix span keeps `hidden sm:inline opacity-70` baseline
 *     * R323 count span keeps `opacity-70 tabular-nums` baseline
 *     * Pill click-to-clear unchanged (still has onClick / cursor)
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
    // Pre-pin status='working' so the filter pill mounts on first paint.
    localStorage.setItem('anet-pinnedStatus', JSON.stringify('working'));
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// If pre-pin via localStorage didn't take, click the working chip to pin.
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
const pillVisible = await page.locator('[data-active-filter="status"]').count();
if (pillVisible === 0) {
  await page.click('[data-working-chip]');
  await page.waitForSelector('[data-active-filter="status"]', { timeout: 5000 });
}
await page.waitForTimeout(300);

const restProbe = await page.evaluate(() => {
  const pill = document.querySelector('[data-active-filter="status"]');
  const prefix = pill?.querySelector('[data-filter-prefix]');
  const count  = pill?.querySelector('[data-filter-pill-count]');
  return {
    prefixOpacity:  prefix ? getComputedStyle(prefix).opacity : null,
    countOpacity:   count  ? getComputedStyle(count).opacity  : null,
    prefixTrans:    prefix ? getComputedStyle(prefix).transition : null,
    countTrans:     count  ? getComputedStyle(count).transition  : null,
    prefixCls:      prefix?.getAttribute('class') ?? null,
    countCls:       count?.getAttribute('class')  ?? null,
    pillCursor:     pill ? getComputedStyle(pill).cursor : null,
  };
});

// Hover the pill.
await page.hover('[data-active-filter="status"]');
await page.waitForTimeout(300);
const hoverProbe = await page.evaluate(() => {
  const pill = document.querySelector('[data-active-filter="status"]');
  const prefix = pill?.querySelector('[data-filter-prefix]');
  const count  = pill?.querySelector('[data-filter-pill-count]');
  return {
    prefixOpacity: prefix ? getComputedStyle(prefix).opacity : null,
    countOpacity:  count  ? getComputedStyle(count).opacity  : null,
  };
});

await browser.close();

const approxEq = (a, b, tol = 0.02) => {
  const x = parseFloat(a); const y = parseFloat(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;
};
const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  rest_prefix_0_7:        approxEq(restProbe.prefixOpacity, 0.7),
  rest_count_0_7:         approxEq(restProbe.countOpacity,  0.7),
  prefix_trans_has_op:    hasTrans(restProbe.prefixTrans, 'opacity'),
  count_trans_has_op:     hasTrans(restProbe.countTrans,  'opacity'),
  prefix_cls_has_op_70:   /opacity-70/.test(restProbe.prefixCls || ''),  // R335
  count_cls_has_tabular:  /tabular-nums/.test(restProbe.countCls || ''), // R323
  pill_cursor_pointer:    restProbe.pillCursor === 'pointer',
  hover_prefix_1:         approxEq(hoverProbe.prefixOpacity, 1),
  hover_count_1:          approxEq(hoverProbe.countOpacity,  1),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill hover-opacity lift:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
