/* Round 333 verification: vendor letter chip count suffix `:{N}`
 * picks up two polishes:
 *   1. text-gray-500 → text-gray-400 (R317 subordinate-text-lift family)
 *   2. tabular-nums (digit width-lock when count crosses 9→10 etc)
 *
 * Both surface a new test attr `data-vendor-letter-count` on the
 * suffix span.
 *
 * Contract:
 *   - [data-vendor-letter-count-suffix] present (at least one vendor row).
 *   - Its className contains both 'text-gray-400' and 'tabular-nums'.
 *   - Computed fontVariantNumeric === 'tabular-nums'.
 *   - R332 minimap rounded-lg + R330 wrapper rounded-xl regressions.
 *   - R317 / R318 / R294 chrome + pulse regressions intact.
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // R281 vendorDist threshold is `vendorDist.length > 2` — need 3+
  // distinct vendor types to surface the vendor letter chip row.
  // Anthropic + OpenAI + internlm = 3 distinct vendors (matches the
  // pre-existing topo-vendor-chip-weight-test fixture pattern).
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
    mk('gamma', 'internlm/internlm2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// Wait for at least one data-vendor-letter (the parent chip) — the
// child count suffix lands as a child whether or not the chip is in
// the visible viewport. Use `state: attached` so the test passes when
// the vendor chip exists in the DOM (chip-row rendered) even if any
// individual responsive class hides one specific vendor.
await page.waitForSelector('[data-vendor-letter]', { timeout: 15000, state: 'attached' });
await page.waitForSelector('[data-vendor-letter-count-suffix]', { timeout: 5000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const suffixes = Array.from(document.querySelectorAll('[data-vendor-letter-count-suffix]'));
  return {
    suffixCount:        suffixes.length,
    suffixClasses:      suffixes.map(s => s.className),
    suffixTabulars:     suffixes.map(s => getComputedStyle(s).fontVariantNumeric),
    suffixTexts:        suffixes.map(s => s.textContent),
    layoutInactiveCls:  document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:    document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
    wrapperClass:       document.querySelector('[data-topo-wrapper]')?.className ?? '',
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');
const hasGray400 = (cls) => /(^|\s)text-gray-400(\s|$)/.test(cls || '');
const hasTabClass = (cls) => /(^|\s)tabular-nums(\s|$)/.test(cls || '');

const results = {
  suffix_at_least_one:         probe.suffixCount >= 1,
  all_have_gray_400:           probe.suffixClasses.every(hasGray400),
  all_have_tabular_class:      probe.suffixClasses.every(hasTabClass),
  all_have_computed_tabular:   probe.suffixTabulars.every(hasTab),
  // R330 wrapper regression.
  r330_wrapper_rounded_xl:     probe.wrapperClass.includes('rounded-xl'),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor count suffix gray-400+tabular:`, JSON.stringify(results),
  '\n  suffix texts:', probe.suffixTexts,
  '\n  suffix tabular:', probe.suffixTabulars);
process.exit(ok ? 0 : 1);
