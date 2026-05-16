/* Round 292 verification: legend panel header count picks up explicit
 * fontVariantNumeric='tabular-nums' parity with the recent-signal
 * panel header count (R232). Both panel headers now declare tabular-
 * nums explicitly in inline style.
 *
 * Pre-R292 the legend count inherited tabular digit width via
 * monospace but lacked the explicit directive its sibling
 * recent-signal count carries. Post-R292 the panel-header pair
 * shares the same explicit declaration.
 *
 * Note distinct from R274 (topo-legend-count-tabular-test.mjs)
 * which probes the per-ROW counts (working/idle/offline). R292
 * is the panel-level HEADER count ("N nodes" right-anchored).
 *
 * Contract:
 *   - [data-legend-panel-count] computed font-variant-numeric
 *     includes 'tabular-nums'.
 *   - Text content still '{N} node[s]'.
 *   - [data-recent-panel-count] also tabular (sibling parity check).
 *   - R291 starfield 14 dots + R290 three radar rings intact.
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
await page.waitForSelector('[data-legend-panel-count]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const legendCount = document.querySelector('[data-legend-panel-count]');
  const recentCount = document.querySelector('[data-recent-panel-count]');
  const legendFvn = legendCount ? getComputedStyle(legendCount).fontVariantNumeric : null;
  const recentFvn = recentCount ? getComputedStyle(recentCount).fontVariantNumeric : null;
  const dots = document.querySelectorAll('[data-topo-starfield-dot]');
  const rings = [...document.querySelectorAll('[data-topo-radar-ring]')]
    .map(r => r.getAttribute('data-topo-radar-ring')).sort((a, b) => +a - +b);
  return {
    legendText:        legendCount?.textContent ?? null,
    legendFvn,
    legendFontFamily:  legendCount ? getComputedStyle(legendCount).fontFamily : null,
    recentFvn,
    starfieldCount:    dots.length,
    radarRings:        rings,
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');

const results = {
  legend_count_tabular:       hasTab(probe.legendFvn),
  legend_count_text_kept:     /^\d+ node/.test(probe.legendText || ''),
  legend_count_monospace:     /mono/i.test(probe.legendFontFamily || ''),
  recent_count_tabular_sib:   hasTab(probe.recentFvn),
  r291_starfield_14:          probe.starfieldCount === 14,
  r290_three_rings:           JSON.stringify(probe.radarRings) === JSON.stringify(['170', '250', '330']),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend count tabular parity:`, JSON.stringify(results),
  '\n  legend text:', JSON.stringify(probe.legendText),
  '\n  legend font-variant-numeric:', probe.legendFvn,
  '\n  legend font-family:', probe.legendFontFamily,
  '\n  recent (sibling) font-variant-numeric:', probe.recentFvn);
process.exit(ok ? 0 : 1);
