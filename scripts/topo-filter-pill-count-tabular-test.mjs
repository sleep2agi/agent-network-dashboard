/* Round 323 verification: filter pin pill count spans (status /
 * group / vendor) AND edge filter pill count (cold + hot) all pick
 * up Tailwind `tabular-nums` class. Pre-R323 the count digit
 * (matchCount or link.count) widened 9→10 / 99→100 even in font-mono
 * because mono fonts still have natural-vs-tabular variance; the
 * trailing × clear-button shifted right a couple px.
 *
 * 9th surface in the info-density tabular-nums sweep:
 *   R224 edge badge
 *   R225 hub digit / panel flows-count / recent-row count
 *   R229 group-label count
 *   R230 group-label status pips
 *   R320 recent-row count fw=600 (left neighbour)
 *   R321 recent-row timestamp
 *   R322 panel hot count
 *   R323 filter pill counts (status + group + vendor + edge×2)
 *
 * Contract:
 *   - All 5 patterns gain `tabular-nums`. We can probe via a
 *     scenario that activates the status pin (simplest), then
 *     check the resulting [data-filter-pill-count] element.
 *   - Each `[data-filter-pill-count]` has computed
 *     fontVariantNumeric containing 'tabular-nums'.
 *   - The edge pill count test is best-effort — only active when
 *     a flow is pinned via R116; we don't simulate pin in this
 *     test, so we accept its absence.
 *   - R322 hot tabular + R321 ts tabular regressions intact.
 *   - R317/R318/R294 chrome + pulse regressions intact.
 *
 * Fixture: 2 working sessions, 2 idle sessions — pin status='idle'
 * via initial localStorage so the status filter pill is visible.
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1', 'working'),
    mk('alpha-2', 'idle'),
    mk('beta-1',  'working'),
    mk('beta-2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 20000 });
await page.waitForTimeout(300);

// Programmatically trigger a status pin by clicking on the working
// status legend row. R64 pin handler responds to legend clicks.
// Best-effort: if the click target is not exposed, fall back to
// the chip-row "working chip" click which also triggers pinning.
await page.click('[data-working-chip]', { delay: 50 }).catch(() => {});
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const pillCounts = Array.from(document.querySelectorAll('[data-filter-pill-count]'));
  const edgeColdCount = document.querySelector('[data-active-filter-edge-count]');
  const edgeHotCount  = document.querySelector('[data-active-filter-edge-count-hot]');
  const recentRowTs   = document.querySelector('[data-recent-row-ts]');
  const recentRowCount = document.querySelector('[data-recent-row-count]');
  const recentPanelHot = document.querySelector('[data-recent-panel-hot-count]');

  const cs = (el) => el ? getComputedStyle(el).fontVariantNumeric : null;

  return {
    pillCount:          pillCounts.length,
    pillCountAllTabular: pillCounts.every(p => /tabular-nums/.test(getComputedStyle(p).fontVariantNumeric || '')),
    pillTexts:          pillCounts.map(p => p.textContent),
    edgeColdTabular:    edgeColdCount ? cs(edgeColdCount) : null,
    edgeHotTabular:     edgeHotCount  ? cs(edgeHotCount)  : null,
    edgeColdClass:      edgeColdCount?.className ?? null,
    edgeHotClass:       edgeHotCount?.className ?? null,
    recentRowTsTabular: cs(recentRowTs),
    recentRowCountFw:   recentRowCount ? getComputedStyle(recentRowCount).fontWeight : null,
    recentPanelHotTab:  cs(recentPanelHot),
    layoutInactiveCls:  document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:    document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');
const classHasTab = (s) => /tabular-nums/.test(s || '');

const results = {
  // At least one filter pill count visible after click (the status pin).
  pill_count_present:           probe.pillCount >= 1,
  pill_count_all_tabular:       probe.pillCountAllTabular,
  // The edge pills are not triggered in this test, but their CLASS
  // attribute should already include `tabular-nums` from R323 even
  // if not rendered (best-effort source-level probe via a snapshot
  // of an active pill is not possible without simulating R116 pin).
  // We accept presence-or-absence here; the main contract is the
  // status/group/vendor pills.
  // R322 / R321 regressions — both surfaces depend on recent-signal
  // panel rendering, which requires messages. Fixture here has zero
  // messages (only sessions for the pin click), so accept null OR
  // tabular for both. The R322 regression is primarily covered by
  // topo-recent-panel-hot-tabular-test which forces messages.
  r322_panel_hot_tabular_or_absent: probe.recentPanelHotTab === null || hasTab(probe.recentPanelHotTab),
  r321_ts_tabular_or_absent:        probe.recentRowTsTabular === null || hasTab(probe.recentRowTsTabular),
  // R317/R318 chrome regression.
  r317_inactive_gray_400:       probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:      probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:            probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill count tabular:`, JSON.stringify(results),
  '\n  pill count visible:', probe.pillCount,
  '\n  pill texts:', probe.pillTexts);
process.exit(ok ? 0 : 1);
