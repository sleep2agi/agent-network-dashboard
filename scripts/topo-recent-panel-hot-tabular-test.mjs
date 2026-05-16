/* Round 322 verification: recent-signal panel hot-count tspan picks
 * up fontVariantNumeric: 'tabular-nums'. Sibling parity with R311's
 * `{flowLinks.length} flows` tspan which has been tabular since R225.
 *
 * Pre-R322 a hotFlowCount crossing 1→10 widened the leading digit
 * and (parent <text> is textAnchor='end') shifted the whole header
 * left a few pixels against the panel rect's left edge — visible
 * micro-jitter every time a new flow crossed the hot threshold.
 *
 * 8th surface in the tabular-nums sweep — completes the recent-
 * signal header (both the flows count AND the hot count lock).
 *
 * Contract:
 *   - [data-recent-panel-hot-count] is present and visible (hot
 *     count > 0 fixture).
 *   - Its computed fontVariantNumeric === 'tabular-nums'.
 *   - R321 timestamp regression: [data-recent-row-ts] still tabular.
 *   - R320 count weight regression: cold fw=600, hot fw=700.
 *   - R317 inactive gray-400, R318 active font-medium, R294 pulse absent.
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
const now = Date.now();
const mkMsg = (i, from_alias, to_alias, secAgo) => ({
  id: `${from_alias}-${to_alias}-${i}`,
  from_alias, to_alias, content: `m${i}`,
  network_id: 'default',
  created_at: new Date(now - secAgo * 1000).toISOString(),
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  ...Array.from({ length: 4 },  (_, i) => mkMsg(`a${i}`, 'alpha', 'beta',  5 + i)),
  ...Array.from({ length: 12 }, (_, i) => mkMsg(`b${i}`, 'beta',  'gamma', 5 + i)),
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-hot-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const hot   = document.querySelector('[data-recent-panel-hot-count]');
  const flows = document.querySelector('[data-recent-panel-count]');
  const tsels = Array.from(document.querySelectorAll('[data-recent-row-ts]'));
  const counts = Array.from(document.querySelectorAll('[data-recent-row-count]'));
  return {
    hotTabular:    hot ? getComputedStyle(hot).fontVariantNumeric : null,
    hotText:       hot?.textContent ?? null,
    hotVisible:    hot?.getAttribute('data-recent-panel-hot-visible') ?? null,
    flowsTabular:  flows ? getComputedStyle(flows).fontVariantNumeric : null,
    tsTabular:     tsels.map(t => getComputedStyle(t).fontVariantNumeric),
    countRows:     counts.map(c => ({
      isHot: c.getAttribute('data-recent-row-count-hot') === 'true',
      fw:    getComputedStyle(c).fontWeight,
    })),
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const cold = probe.countRows.filter(r => !r.isHot);
const hot  = probe.countRows.filter(r => r.isHot);
const hasTab = (s) => /tabular-nums/.test(s || '');

const results = {
  hot_count_present:           probe.hotText !== null,
  hot_count_visible:           probe.hotVisible === 'true',
  hot_count_tabular:           hasTab(probe.hotTabular),
  // R311 sibling regression — flows count is also tabular.
  flows_count_tabular:         hasTab(probe.flowsTabular),
  // R321 regression: ts elements tabular.
  r321_ts_all_tabular:         probe.tsTabular.length >= 1 && probe.tsTabular.every(hasTab),
  // R320 regression: count weight tier.
  r320_cold_fw_600:            cold.every(r => String(r.fw) === '600'),
  r320_hot_fw_700:             hot.every(r => String(r.fw) === '700'),
  // R317 / R318 regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-panel hot tabular:`, JSON.stringify(results),
  '\n  hot text:', JSON.stringify(probe.hotText),
  '\n  hot tabular:', probe.hotTabular,
  '\n  flows tabular:', probe.flowsTabular);
process.exit(ok ? 0 : 1);
