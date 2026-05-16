/* Round 338 verification: active-links chip extends the
 * R333/R335/R336/R337 chip-internal-hierarchy arc to a 5th surface.
 * Digit prominent, ` active link(s)` unit demotes to opacity-0.7.
 *
 * Contract:
 *   - [data-active-links-chip-unit] className contains 'opacity-70'.
 *   - Computed opacity reads 0.7.
 *   - Unit textContent contains 'active link'.
 *   - Parent chip [data-active-links-chip] textContent retains
 *     "{N} active link(s)" for legacy probes.
 *   - R337 working/online chip unit + R317/R318 chrome regressions.
 *   - R294 pulse absent.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-active-links-chip-unit]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const unit  = document.querySelector('[data-active-links-chip-unit]');
  const chip  = document.querySelector('[data-active-links-chip]');
  return {
    unitClass:     unit?.className ?? '',
    unitText:      unit?.textContent ?? null,
    unitOpacity:   unit ? getComputedStyle(unit).opacity : null,
    chipText:      chip?.textContent ?? null,
    workUnit:      document.querySelector('[data-working-chip-unit]')?.className ?? '',
    onlineUnit:    document.querySelector('[data-online-chip-unit]')?.className ?? '',
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const opacityClose = (val) => val !== null && Math.abs(parseFloat(val) - 0.7) < 0.01;
const results = {
  unit_has_opacity70:           /opacity-70/.test(probe.unitClass),
  unit_text_active:             (probe.unitText || '').includes('active link'),
  unit_computed_0_7:            opacityClose(probe.unitOpacity),
  parent_chip_text:             /\d+\s+active link/.test(probe.chipText || ''),
  r337_working_unit_opacity70:  /opacity-70/.test(probe.workUnit),
  r337_online_unit_opacity70:   /opacity-70/.test(probe.onlineUnit),
  r317_inactive_gray_400:       probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:      probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:            probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links chip unit:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);
