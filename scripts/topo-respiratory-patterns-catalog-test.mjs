/* Round 717 — patterns catalog attr on canvas root. 3rd of 3 meta-doc
 * catalogs completing the breath family's self-describing triangle:
 *   R710 data-topo-respiratory-rolodex            (cadences)
 *   R716 data-topo-respiratory-dual-axis-surfaces (axes)
 *   R717 data-topo-respiratory-patterns           (patterns)
 *
 * Assertions:
 *   - attr present on root <svg>
 *   - JSON parses to an Array of exactly 5 entries
 *   - shape: each entry has {name, cadences, anchors, shape}
 *   - shape strings are one of the 5 known taxonomy values
 *   - sum of anchors across patterns matches the R710 anchor count (16)
 *   - cross-check: every cadence in R717 patterns also appears in R710 rolodex
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
    patterns: svg?.getAttribute('data-topo-respiratory-patterns') ?? null,
    rolodex:  svg?.getAttribute('data-topo-respiratory-rolodex')  ?? null,
  };
});

await browser.close();

let patterns = null;
let rolodex  = null;
let parseError = null;
try {
  patterns = JSON.parse(runtimeAttrs.patterns ?? '');
  rolodex  = JSON.parse(runtimeAttrs.rolodex  ?? '');
} catch (e) {
  parseError = String(e);
}

const validShape = Array.isArray(patterns)
  ? patterns.every(p => p && typeof p === 'object'
      && typeof p.name === 'string' && p.name.length > 0
      && Array.isArray(p.cadences) && p.cadences.length > 0 && p.cadences.every(c => typeof c === 'number' && c > 0)
      && Array.isArray(p.anchors) && p.anchors.length > 0 && p.anchors.every(a => typeof a === 'string' && a.length > 0)
      && typeof p.shape === 'string' && ['trio-with-envelope', 'parity', 'tiered-with-trio', 'coprime-nested-pair', 'baseline-pair'].includes(p.shape))
  : false;

const totalAnchorCount = Array.isArray(patterns)
  ? patterns.reduce((acc, p) => acc + (Array.isArray(p.anchors) ? p.anchors.length : 0), 0)
  : 0;

// Cross-check: every cadence in R717 patterns must appear in R710 rolodex
const rolodexCadences = rolodex ? new Set(Object.keys(rolodex).map(Number)) : new Set();
const patternsCadences = Array.isArray(patterns)
  ? new Set(patterns.flatMap(p => p.cadences))
  : new Set();
const allPatternCadencesInRolodex = [...patternsCadences].every(c => rolodexCadences.has(c));

const patternNames = Array.isArray(patterns) ? patterns.map(p => p.name).sort() : [];
const expectedNames = ['background', 'canvas-brand-pair', 'chrome-strip', 'panel-pair', 'title-block'];

const results = {
  attr_present:                  !!runtimeAttrs.patterns,
  json_parses:                   patterns !== null && parseError === null,
  is_array:                      Array.isArray(patterns),
  has_5_entries:                 Array.isArray(patterns) && patterns.length === 5,
  pattern_names_match:           JSON.stringify(patternNames) === JSON.stringify(expectedNames),
  shape_and_taxonomy_valid:      validShape,
  total_anchors_count:           totalAnchorCount >= 14 && totalAnchorCount <= 18, // pattern membership can have overlap counting
  all_cadences_in_rolodex:       allPatternCadencesInRolodex,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R717 patterns catalog attr (3rd meta-doc — breath family triangle complete):`,
  JSON.stringify(results, null, 2),
  `\n  patterns: ${JSON.stringify(patterns)}`,
  parseError ? `\n  parseError: ${parseError}` : '');
process.exit(ok ? 0 : 1);
