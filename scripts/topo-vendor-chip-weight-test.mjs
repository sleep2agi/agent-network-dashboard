/* Round 314 verification: vendor letter chips (e.g. 'A:N', 'O:N')
 * pick up font-medium (500), completing the R312-R313 'HTML-context
 * data chip = font-medium' family. R313 covered the 3 main chips
 * (working/online/active-links); R314 closes the chip-row weight
 * sweep at the vendor letters.
 *
 * Test fixture: 3 vendor types (claude + gpt + intern) to surface
 * the chip row per R281 threshold (vendorDist.length > 2).
 *
 * Contract:
 *   - All [data-vendor-letter] chips have className containing
 *     'font-medium' + 'tabular-nums'.
 *   - Computed font-weight === 500 for each.
 *   - R313 working/online/active chips still font-medium.
 *   - R312 chrome zoom still font-medium.
 *   - R311 recent count fw=600 + R309 row counts fw=600 + R294
 *     pulse absent all preserved.
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
  // 3 vendor types → R281 vendorDist.length > 2 threshold → chips render.
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
await page.waitForSelector('[data-vendor-letter]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const chips = [...document.querySelectorAll('[data-vendor-letter]')];
  const samples = chips.map(c => ({
    initial:    c.getAttribute('data-vendor-letter'),
    className:  c.className,
    fontWeight: getComputedStyle(c).fontWeight,
  }));
  return {
    samples,
    workingChipCls: sel('[data-working-chip]')?.className ?? '',
    chromeZoomCls:  sel('[data-topo-chrome-zoom-level]')?.className ?? '',
    recentCountFw:  sel('[data-recent-panel-count]')?.getAttribute('font-weight') ?? null,
    rowWorkingFw:   sel('[data-legend-count="working"]')?.getAttribute('font-weight') ?? null,
    pulseCount:     document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  vendor_chips_present:        probe.samples.length >= 3,
  all_have_font_medium_cls:    probe.samples.every(s => s.className.includes('font-medium')),
  all_have_tabular_nums_cls:   probe.samples.every(s => s.className.includes('tabular-nums')),
  all_computed_fw_500:         probe.samples.every(s => String(s.fontWeight) === '500'),
  r313_working_chip_fw_500:    probe.workingChipCls.includes('font-medium'),
  r312_chrome_zoom_fw_500:     probe.chromeZoomCls.includes('font-medium'),
  r311_recent_count_fw_600:    probe.recentCountFw === '600',
  r309_row_working_fw_600:     probe.rowWorkingFw === '600',
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor chip weight:`, JSON.stringify(results),
  '\n  vendor chips:', probe.samples.map(s => `${s.initial}=fw${s.fontWeight}`).join(', '));
process.exit(ok ? 0 : 1);
