/* Round 725 — H2 section title becomes the 3RD triple-axis breath
 * surface; FIRST triple-axis member at a NON-6 s cadence (10 s).
 * Establishes that the triple-axis TIER is multi-cadence rather
 * than 6 s-locked. R724's `triple-axis-pair` pattern stays valid
 * (kicker + watermark still pair at 6 s); H2 joins the tier as a
 * solo 10 s member.
 *
 * H2's 3 axes (all at 10 s in phase):
 *   R702 opacity         (1 ↔ 0.88)
 *   R711 transform-scale (1 ↔ 0.997)
 *   R725 text-shadow     (none ↔ 0 0 8 px rgba(34, 211, 238, 0.22))
 *
 * Glow tuning: 8 px blur (matches watermark) + 0.22 alpha (between
 * kicker 0.30 and watermark 0.20). Wider blur for larger fontSize;
 * slightly higher alpha than watermark because at 10 s the dwell
 * time at peak is longer than the 6 s pair, so a tighter alpha
 * would feel under-emphasised vs the snappier 6 s peaks.
 *
 * Assertions:
 *   - CSS keyframes 0%/100% has text-shadow: none with R702 opacity 1 + R711 scale(1)
 *   - CSS keyframes 50% has text-shadow: 0 0 8 px rgba(34, 211, 238, 0.22)
 *     with R702 opacity 0.88 + R711 scale(0.997)
 *   - .anet-topo-section-title-breath rule still binds 10 s cadence (R702 preserved)
 *   - prefers-reduced-motion guard still present
 *   - runtime H2 has the breath class
 *   - R716 catalog H2 entry axes = ["opacity", "transform-scale", "text-shadow"]
 *   - R723 catalog has 3 entries (was 2 pre-R725)
 *   - R723 catalog includes H2 with cadence 10 + axes triple
 *   - text-shadow now appears on 3 surfaces (kicker + watermark + H2)
 *   - the 6 s pair (kicker + watermark) is still INTACT inside R723
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
await page.waitForSelector('.anet-topo-section-title-breath', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const h2 = document.querySelector('.anet-topo-section-title-breath');
  if (!h2) return null;
  const cs = getComputedStyle(h2);
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    has_class:        h2.classList.contains('anet-topo-section-title-breath'),
    anim_name:        cs.animationName,
    anim_duration:    cs.animationDuration,
    dual_axis:        svg?.getAttribute('data-topo-respiratory-dual-axis-surfaces') ?? null,
    triple_axis:      svg?.getAttribute('data-topo-respiratory-triple-axis-surfaces') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKf0_Triple = /@keyframes anet-topo-section-title-breath-kf\s*\{[\s\S]*?0%,\s*100%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?transform:\s*scale\(1\)[\s\S]*?text-shadow:\s*none[\s\S]*?\}/.test(cssSrc);
const cssKf50_Triple = /@keyframes anet-topo-section-title-breath-kf\s*\{[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.88[\s\S]*?transform:\s*scale\(0\.997\)[\s\S]*?text-shadow:\s*0\s+0\s+8px\s+rgba\(34,\s*211,\s*238,\s*0\.22\)/.test(cssSrc);
const cssClassBound10s = /\.anet-topo-section-title-breath\s*\{[\s\S]*?animation:\s*anet-topo-section-title-breath-kf\s+10s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-section-title-breath\s*\{\s*animation:\s*none/.test(cssSrc);

const runtimeAnimOk = runtimeState?.anim_name === 'anet-topo-section-title-breath-kf' || runtimeState?.anim_name === 'none';

let dualAxisCatalog = null;
let tripleAxisCatalog = null;
try {
  dualAxisCatalog   = JSON.parse(runtimeState?.dual_axis   ?? '');
  tripleAxisCatalog = JSON.parse(runtimeState?.triple_axis ?? '');
} catch {}

const h2DualAxisEntry = Array.isArray(dualAxisCatalog) ? dualAxisCatalog.find(e => e.anchor === 'H2') : null;
const h2TripleAxes_inR716 = !!h2DualAxisEntry
  && Array.isArray(h2DualAxisEntry.axes)
  && JSON.stringify(h2DualAxisEntry.axes) === JSON.stringify(['opacity', 'transform-scale', 'text-shadow']);

const h2TripleEntry = Array.isArray(tripleAxisCatalog) ? tripleAxisCatalog.find(e => e.anchor === 'H2') : null;
const h2InTripleCatalog = !!h2TripleEntry
  && h2TripleEntry.cadence_s === 10
  && JSON.stringify(h2TripleEntry.axes) === JSON.stringify(['opacity', 'transform-scale', 'text-shadow']);

const textShadowAnchors = Array.isArray(dualAxisCatalog)
  ? dualAxisCatalog.filter(e => Array.isArray(e.axes) && e.axes.includes('text-shadow')).map(e => e.anchor).sort()
  : [];
/* R727 added zoom-level as the 4th text-shadow surface — H2 is still
 * a member of the text-shadow set, which is what this assertion ought
 * to verify (the R725-specific invariant); widen to "H2 ∈ text-shadow
 * set" rather than "set == [H2, kicker, watermark]". */
const h2HasTextShadow = textShadowAnchors.includes('H2');

const sixSecondAnchors = Array.isArray(tripleAxisCatalog)
  ? tripleAxisCatalog.filter(e => e.cadence_s === 6).map(e => e.anchor).sort()
  : [];
const sixSecondPairIntact = JSON.stringify(sixSecondAnchors) === JSON.stringify(['kicker', 'watermark']);

const results = {
  h2_present:                       !!runtimeState,
  has_breath_class:                 runtimeState?.has_class === true,
  runtime_anim_h2_kf:               runtimeAnimOk,
  css_0_100_triple_axis:            cssKf0_Triple,
  css_50_triple_axis_with_glow:     cssKf50_Triple,
  css_class_binds_10s:              cssClassBound10s,
  css_reduced_motion_guard:         cssReducedMotion,
  r716_h2_three_axes:               h2TripleAxes_inR716,
  r723_at_least_three_entries:      Array.isArray(tripleAxisCatalog) && tripleAxisCatalog.length >= 3,
  r723_h2_entry:                    h2InTripleCatalog,
  h2_has_text_shadow_axis:          h2HasTextShadow,
  six_second_pair_still_intact:     sixSecondPairIntact,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R725 H2 triple-axis breath (3rd triple-axis surface, first non-6s @ 10s):`,
  JSON.stringify(results, null, 2),
  `\n  H2 R716 entry: ${JSON.stringify(h2DualAxisEntry)}`,
  `\n  H2 R723 entry: ${JSON.stringify(h2TripleEntry)}`,
  `\n  text-shadow surfaces: ${JSON.stringify(textShadowAnchors)}`,
  `\n  6s pair: ${JSON.stringify(sixSecondAnchors)}`);
process.exit(ok ? 0 : 1);
