/* Round 302 verification: recent-signal panel empty-state hint
 * ('no flow yet') gains letterSpacing="0.2" for editorial parity
 * with R301 panel titles (0.3) + R285 kicker tracking-widest +
 * R289 watermark letterSpacing.
 *
 * Contract:
 *   - [data-recent-signal-empty] attr letter-spacing === '0.2'.
 *   - Text content still 'no flow yet'.
 *   - opacity 0.65 + fontStyle italic preserved.
 *   - R301 panel-title letter-spacings (0.3) still in place.
 *   - R300 kicker font-medium + R295 swatch r=6 + R294 pulse absent
 *     intact.
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
// Empty messages → "no flow yet" hint visible.
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-signal-empty]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const empty = document.querySelector('[data-recent-signal-empty]');
  const recentTitle = document.querySelector('[data-recent-panel-title]');
  const legendTitle = document.querySelector('[data-legend-panel-title]');
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const swatch = document.querySelector('[data-legend-swatch="working"]');
  return {
    emptyLs:       empty?.getAttribute('letter-spacing') ?? null,
    emptyText:     empty?.textContent?.trim() ?? null,
    emptyOpacity:  empty?.getAttribute('opacity') ?? null,
    emptyStyle:    empty?.getAttribute('font-style') ?? null,
    recentTitleLs: recentTitle?.getAttribute('letter-spacing') ?? null,
    legendTitleLs: legendTitle?.getAttribute('letter-spacing') ?? null,
    kickerFw:      kicker ? getComputedStyle(kicker).fontWeight : null,
    swatchR:       swatch?.getAttribute('r') ?? null,
    pulseCount:    document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  empty_hint_ls_0_2:       probe.emptyLs === '0.2',
  empty_hint_text_kept:    (probe.emptyText || '').startsWith('no flow yet'),
  empty_opacity_0_65:      String(probe.emptyOpacity) === '0.65',
  empty_italic_kept:       probe.emptyStyle === 'italic',
  r301_recent_title_ls:    probe.recentTitleLs === '0.3',
  r301_legend_title_ls:    probe.legendTitleLs === '0.3',
  r300_kicker_fw_500:      String(probe.kickerFw) === '500',
  r295_swatch_r_6:         probe.swatchR === '6',
  r294_pulse_absent:       probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} empty-hint tracking:`, JSON.stringify(results),
  '\n  empty hint letter-spacing:', probe.emptyLs,
  '\n  empty hint text:', JSON.stringify(probe.emptyText),
  '\n  R301 panel titles ls:', probe.recentTitleLs, '/', probe.legendTitleLs);
process.exit(ok ? 0 : 1);
