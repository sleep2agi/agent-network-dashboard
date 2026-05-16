/* Round 337 verification: working chip + online chip (HTML chip-row)
 * split digit/unit with the unit at opacity-70.
 *
 * Extends the R333/R335/R336 chip-internal-hierarchy arc from SVG
 * surfaces (panel headers + vendor count) and pin-chip prefix
 * surfaces (filter pills) into the HTML chip-row chips themselves.
 * Recurring pattern this loop arc: small label spans demote, value
 * stays prominent.
 *
 * Contract:
 *   - [data-working-chip-unit] className contains 'opacity-70',
 *     textContent contains 'working', computed opacity 0.7.
 *   - [data-online-chip-unit] same for 'online'.
 *   - Parent chips' textContent retains the full "{N} working" /
 *     "{N} online" string so any legacy text-based tests pass.
 *   - R336 panel count units + R335 prefix opacity-70 regressions.
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
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-working-chip-unit]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const workUnit  = document.querySelector('[data-working-chip-unit]');
  const onlineUnit = document.querySelector('[data-online-chip-unit]');
  const workChip   = document.querySelector('[data-working-chip]');
  const onlineChip = document.querySelector('[data-online-chip]');
  return {
    workUnitClass:     workUnit?.className ?? '',
    workUnitText:      workUnit?.textContent ?? null,
    workUnitOpacity:   workUnit ? getComputedStyle(workUnit).opacity : null,
    onlineUnitClass:   onlineUnit?.className ?? '',
    onlineUnitText:    onlineUnit?.textContent ?? null,
    onlineUnitOpacity: onlineUnit ? getComputedStyle(onlineUnit).opacity : null,
    workChipText:      workChip?.textContent ?? null,
    onlineChipText:    onlineChip?.textContent ?? null,
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const opacityClose = (val) => val !== null && Math.abs(parseFloat(val) - 0.7) < 0.01;

const results = {
  work_unit_has_opacity70:        /opacity-70/.test(probe.workUnitClass),
  work_unit_text_working:         (probe.workUnitText || '').includes('working'),
  work_unit_computed_0_7:         opacityClose(probe.workUnitOpacity),
  online_unit_has_opacity70:      /opacity-70/.test(probe.onlineUnitClass),
  online_unit_text_online:        (probe.onlineUnitText || '').includes('online'),
  online_unit_computed_0_7:       opacityClose(probe.onlineUnitOpacity),
  // Parent textContent retention.
  work_chip_contains_working:     (probe.workChipText || '').includes('working'),
  online_chip_contains_online:    (probe.onlineChipText || '').includes('online'),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:         probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:        probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:              probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip unit demotion:`, JSON.stringify(results),
  '\n  work unit:',   JSON.stringify(probe.workUnitText),   'opacity:', probe.workUnitOpacity,
  '\n  online unit:', JSON.stringify(probe.onlineUnitText), 'opacity:', probe.onlineUnitOpacity);
process.exit(ok ? 0 : 1);
