/* Round 312 verification: chrome strip zoom readout '{N}%' picks
 * up font-medium (500). Extends the R309-R311 data-digit weight
 * rule to the chrome strip's only live data display. font-medium
 * vs the SVG panel counts' fontWeight=600 keeps a tier between
 * SVG-panel data (600) and HTML-chrome data (500), preventing
 * the chrome readout from competing with the SVG panel counts.
 *
 * Contract:
 *   - [data-topo-chrome-zoom-level] className contains
 *     'font-medium'. Computed font-weight resolves to 500.
 *   - tabular-nums still in className (R225 regression).
 *   - text content matches '{N}%' pattern.
 *   - R311 recent count fw=600 + R310 legend panel count fw=600
 *     + R309 row counts fw=600 + R294 pulse absent all preserved.
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
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const zoom = sel('[data-topo-chrome-zoom-level]');
  return {
    zoomCls:        zoom?.className ?? '',
    zoomFw:         zoom ? getComputedStyle(zoom).fontWeight : null,
    zoomText:       zoom?.textContent?.trim() ?? null,
    recentCountFw:  sel('[data-recent-panel-count]')?.getAttribute('font-weight') ?? null,
    legendCountFw:  sel('[data-legend-panel-count]')?.getAttribute('font-weight') ?? null,
    rowWorkingFw:   sel('[data-legend-count="working"]')?.getAttribute('font-weight') ?? null,
    subhintLs:      sel('[data-recent-signal-empty-hint]')?.getAttribute('letter-spacing') ?? null,
    pulseCount:     document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  zoom_cls_has_font_medium: probe.zoomCls.includes('font-medium'),
  zoom_cls_has_tabular:     probe.zoomCls.includes('tabular-nums'),
  zoom_computed_fw_500:     String(probe.zoomFw) === '500',
  zoom_text_percent:        /\d+%$/.test(probe.zoomText || ''),
  r311_recent_count_fw_600: probe.recentCountFw === '600',
  r310_legend_count_fw_600: probe.legendCountFw === '600',
  r309_row_working_fw_600:  probe.rowWorkingFw === '600',
  r304_subhint_ls_0_15:     probe.subhintLs === '0.15',
  r294_pulse_absent:        probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome zoom readout weight:`, JSON.stringify(results),
  '\n  zoom readout:', probe.zoomText, 'fw=', probe.zoomFw,
  '\n  SVG panel counts (R310/R311):', probe.legendCountFw, '/', probe.recentCountFw,
  '\n  row count (R309):', probe.rowWorkingFw);
process.exit(ok ? 0 : 1);
