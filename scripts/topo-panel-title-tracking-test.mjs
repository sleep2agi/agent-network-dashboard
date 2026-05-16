/* Round 301 verification: panel titles ('recent signal' + 'legend')
 * gain letterSpacing="0.3" for editorial parity with R289 watermark
 * + R285 kicker tracking-widest. At fontSize 12 monospace fontWeight
 * 700, 0.3px adds touch of designed-header register without changing
 * the lowercase terminal-style aesthetic.
 *
 * Contract:
 *   - [data-recent-panel-title] attr letter-spacing === '0.3'.
 *   - [data-legend-panel-title]  attr letter-spacing === '0.3'.
 *   - Text content still 'recent signal' / 'legend'.
 *   - R300 kicker font-medium + R299 mb=16px + R297 transition + R295
 *     swatch r=6 + R294 pulse absent intact.
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
await page.waitForSelector('[data-recent-panel-title]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const recent = document.querySelector('[data-recent-panel-title]');
  const legend = document.querySelector('[data-legend-panel-title]');
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const swatch = document.querySelector('[data-legend-swatch="working"]');
  return {
    recentLs:     recent?.getAttribute('letter-spacing') ?? null,
    recentText:   recent?.textContent ?? null,
    legendLs:     legend?.getAttribute('letter-spacing') ?? null,
    legendText:   legend?.textContent ?? null,
    kickerFw:     kicker ? getComputedStyle(kicker).fontWeight : null,
    swatchR:      swatch?.getAttribute('r') ?? null,
    pulseCount:   document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  recent_title_ls_0_3:     probe.recentLs === '0.3',
  recent_title_text:       probe.recentText === 'recent signal',
  legend_title_ls_0_3:     probe.legendLs === '0.3',
  legend_title_text:       probe.legendText === 'legend',
  r300_kicker_fw_500:      String(probe.kickerFw) === '500',
  r295_swatch_r_6:         probe.swatchR === '6',
  r294_pulse_absent:       probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel title tracking:`, JSON.stringify(results),
  '\n  recent-panel-title letter-spacing:', probe.recentLs,
  '\n  legend-panel-title letter-spacing:', probe.legendLs,
  '\n  R300 kicker font-weight:', probe.kickerFw);
process.exit(ok ? 0 : 1);
