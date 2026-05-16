/* Round 313 verification: chip-row data chips (working, online,
 * active-links) pick up font-medium (500). Extends the R312
 * 'HTML-context data = font-medium' rule from the chrome strip
 * zoom readout to the chip-row chips at the title block.
 *
 * Contract:
 *   - [data-working-chip] className contains 'font-medium'.
 *   - [data-online-chip]  className contains 'font-medium'.
 *   - [data-active-links-chip] className contains 'font-medium'.
 *   - Computed font-weight === 500 for each.
 *   - tabular-nums kept on all three (R232 regression).
 *   - R312 chrome zoom readout still font-medium (sibling).
 *   - R311/R310/R309/R294 regressions preserved.
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
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const working = sel('[data-working-chip]');
  const online  = sel('[data-online-chip]');
  const active  = sel('[data-active-links-chip]');
  const fwOf = (el) => el ? getComputedStyle(el).fontWeight : null;
  const clsHas = (el, needle) => (el?.className ?? '').includes(needle);
  return {
    workingCls:  working?.className ?? '',
    onlineCls:   online?.className ?? '',
    activeCls:   active?.className ?? '',
    workingFw:   fwOf(working),
    onlineFw:    fwOf(online),
    activeFw:    fwOf(active),
    workingHasTabular: clsHas(working, 'tabular-nums'),
    onlineHasTabular:  clsHas(online,  'tabular-nums'),
    activeHasTabular:  clsHas(active,  'tabular-nums'),
    chromeZoomCls: sel('[data-topo-chrome-zoom-level]')?.className ?? '',
    recentCountFw: sel('[data-recent-panel-count]')?.getAttribute('font-weight') ?? null,
    rowWorkingFw:  sel('[data-legend-count="working"]')?.getAttribute('font-weight') ?? null,
    pulseCount:    document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasMedium = (s) => s.includes('font-medium');

const results = {
  working_has_font_medium:     hasMedium(probe.workingCls),
  online_has_font_medium:      hasMedium(probe.onlineCls),
  active_has_font_medium:      hasMedium(probe.activeCls),
  working_fw_500:              String(probe.workingFw) === '500',
  online_fw_500:               String(probe.onlineFw) === '500',
  active_fw_500:               String(probe.activeFw) === '500',
  working_tabular_kept:        probe.workingHasTabular,
  online_tabular_kept:         probe.onlineHasTabular,
  active_tabular_kept:         probe.activeHasTabular,
  r312_chrome_zoom_kept:       probe.chromeZoomCls.includes('font-medium'),
  r311_recent_count_fw_600:    probe.recentCountFw === '600',
  r309_row_count_fw_600:       probe.rowWorkingFw === '600',
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chiprow data weight:`, JSON.stringify(results),
  '\n  fw: working=', probe.workingFw, ' online=', probe.onlineFw, ' active=', probe.activeFw,
  '\n  chrome zoom (R312):', probe.chromeZoomCls.includes('font-medium') ? 'has font-medium' : 'MISSING font-medium');
process.exit(ok ? 0 : 1);
