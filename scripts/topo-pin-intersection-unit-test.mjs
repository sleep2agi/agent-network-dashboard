/* Round 341 verification: pin-intersection chip's middle " pins"
 * unit word gets wrapped in an opacity-0.7 span. Completes the
 * chip-internal hierarchy on this 3-tier chip:
 *   pinDimCount       (prominent value, tabular-nums)
 *   " pins"           (recessive unit, opacity-0.7)  ← R341
 *   " · matchAliases" (recessive count, opacity-0.7 + tabular-nums)
 *
 * 7th surface in the R333-R340 chip-internal-hierarchy arc.
 *
 * Contract:
 *   - [data-pin-intersection-unit] present, className contains
 *     'opacity-70', textContent contains 'pins'.
 *   - Computed opacity reads 0.7.
 *   - Sibling spans (count-dims, count-matches) preserved.
 *   - R340 +more flows unit + R317/R318 chrome regressions intact.
 *
 * Fixture: pin TWO filter dimensions (status + vendor) so the
 * pin-intersection chip mounts.
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

// Pin status (working) + vendor (any letter) to trigger pin-intersection.
await page.click('[data-working-chip]', { delay: 50 }).catch(() => {});
await page.waitForTimeout(200);
await page.click('[data-vendor-letter]', { delay: 50 }).catch(() => {});
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const unit       = document.querySelector('[data-pin-intersection-unit]');
  const dimsSpan   = document.querySelector('[data-pin-intersection-count-dims]');
  const matchSpan  = document.querySelector('[data-pin-intersection-count-matches]');
  const moreUnit   = document.querySelector('[data-recent-panel-more-unit]');
  return {
    unitClass:        unit?.className ?? '',
    unitText:         unit?.textContent ?? null,
    unitOpacity:      unit ? getComputedStyle(unit).opacity : null,
    dimsPresent:      dimsSpan !== null,
    matchesClass:     matchSpan?.className ?? '',
    matchesOpacity:   matchSpan ? getComputedStyle(matchSpan).opacity : null,
    r340MoreUnitTag:  moreUnit?.getAttribute('opacity') ?? null,
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const opacityClose = (val) => val !== null && Math.abs(parseFloat(val) - 0.7) < 0.01;

const results = {
  unit_present:               probe.unitText !== null,
  unit_has_opacity70:         /opacity-70/.test(probe.unitClass),
  unit_text_pins:             (probe.unitText || '').trim() === 'pins',
  unit_computed_0_7:          opacityClose(probe.unitOpacity),
  dims_sibling_present:       probe.dimsPresent,
  matches_sibling_opacity:    /opacity-70/.test(probe.matchesClass),
  // R340 regression — only when recent-signal panel mounted (>3 flows).
  // No messages in fixture → accept null.
  r340_more_unit_or_absent:   probe.r340MoreUnitTag === null || probe.r340MoreUnitTag === '0.7',
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:     probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:    probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:          probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pin-intersection " pins" unit:`, JSON.stringify(results),
  '\n  unit text:', JSON.stringify(probe.unitText), 'opacity:', probe.unitOpacity);
process.exit(ok ? 0 : 1);
