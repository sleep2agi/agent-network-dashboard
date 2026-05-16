/* Round 304 verification: secondary instructional hint
 * 'send a message between agents' gains letterSpacing='0.15'.
 * Extends the R301/R302 editorial-spacing-by-loudness hierarchy
 * one layer down — quietest authored text in the panel.
 *
 * Contract:
 *   - [data-recent-signal-empty-hint] attr letter-spacing === '0.15'.
 *   - Text content unchanged.
 *   - opacity 0.45 + fontSize 9 preserved.
 *   - R302 main empty hint ls=0.2 still in place (regression).
 *   - R301 panel titles ls=0.3 + R300 kicker fw=500 intact.
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
await page.waitForSelector('[data-recent-signal-empty-hint]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const hint = document.querySelector('[data-recent-signal-empty-hint]');
  const empty = document.querySelector('[data-recent-signal-empty]');
  const recentTitle = document.querySelector('[data-recent-panel-title]');
  const legendTitle = document.querySelector('[data-legend-panel-title]');
  const kicker = document.querySelector('[data-topo-section-kicker]');
  return {
    hintLs:           hint?.getAttribute('letter-spacing') ?? null,
    hintText:         hint?.textContent?.trim() ?? null,
    hintFontSize:     hint?.getAttribute('font-size') ?? null,
    hintOpacity:      hint?.getAttribute('opacity') ?? null,
    emptyLs:          empty?.getAttribute('letter-spacing') ?? null,
    recentTitleLs:    recentTitle?.getAttribute('letter-spacing') ?? null,
    legendTitleLs:    legendTitle?.getAttribute('letter-spacing') ?? null,
    kickerFw:         kicker ? getComputedStyle(kicker).fontWeight : null,
    pulseCount:       document.querySelectorAll('[data-pulse-wrapper]').length,
    tierDashes:       (() => {
      const t = document.querySelector('[data-tier-ring]');
      return t?.getAttribute('stroke-dasharray') ?? null;
    })(),
  };
});
await browser.close();

const results = {
  subhint_ls_0_15:         probe.hintLs === '0.15',
  subhint_text_kept:       (probe.hintText || '').startsWith('send a message between agents'),
  subhint_font_size_9:     probe.hintFontSize === '9',
  subhint_opacity_0_45:    String(probe.hintOpacity) === '0.45',
  r302_main_hint_ls_0_2:   probe.emptyLs === '0.2',
  r301_recent_title_ls:    probe.recentTitleLs === '0.3',
  r301_legend_title_ls:    probe.legendTitleLs === '0.3',
  r300_kicker_fw_500:      String(probe.kickerFw) === '500',
  r303_tier_dashes_2_6:    probe.tierDashes === '2 6',
  r294_pulse_absent:       probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} empty subhint tracking:`, JSON.stringify(results),
  '\n  sub-hint letter-spacing:', probe.hintLs,
  '\n  main hint letter-spacing (R302):', probe.emptyLs,
  '\n  panel titles ls (R301):', probe.recentTitleLs, '/', probe.legendTitleLs);
process.exit(ok ? 0 : 1);
