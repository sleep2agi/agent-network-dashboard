/* Round 724 — 6th entry added to R717 patterns catalog:
 * `triple-axis-pair` with shape `6s-triple-pair`. Formalizes the
 * structural motif previously implicit across R721/R722/R723:
 * kicker + watermark text — both at 6 s, both with text-shadow as
 * the 3rd axis, both sparse-hover read-target text.
 *
 * Cross-validates against R723 triple-axis-surfaces catalog (the
 * authoritative axis-count index): the anchors in this pattern entry
 * must equal R723's anchor set.
 *
 * Assertions:
 *   - R717 patterns has exactly 6 entries (was 5 before R724)
 *   - One entry named "triple-axis-pair" exists
 *   - Its cadences = [6]
 *   - Its shape = "6s-triple-pair"
 *   - Its anchors = ["kicker", "watermark text"] (order preserved)
 *   - Cross-check: R723 triple-axis-surfaces anchor set, after
 *     normalising "watermark" → "watermark text" (the R723 catalog
 *     uses the short anchor key; R717 uses the full rolodex anchor
 *     name), equals this pattern's anchors
 *   - Anchor non-exclusivity (intended): kicker also appears in
 *     "title-block" pattern; "watermark text" also appears in
 *     "canvas-brand-pair" pattern
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
const titleBlockEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'title-block') : null;
const canvasBrandPairEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'canvas-brand-pair') : null;

const r723AnchorsNormalised = Array.isArray(triple)
  ? triple.map(e => e.anchor === 'watermark' ? 'watermark text' : e.anchor).sort()
  : [];
const pairAnchorsSorted = pairEntry?.anchors ? [...pairEntry.anchors].sort() : [];
const crossCheckR723 = JSON.stringify(r723AnchorsNormalised) === JSON.stringify(pairAnchorsSorted);

const results = {
  patterns_has_6_entries:          Array.isArray(patterns) && patterns.length === 6,
  pair_entry_exists:               !!pairEntry,
  pair_cadences_is_6:              JSON.stringify(pairEntry?.cadences) === JSON.stringify([6]),
  pair_shape_correct:              pairEntry?.shape === '6s-triple-pair',
  pair_anchors_correct:            JSON.stringify(pairEntry?.anchors) === JSON.stringify(['kicker', 'watermark text']),
  cross_check_with_r723:           crossCheckR723,
  kicker_also_in_title_block:      Array.isArray(titleBlockEntry?.anchors) && titleBlockEntry.anchors.includes('kicker'),
  watermark_also_in_canvas_brand:  Array.isArray(canvasBrandPairEntry?.anchors) && canvasBrandPairEntry.anchors.includes('watermark text'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R724 R717 patterns +1: triple-axis-pair (formalizes the 6s triple-axis pair structural motif):`,
  JSON.stringify(results, null, 2),
  `\n  pair entry: ${JSON.stringify(pairEntry)}`,
  `\n  R723 anchors (normalised): ${JSON.stringify(r723AnchorsNormalised)}`);
process.exit(ok ? 0 : 1);
