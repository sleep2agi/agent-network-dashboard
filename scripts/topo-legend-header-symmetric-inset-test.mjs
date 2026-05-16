/* Round 257 verification: legend panel header symmetric 13L/13R inner-
 * padding, matching the recent-signal panel pattern.
 *
 * Pre-R257 the two corner panels had inconsistent header inner-padding:
 *
 *   Recent-signal panel (width 230):
 *     · "recent signal" at x=13   → 13px left inset
 *     · "{N} flows ..." at x=217  → 13px right inset (end-anchored)
 *     → 13L / 13R · symmetric ✅
 *
 *   Legend panel (width 224):
 *     · "legend"        at x=13   → 13px left inset
 *     · "{N} nodes"     at x=215  → 9px right inset (end-anchored)
 *     → 13L / 9R · asymmetric ❌
 *
 * R257 changes legend header count x=215 → x=211 (= 224-13), so the
 * legend panel header now reads 13L / 13R, matching recent-signal.
 *
 * The per-row count text at x=215 (offline-row level, line ~6321)
 * stays — it's paired with the flow-arrow swatch geometry
 * (path "M140,80 Q164,56 196,80" + marker tip ≈ x=202). Moving the
 * row-level count to x=211 would tighten the swatch→count gap from
 * 13px to 9px, visibly pinching the indicator. R257 only adjusts the
 * standalone header count.
 *
 * Test scope:
 *   1. Legend "legend" title x === 13.
 *   2. Legend "{N} nodes" header count x === 211 (was 215).
 *   3. Recent-signal title x === 13 (regression).
 *   4. Recent-signal flow-count tspan parent <text> x === 217 (regression).
 *   5. Legend row count (offline) x === 215 — UNCHANGED (paired with
 *      flow-arrow swatch).
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
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-legend-panel-count]',                  { timeout: 10000 });
await page.waitForSelector('[data-recent-panel-count]',                  { timeout: 10000 });
await page.waitForSelector('[data-legend-status="offline"] [data-legend-count="offline"]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  // Legend panel
  const legendPanelG = document.querySelector('[data-topo-panel="legend"]');
  const legendRectW = +legendPanelG?.querySelector('rect').getAttribute('width');
  const legendTitle = [...legendPanelG.querySelectorAll('text')].find(t => t.textContent.trim() === 'legend');
  const legendCount = document.querySelector('[data-legend-panel-count]');
  // Recent-signal panel
  const recentPanelG = document.querySelector('[data-topo-panel="recent"]');
  const recentRectW = +recentPanelG?.querySelector('rect').getAttribute('width');
  const recentTitle = [...recentPanelG.querySelectorAll('text')].find(t => t.textContent.trim().startsWith('recent signal'));
  const recentFlowCount = document.querySelector('[data-recent-panel-count]');
  // Recent flow count tspan's parent <text> carries the x attr
  const recentFlowCountParentX = recentFlowCount ? recentFlowCount.parentElement.getAttribute('x') : null;
  // Legend offline-row count (unchanged @ x=215)
  const legendOfflineCount = document.querySelector('[data-legend-count="offline"]');
  return {
    legendRectW, recentRectW,
    legendTitleX:        legendTitle  ? +legendTitle.getAttribute('x')  : null,
    legendCountX:        legendCount  ? +legendCount.getAttribute('x')  : null,
    recentTitleX:        recentTitle  ? +recentTitle.getAttribute('x')  : null,
    recentFlowCountX:    recentFlowCountParentX ? +recentFlowCountParentX : null,
    legendOfflineCountX: legendOfflineCount ? +legendOfflineCount.getAttribute('x') : null,
  };
});
await browser.close();

const results = {
  legend_title_x_is_13:               probe.legendTitleX === 13,
  legend_count_x_moved_to_211:        probe.legendCountX === 211,
  legend_symmetric_inset_13L_13R:     probe.legendRectW != null && probe.legendCountX != null &&
                                       probe.legendTitleX === 13 &&
                                       (probe.legendRectW - probe.legendCountX) === 13,
  recent_title_x_is_13_unchanged:     probe.recentTitleX === 13,
  recent_flow_count_x_217_unchanged:  probe.recentFlowCountX === 217,
  recent_symmetric_inset_13L_13R:     probe.recentRectW != null && probe.recentFlowCountX != null &&
                                       (probe.recentRectW - probe.recentFlowCountX) === 13,
  legend_offline_count_x_215_unchanged: probe.legendOfflineCountX === 215,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend header symmetric inset:`, JSON.stringify(results),
  '\n  legend  rect_w=', probe.legendRectW, ' title_x=', probe.legendTitleX, ' count_x=', probe.legendCountX,
  '\n  recent  rect_w=', probe.recentRectW, ' title_x=', probe.recentTitleX, ' flow_count_x=', probe.recentFlowCountX,
  '\n  legend  offline_count_x=', probe.legendOfflineCountX, '(should stay 215)');
process.exit(ok ? 0 : 1);
