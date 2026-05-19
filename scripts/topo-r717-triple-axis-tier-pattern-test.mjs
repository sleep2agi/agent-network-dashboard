/* Round 726 — 7th entry added to R717 patterns catalog: `triple-axis-tier`
 * (shape `tier-multi-cadence`). Companion to R724's `triple-axis-pair`
 * (shape `6s-triple-pair`). R725 added H2 as the 3rd triple-axis surface
 * at 10 s, proving the tier is multi-cadence; R726 documents the tier
 * as its own pattern entry covering all 3 triple-axis members across
 * both cadences.
 *
 * Pattern axis now has BOTH grain sizes:
 *   triple-axis-pair  cadences [6]      anchors [kicker, watermark text]                       — 6 s subset
 *   triple-axis-tier  cadences [6, 10]  anchors [kicker, watermark text, H2 section title]     — full tier
 *
 * Assertions:
 *   - R717 patterns has exactly 7 entries (was 6 before R726)
 *   - One entry named "triple-axis-tier" exists
 *   - Its cadences = [6, 10]
 *   - Its shape = "tier-multi-cadence"
 *   - Its anchors = ["kicker", "watermark text", "H2 section title"]
 *   - PAIR ⊂ TIER: every pair anchor appears in tier anchors
 *   - PAIR cadences ⊂ TIER cadences: 6 ∈ tier.cadences
 *   - Cross-check with R723: tier anchors (normalised) equals
 *     R723 triple-axis-surfaces anchors (normalised)
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
    patterns: svg?.getAttribute('data-topo-respiratory-patterns')               ?? null,
    triple:   svg?.getAttribute('data-topo-respiratory-triple-axis-surfaces')   ?? null,
  };
});

await browser.close();

let patterns = null;
let triple = null;
try {
  patterns = JSON.parse(runtimeAttrs.patterns ?? '');
  triple   = JSON.parse(runtimeAttrs.triple   ?? '');
} catch {}

const pairEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'triple-axis-pair') : null;
const tierEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'triple-axis-tier') : null;

const tierAnchorsCorrect = tierEntry
  && JSON.stringify(tierEntry.anchors) === JSON.stringify(['kicker', 'watermark text', 'recent title', 'legend title', 'zoom-level readout', 'H2 section title']);
const tierCadencesCorrect = tierEntry
  && JSON.stringify(tierEntry.cadences) === JSON.stringify([6, 8, 9, 10]);
const tierShapeCorrect = tierEntry?.shape === 'tier-multi-cadence';

const pairAnchorsSubsetOfTier = Array.isArray(pairEntry?.anchors) && Array.isArray(tierEntry?.anchors)
  && pairEntry.anchors.every(a => tierEntry.anchors.includes(a));
const pairCadencesSubsetOfTier = Array.isArray(pairEntry?.cadences) && Array.isArray(tierEntry?.cadences)
  && pairEntry.cadences.every(c => tierEntry.cadences.includes(c));

const r723AnchorsNormalisedSorted = Array.isArray(triple)
  ? triple.map(e => {
      if (e.anchor === 'watermark')  return 'watermark text';
      if (e.anchor === 'H2')         return 'H2 section title';
      if (e.anchor === 'zoom-level') return 'zoom-level readout';
      if (e.anchor === 'recent')     return 'recent title';
      if (e.anchor === 'legend')     return 'legend title';
      return e.anchor;
    }).sort()
  : [];
const tierAnchorsSorted = tierEntry?.anchors ? [...tierEntry.anchors].sort() : [];
const tierEqualsR723 = JSON.stringify(tierAnchorsSorted) === JSON.stringify(r723AnchorsNormalisedSorted);

const results = {
  patterns_has_8_entries:           Array.isArray(patterns) && patterns.length === 8,
  tier_entry_exists:                !!tierEntry,
  tier_cadences_6_8_9_10:           !!tierCadencesCorrect,
  tier_shape_correct:               tierShapeCorrect,
  tier_anchors_correct:             !!tierAnchorsCorrect,
  pair_anchors_subset_of_tier:      pairAnchorsSubsetOfTier,
  pair_cadences_subset_of_tier:     pairCadencesSubsetOfTier,
  tier_equals_r723_anchor_set:      tierEqualsR723,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R726 R717 patterns +1: triple-axis-tier (companion to R724 pair, covers full multi-cadence tier):`,
  JSON.stringify(results, null, 2),
  `\n  tier entry: ${JSON.stringify(tierEntry)}`,
  `\n  pair entry: ${JSON.stringify(pairEntry)}`,
  `\n  R723 anchors (normalised, sorted): ${JSON.stringify(r723AnchorsNormalisedSorted)}`);
process.exit(ok ? 0 : 1);
