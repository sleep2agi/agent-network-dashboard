/* Round 321 verification: recent-signal row freshness timestamp
 * (lastAt) picks up fontVariantNumeric: 'tabular-nums'.
 *
 * The right-aligned (textAnchor="end") timestamp ticks through
 * 1s..59s / 1m..59m / 1h..24h every panel tick. Pre-R321 a 9s→10s
 * or 59s→1m crossing slid the chip ~3px in monospace because the
 * digit '1' has a narrower natural width than '0' / '5' / etc even
 * in mono fonts. Tabular-nums locks the slot.
 *
 * 7th surface in the info-density tabular-nums sweep:
 *   R224 edge badge / R225 hub digit / R225 panel header /
 *   R225 recent-row count / R229 group-label count /
 *   R230 group-label status pips / R321 recent-row timestamp.
 *
 * Contract:
 *   - [data-recent-row-ts] computed style fontVariantNumeric
 *     contains 'tabular-nums'.
 *   - R320 cold-row count still fw=600 + hot-row count fw=700
 *     (regression).
 *   - R319 single-tier-drop, R317 inactive gray-400, R318 active
 *     font-medium, R294 pulse absent all preserved.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
// Match the shape topo-recent-row-ts-alpha-test uses — individual
// message records with created_at (the panel derives link.last_at
// from these). Network_id default matches the sessions' fixture.
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
await page.waitForSelector('[data-recent-row-ts]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const tsels = Array.from(document.querySelectorAll('[data-recent-row-ts]'));
  const counts = Array.from(document.querySelectorAll('[data-recent-row-count]'));
  return {
    tsTabular:    tsels.map(t => getComputedStyle(t).fontVariantNumeric),
    tsTexts:      tsels.map(t => t.textContent),
    countRows:    counts.map(c => ({
      text:  c.textContent,
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
  ts_at_least_one:           probe.tsTabular.length >= 1,
  ts_all_tabular_nums:       probe.tsTabular.every(hasTab),
  // R320 regression — count weight tier.
  r320_at_least_one_cold:    cold.length >= 1,
  r320_at_least_one_hot:     hot.length >= 1,
  r320_cold_fw_600:          cold.every(r => String(r.fw) === '600'),
  r320_hot_fw_700:           hot.every(r => String(r.fw) === '700'),
  // R317/R318 chrome regression.
  r317_inactive_gray_400:    probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:   probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:         probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row ts tabular:`, JSON.stringify(results),
  '\n  ts texts:', probe.tsTexts,
  '\n  ts tabular:', probe.tsTabular);
process.exit(ok ? 0 : 1);
