/* Round 303 verification: tier guide ring strokeDasharray tightens
 * from "2 8" → "2 6". Same 2px dash; 8px gap → 6px gap so dashes
 * read closer together, giving tier-guide rings clearer continuous-
 * ring presence after R290/R291 cleared surrounding backdrop noise.
 *
 * Contract:
 *   - All [data-tier-ring] elements have stroke-dasharray '2 6'.
 *   - strokeWidth still 0.7 (regression).
 *   - At least one tier ring rendered with the test fixture (4-node
 *     working fleet → single-tier layout 220 fits).
 *   - R302 empty-hint ls=0.2 + R301 panel titles ls=0.3 + R300 kicker
 *     fw=500 + R294 pulse absent intact.
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
  // 4 working nodes → single-tier ring layout.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
    mk('gamma', 'claude-sonnet-4'),
    mk('delta', 'gpt-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const tierRings = [...document.querySelectorAll('[data-tier-ring]')];
  const samples = tierRings.map(t => ({
    r:           t.getAttribute('data-tier-ring'),
    dasharray:   t.getAttribute('stroke-dasharray'),
    strokeWidth: t.getAttribute('stroke-width'),
    occupancy:   t.getAttribute('data-tier-occupancy'),
  }));
  const empty = document.querySelector('[data-recent-signal-empty]');
  const recentTitle = document.querySelector('[data-recent-panel-title]');
  const legendTitle = document.querySelector('[data-legend-panel-title]');
  const kicker = document.querySelector('[data-topo-section-kicker]');
  return {
    samples,
    emptyLs:       empty?.getAttribute('letter-spacing') ?? null,
    recentTitleLs: recentTitle?.getAttribute('letter-spacing') ?? null,
    legendTitleLs: legendTitle?.getAttribute('letter-spacing') ?? null,
    kickerFw:      kicker ? getComputedStyle(kicker).fontWeight : null,
    pulseCount:    document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  tier_rings_rendered:     probe.samples.length >= 1,
  all_dasharray_2_6:       probe.samples.every(s => s.dasharray === '2 6'),
  all_stroke_width_0_7:    probe.samples.every(s => s.strokeWidth === '0.7'),
  r302_empty_hint_ls_0_2:  probe.emptyLs === '0.2',
  r301_recent_title_ls:    probe.recentTitleLs === '0.3',
  r301_legend_title_ls:    probe.legendTitleLs === '0.3',
  r300_kicker_fw_500:      String(probe.kickerFw) === '500',
  r294_pulse_absent:       probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} tier guide dashes:`, JSON.stringify(results),
  '\n  tier rings sampled:', probe.samples);
process.exit(ok ? 0 : 1);
