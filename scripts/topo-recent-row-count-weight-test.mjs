/* Round 320 verification: recent-signal panel per-row count tspan
 * cold-state fontWeight 400 (parent-inherited) → 600 (explicit).
 *
 * The 5-tier SVG data-weight hierarchy was completed in pieces:
 *   - R309: legend per-row count fw=600
 *   - R310: legend panel-header count fw=600
 *   - R311: recent-signal panel-header flow count fw=600
 *   - R320: recent-signal PER-ROW count fw=600 (this round)
 *
 * Pre-R320 a cold row's "· 12" digit painted at parent default (400),
 * indistinguishable from the surrounding alias text. The count IS
 * data — it should sit in the fw=600 tier alongside its siblings.
 *
 * Hot state (count ≥ 10) stays at 700 (R127). The cold→hot crossing
 * now gradates 600 → 700 in weight and amber-fill in colour — the
 * fill flip carries the dramatic visual cue while the weight tier
 * stays consistent across rows.
 *
 * Contract:
 *   - [data-recent-row-count] computed font-weight === '600' for
 *     COLD rows (count < 10)
 *   - Same selector with [data-recent-row-count-hot='true'] computed
 *     font-weight === '700' for HOT rows
 *   - R319 single-tier-drop + R317 inactive gray-400 + R318 active
 *     font-medium + R294 pulse absent all preserved.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'),
  ] } });
});
// Mock messages — the recent-signal panel counts INDIVIDUAL records
// locally (the API's `count` field on aggregated records is not
// what drives the per-row tally). Inject 4 individual cold-flow
// records + 12 hot-flow records so the panel aggregates to count=4
// and count=12 respectively.
const nowIso = new Date().toISOString();
const mkMsg = (i, from_alias, to_alias) => ({
  from_alias, to_alias, content: `m${i}`, last_at: nowIso, count: 1,
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  ...Array.from({ length: 4 },  (_, i) => mkMsg(`a${i}`, 'alpha', 'beta')),
  ...Array.from({ length: 12 }, (_, i) => mkMsg(`b${i}`, 'beta',  'gamma')),
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-row-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const counts = Array.from(document.querySelectorAll('[data-recent-row-count]'));
  return {
    rows: counts.map(c => ({
      text:    c.textContent,
      isHot:   c.getAttribute('data-recent-row-count-hot') === 'true',
      fw:      getComputedStyle(c).fontWeight,
    })),
    r317InactiveLayoutCls:
      document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    r317ActiveLayoutCls:
      document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount: document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const cold = probe.rows.filter(r => !r.isHot);
const hot  = probe.rows.filter(r => r.isHot);

const results = {
  at_least_one_cold_row:       cold.length >= 1,
  at_least_one_hot_row:        hot.length >= 1,
  all_cold_fw_600:             cold.every(r => String(r.fw) === '600'),
  all_hot_fw_700:              hot.every(r => String(r.fw) === '700'),
  // R319 regression: single-tier behaviour on group pips. Not directly
  // probed here; topo-group-pip-singletier-drop-test.mjs covers that.
  // R317 / R318 regression — layout toggle styling. Default layout
  // is 'ring' (active). Grid is inactive and carries gray-400 (R317).
  // Active ring carries cyan-300 + font-medium (R318).
  r317_inactive_gray_400:      probe.r317InactiveLayoutCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.r317ActiveLayoutCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row count weight:`, JSON.stringify(results),
  '\n  cold rows:', cold,
  '\n  hot rows:', hot);
process.exit(ok ? 0 : 1);
