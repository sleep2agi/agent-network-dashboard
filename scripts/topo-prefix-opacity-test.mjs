/* Round 335 verification: filter pin prefix labels (`filter:` /
 * `match:`) gain opacity-70 so the prefix recedes and the value
 * text reads as primary content. Sibling to R333 vendor count
 * suffix subordinate-lift family — recurring pattern: small
 * "label" spans demote to opacity-70 while value text stays
 * full-opacity, creating clear label-vs-value hierarchy inside
 * the same chip.
 *
 * Five prefix surfaces share the `className="hidden sm:inline"`
 * pattern (R335 replace_all):
 *   - status pin pill [data-filter-prefix]
 *   - group pin pill  [data-filter-prefix]
 *   - vendor pin pill [data-filter-prefix]
 *   - edge pin pill   [data-filter-prefix]
 *   - intersection chip [data-pin-intersection-prefix]
 *
 * Contract:
 *   - Activate a status pin (click working chip) so the status
 *     filter pin pill mounts with its `filter:` prefix visible.
 *   - The [data-filter-prefix] span has className containing
 *     'opacity-70'.
 *   - Computed opacity reads 0.7.
 *   - R333 vendor count suffix still gray-400 + tabular.
 *   - R317/R318/R294 chrome + pulse regressions intact.
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
  // 3 vendor types so the vendor letter chip row also renders (for
  // R333 vendor count suffix regression check).
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
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
await page.waitForTimeout(200);

// Pin the working status to mount the status filter pill (which
// contains the `filter:` prefix).
await page.click('[data-working-chip]', { delay: 50 }).catch(() => {});
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const prefixes = Array.from(document.querySelectorAll('[data-filter-prefix]'));
  const intPrefix = document.querySelector('[data-pin-intersection-prefix]');
  const vendorSuffix = document.querySelector('[data-vendor-letter-count-suffix]');
  return {
    prefixCount:           prefixes.length,
    prefixClasses:         prefixes.map(p => p.className),
    prefixOpacities:       prefixes.map(p => getComputedStyle(p).opacity),
    intPrefixClass:        intPrefix?.className ?? null,
    intPrefixOpacity:      intPrefix ? getComputedStyle(intPrefix).opacity : null,
    vendorSuffixClass:     vendorSuffix?.className ?? '',
    vendorSuffixTab:       vendorSuffix ? getComputedStyle(vendorSuffix).fontVariantNumeric : null,
    layoutInactiveCls:     document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:       document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:            document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasOpacity70 = (cls) => /opacity-70/.test(cls || '');
const opacityClose = (val) => Math.abs(parseFloat(val) - 0.7) < 0.01;

const results = {
  prefix_at_least_one:        probe.prefixCount >= 1,
  all_prefix_have_opacity70:  probe.prefixClasses.every(hasOpacity70),
  all_prefix_computed_0_7:    probe.prefixOpacities.every(opacityClose),
  // Pin-intersection chip only mounts when ≥2 dims pinned, which we
  // didn't trigger here (only one click). Accept null OR opacity-70.
  intersection_prefix_ok:     probe.intPrefixClass === null || hasOpacity70(probe.intPrefixClass),
  // R333 vendor count suffix regression.
  r333_vendor_suffix_gray400: probe.vendorSuffixClass.includes('text-gray-400'),
  r333_vendor_suffix_tabular: /tabular-nums/.test(probe.vendorSuffixTab || ''),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:     probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:    probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:          probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} prefix opacity-70:`, JSON.stringify(results),
  '\n  prefix opacities:', probe.prefixOpacities);
process.exit(ok ? 0 : 1);
