/* Round 720 — tiers catalog attr on canvas root. 4TH orthogonal
 * meta-doc axis on the breath family, joining:
 *   R710 data-topo-respiratory-rolodex            (cadence axis)
 *   R716 data-topo-respiratory-dual-axis-surfaces (axis axis)
 *   R717 data-topo-respiratory-patterns           (pattern axis)
 *   R720 data-topo-respiratory-tiers              (tier axis) ← this round
 *
 * Tiers partition the 18-anchor family into 7 mutually-exclusive
 * functional-role buckets. Cross-check against R710 rolodex: the
 * union of all tier anchor lists must equal the flat rolodex
 * anchor set (each anchor belongs to exactly 1 tier).
 *
 * Assertions:
 *   - attr present on root <svg>
 *   - JSON parses to Array of exactly 7 entries
 *   - shape: each entry has {name, anchors}
 *   - tier names match expected set (alphabetical sort)
 *   - total anchor count across tiers = 18
 *   - mutual exclusivity: no anchor appears in 2 tiers
 *   - rolodex coverage: every rolodex anchor appears in exactly 1 tier
 *   - rolodex tightness: every tier-listed anchor appears in rolodex
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
    tiers:   svg?.getAttribute('data-topo-respiratory-tiers')   ?? null,
    rolodex: svg?.getAttribute('data-topo-respiratory-rolodex') ?? null,
  };
});

await browser.close();

let tiers = null;
let rolodex = null;
let parseError = null;
try {
  tiers   = JSON.parse(runtimeAttrs.tiers   ?? '');
  rolodex = JSON.parse(runtimeAttrs.rolodex ?? '');
} catch (e) {
  parseError = String(e);
}

const validShape = Array.isArray(tiers)
  ? tiers.every(t => t && typeof t === 'object'
      && typeof t.name === 'string' && t.name.length > 0
      && Array.isArray(t.anchors) && t.anchors.length > 0
      && t.anchors.every(a => typeof a === 'string' && a.length > 0))
  : false;

const tierNames = Array.isArray(tiers) ? tiers.map(t => t.name).sort() : [];
const expectedNames = ['atomic-control', 'background', 'canvas-brand', 'control-wrapper', 'data', 'panel-title', 'title-block'];

const flatTierAnchors = Array.isArray(tiers)
  ? tiers.flatMap(t => Array.isArray(t.anchors) ? t.anchors : [])
  : [];
const tierAnchorSet = new Set(flatTierAnchors);
const mutualExclusivity = flatTierAnchors.length === tierAnchorSet.size;

const rolodexAnchors = rolodex && typeof rolodex === 'object'
  ? Object.values(rolodex).flat()
  : [];
const rolodexSet = new Set(rolodexAnchors);

const rolodexCoverage = [...rolodexSet].every(a => tierAnchorSet.has(a));
const tierTightness   = [...tierAnchorSet].every(a => rolodexSet.has(a));

const results = {
  attr_present:           !!runtimeAttrs.tiers,
  json_parses:            tiers !== null && parseError === null,
  is_array:               Array.isArray(tiers),
  has_7_entries:          Array.isArray(tiers) && tiers.length === 7,
  shape_valid:            validShape,
  tier_names_match:       JSON.stringify(tierNames) === JSON.stringify(expectedNames),
  total_anchors_18:       flatTierAnchors.length === 18,
  mutual_exclusivity:     mutualExclusivity,
  rolodex_coverage:       rolodexCoverage,
  tier_tightness:         tierTightness,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R720 respiratory tiers catalog attr (4th meta-doc axis — breath family quadrilateral):`,
  JSON.stringify(results, null, 2),
  `\n  tiers: ${JSON.stringify(tiers)}`,
  parseError ? `\n  parseError: ${parseError}` : '',
  `\n  rolodex anchors: ${rolodexAnchors.length} · tier anchors: ${flatTierAnchors.length} · unique: ${tierAnchorSet.size}`);
process.exit(ok ? 0 : 1);
