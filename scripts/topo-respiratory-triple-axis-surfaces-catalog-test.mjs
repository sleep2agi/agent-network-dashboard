/* Round 723 — triple-axis surfaces catalog attr on canvas root. 5TH
 * orthogonal meta-doc axis on the breath family, joining:
 *   R710 data-topo-respiratory-rolodex             (cadence axis)
 *   R716 data-topo-respiratory-dual-axis-surfaces  (axis axis)
 *   R717 data-topo-respiratory-patterns            (pattern axis)
 *   R720 data-topo-respiratory-tiers               (tier axis)
 *   R723 data-topo-respiratory-triple-axis-surfaces (multi-axis axis) ← this round
 *
 * Surfaces a STRICT SUBSET of R716's entries — every triple-axis
 * surface here also appears in R716 with the same anchor + cadence +
 * axes. Dedicated index for "give me only the >=3-axis surfaces".
 *
 * Assertions:
 *   - attr present on root <svg>
 *   - JSON parses to Array of exactly 2 entries (kicker + watermark)
 *   - each entry has {anchor, cadence_s, axes} shape with axes.length === 3
 *   - both at cadence_s 6
 *   - axes[0] === 'opacity' on every entry (preserved family rule)
 *   - text-shadow appears as the 3rd axis on every entry
 *   - anchor set sorted = ['kicker', 'watermark']
 *   - back-compat: every triple-axis entry also exists in R716 with
 *     same anchor, cadence_s, and axes array
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
    triple:    svg?.getAttribute('data-topo-respiratory-triple-axis-surfaces') ?? null,
    dual_axis: svg?.getAttribute('data-topo-respiratory-dual-axis-surfaces')   ?? null,
  };
});

await browser.close();

let triple = null;
let dualAxis = null;
let parseError = null;
try {
  triple   = JSON.parse(runtimeAttrs.triple    ?? '');
  dualAxis = JSON.parse(runtimeAttrs.dual_axis ?? '');
} catch (e) {
  parseError = String(e);
}

const validShape = Array.isArray(triple)
  ? triple.every(e => e && typeof e === 'object'
      && typeof e.anchor === 'string' && e.anchor.length > 0
      && typeof e.cadence_s === 'number' && e.cadence_s > 0
      && Array.isArray(e.axes) && e.axes.length === 3
      && e.axes.every(a => typeof a === 'string' && a.length > 0))
  : false;

const anchors = Array.isArray(triple) ? triple.map(e => e.anchor).sort() : [];
const allOpacityFirst = Array.isArray(triple) ? triple.every(e => e.axes[0] === 'opacity') : false;
const allTextShadowThird = Array.isArray(triple) ? triple.every(e => e.axes[2] === 'text-shadow') : false;
/* R725 added H2 at 10 s as the 3rd triple-axis surface — the tier
 * is now multi-cadence rather than 6 s-locked. The 6 s pair (kicker
 * + watermark) SUBSET still exists; the all-6 s invariant is retired
 * in favour of "every cadence ∈ rolodex" + "6 s pair intact". */
const cadencesInRolodex = Array.isArray(triple)
  ? triple.every(e => [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 21, 23, 25].includes(e.cadence_s))
  : false;
const sixSecondAnchors = Array.isArray(triple)
  ? triple.filter(e => e.cadence_s === 6).map(e => e.anchor).sort()
  : [];
const sixSecondPairIntact = JSON.stringify(sixSecondAnchors) === JSON.stringify(['kicker', 'watermark']);

const r716ByAnchor = new Map(Array.isArray(dualAxis)
  ? dualAxis.map(e => [e.anchor, e])
  : []);
const backCompatStrict = Array.isArray(triple) && triple.every(e => {
  const m = r716ByAnchor.get(e.anchor);
  return !!m && m.cadence_s === e.cadence_s && JSON.stringify(m.axes) === JSON.stringify(e.axes);
});

const results = {
  attr_present:                 !!runtimeAttrs.triple,
  json_parses:                  triple !== null && parseError === null,
  is_array:                     Array.isArray(triple),
  has_4_entries:                Array.isArray(triple) && triple.length === 4,
  shape_valid_three_axes:       validShape,
  anchors_match_expected:       JSON.stringify(anchors) === JSON.stringify(['H2', 'kicker', 'watermark', 'zoom-level']),
  all_opacity_first:            allOpacityFirst,
  all_text_shadow_third:        allTextShadowThird,
  all_cadences_in_rolodex:      cadencesInRolodex,
  six_second_pair_intact:       sixSecondPairIntact,
  back_compat_subset_of_r716:   backCompatStrict,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R723 triple-axis surfaces catalog (5th meta-doc — breath family pentagon):`,
  JSON.stringify(results, null, 2),
  `\n  triple-axis: ${JSON.stringify(triple)}`,
  parseError ? `\n  parseError: ${parseError}` : '');
process.exit(ok ? 0 : 1);
