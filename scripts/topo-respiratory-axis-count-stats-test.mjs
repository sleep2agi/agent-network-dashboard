/* Round 729 — axis-count stats catalog on canvas root. 6TH orthogonal
 * meta-doc axis on the breath family. Hexagon meta-doc:
 *   R710 data-topo-respiratory-rolodex             (cadences)
 *   R716 data-topo-respiratory-dual-axis-surfaces  (axes)
 *   R717 data-topo-respiratory-patterns            (patterns)
 *   R720 data-topo-respiratory-tiers               (tiers)
 *   R723 data-topo-respiratory-triple-axis-surfaces (triple-axis)
 *   R729 data-topo-respiratory-axis-count-stats    (stats) ← this round
 *
 * Stats are AGGREGATE counts — explicitly surfaced as queryable data
 * for tooling (debug overlays, sanity checks) despite being derivable
 * from the prior 5 catalogs. R729 test cross-validates every field
 * against the source-of-truth catalogs at runtime.
 *
 * Assertions:
 *   - attr present on root <svg>
 *   - JSON parses to an object with the expected keys
 *   - total_anchors === Σ rolodex anchor counts (R710 cross-check)
 *   - cadences === rolodex keys.length (R710 cross-check)
 *   - cadence_range_s.min/max === rolodex min/max keys (R710 cross-check)
 *   - cadence_arc_s === max - min
 *   - axis_counts.triple === R723 entries length (R723 cross-check)
 *   - axis_counts.single + axis_counts.dual + axis_counts.triple === total_anchors
 *   - patterns_count === R717 length (R717 cross-check)
 *   - tiers_count === R720 length (R720 cross-check)
 *   - triple_axis_pairs === R717 entries matching name 'triple-axis-pair*'
 *   - dual_axis_tier_empty: axis_counts.dual === 0 (post-R728 structural milestone)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-canvas-aria]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeAttrs = await page.evaluate(() => {
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    stats:    svg?.getAttribute('data-topo-respiratory-axis-count-stats')    ?? null,
    rolodex:  svg?.getAttribute('data-topo-respiratory-rolodex')             ?? null,
    triple:   svg?.getAttribute('data-topo-respiratory-triple-axis-surfaces') ?? null,
    patterns: svg?.getAttribute('data-topo-respiratory-patterns')            ?? null,
    tiers:    svg?.getAttribute('data-topo-respiratory-tiers')               ?? null,
  };
});

await browser.close();

let stats = null;
let rolodex = null;
let triple = null;
let patterns = null;
let tiers = null;
let parseError = null;
try {
  stats    = JSON.parse(runtimeAttrs.stats    ?? '');
  rolodex  = JSON.parse(runtimeAttrs.rolodex  ?? '');
  triple   = JSON.parse(runtimeAttrs.triple   ?? '');
  patterns = JSON.parse(runtimeAttrs.patterns ?? '');
  tiers    = JSON.parse(runtimeAttrs.tiers    ?? '');
} catch (e) {
  parseError = String(e);
}

const expectedKeys = ['total_anchors', 'cadences', 'cadence_range_s', 'cadence_arc_s', 'axis_counts', 'patterns_count', 'tiers_count', 'triple_axis_pairs', 'triple_axis_solos'];
const hasAllKeys = stats && expectedKeys.every(k => k in stats);

const rolodexAnchorCount = rolodex && typeof rolodex === 'object'
  ? Object.values(rolodex).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0)
  : -1;
const rolodexCadenceCount = rolodex ? Object.keys(rolodex).length : -1;
const rolodexCadenceMin = rolodex ? Math.min(...Object.keys(rolodex).map(Number)) : -1;
const rolodexCadenceMax = rolodex ? Math.max(...Object.keys(rolodex).map(Number)) : -1;

const r717TriplePairCount = Array.isArray(patterns)
  ? patterns.filter(p => typeof p?.name === 'string' && p.name.startsWith('triple-axis-pair')).length
  : -1;

const axisCountSum = stats?.axis_counts
  ? (stats.axis_counts.single ?? 0) + (stats.axis_counts.dual ?? 0) + (stats.axis_counts.triple ?? 0)
  : -1;

const results = {
  attr_present:                  !!runtimeAttrs.stats,
  json_parses:                   stats !== null && parseError === null,
  has_all_expected_keys:         !!hasAllKeys,
  total_anchors_matches_rolodex: stats?.total_anchors === rolodexAnchorCount,
  cadences_count_matches:        stats?.cadences === rolodexCadenceCount,
  cadence_range_min_matches:     stats?.cadence_range_s?.min === rolodexCadenceMin,
  cadence_range_max_matches:     stats?.cadence_range_s?.max === rolodexCadenceMax,
  cadence_arc_consistent:        stats?.cadence_arc_s === (rolodexCadenceMax - rolodexCadenceMin),
  triple_count_matches_r723:     stats?.axis_counts?.triple === (Array.isArray(triple) ? triple.length : -1),
  axis_count_sum_eq_total:       axisCountSum === stats?.total_anchors,
  patterns_count_matches_r717:   stats?.patterns_count === (Array.isArray(patterns) ? patterns.length : -1),
  tiers_count_matches_r720:      stats?.tiers_count === (Array.isArray(tiers) ? tiers.length : -1),
  triple_axis_pairs_matches:     stats?.triple_axis_pairs === r717TriplePairCount,
  dual_axis_tier_empty:          stats?.axis_counts?.dual === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R729 axis-count stats catalog (6th meta-doc — breath family hexagon):`,
  JSON.stringify(results, null, 2),
  `\n  stats: ${JSON.stringify(stats)}`,
  parseError ? `\n  parseError: ${parseError}` : '');
process.exit(ok ? 0 : 1);
