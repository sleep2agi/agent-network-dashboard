/* Round 727 — zoom-level readout becomes the 4TH triple-axis breath
 * surface and FIRST chrome-tier (data-tier) member to gain text-shadow.
 * R703 opacity (9 s) + R715 transform-scale (9 s) joined by R727
 * text-shadow (9 s) — all 3 axes share the 9 s cadence in phase.
 *
 * Multi-cadence triple-axis tier post-R727 (4 members across 3 cadences):
 *   6 s   kicker + watermark   (title-block + canvas-brand tiers)
 *   9 s   zoom-level readout   (data tier) ← this round
 *   10 s  H2 section title     (title-block tier)
 *
 * Glow tuning: blur 5 px (smaller pill surface), alpha 0.25 (mid-range
 * between R721 kicker 0.30 sharp+bright and R725 H2 0.22 mellow-slow).
 *
 * Assertions:
 *   - CSS keyframes 0%/100% has opacity 1 + scale(1) + text-shadow: none
 *   - CSS keyframes 50% has opacity 0.85 + scale(0.996) + text-shadow 0 0 5px rgba(34,211,238,0.25)
 *   - .anet-topo-chrome-zoom-level-breath rule binds 9 s cadence (R703 preserved)
 *   - hover-gate selector still present (R703 leaf-element gate)
 *   - prefers-reduced-motion guard still present
 *   - runtime zoom-level span has the breath class
 *   - R716 catalog zoom-level entry axes = ["opacity", "transform-scale", "text-shadow"]
 *   - R723 catalog has 4 entries (was 3 pre-R727)
 *   - R723 catalog includes zoom-level with cadence 9 + axes triple
 *   - text-shadow now appears on 4 surfaces (kicker + watermark + H2 + zoom-level)
 *   - 6 s pair (kicker + watermark) still intact (R724 invariant)
 *   - R726 tier pattern cadences = [6, 9, 10] (R727 extended from [6, 10])
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
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const zl = document.querySelector('[data-topo-chrome-zoom-level]');
  if (!zl) return null;
  const cs = getComputedStyle(zl);
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    has_class:        zl.classList.contains('anet-topo-chrome-zoom-level-breath'),
    anim_name:        cs.animationName,
    anim_duration:    cs.animationDuration,
    dual_axis:        svg?.getAttribute('data-topo-respiratory-dual-axis-surfaces') ?? null,
    triple_axis:      svg?.getAttribute('data-topo-respiratory-triple-axis-surfaces') ?? null,
    patterns:         svg?.getAttribute('data-topo-respiratory-patterns') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKf0_Triple = /@keyframes anet-topo-chrome-zoom-level-breath-kf\s*\{[\s\S]*?0%,\s*100%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?transform:\s*scale\(1\)[\s\S]*?text-shadow:\s*none[\s\S]*?\}/.test(cssSrc);
const cssKf50_Triple = /@keyframes anet-topo-chrome-zoom-level-breath-kf\s*\{[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.85[\s\S]*?transform:\s*scale\(0\.996\)[\s\S]*?text-shadow:\s*0\s+0\s+5px\s+rgba\(34,\s*211,\s*238,\s*0\.25\)/.test(cssSrc);
const cssClassBound9s = /\.anet-topo-chrome-zoom-level-breath\s*\{[\s\S]*?animation:\s*anet-topo-chrome-zoom-level-breath-kf\s+9s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssHoverGate = /\.anet-topo-chrome-zoom-level-breath\[data-topo-chrome-zoom-level-hover="true"\]\s*\{\s*animation:\s*none/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-chrome-zoom-level-breath\s*\{\s*animation:\s*none/.test(cssSrc);

const runtimeAnimOk = runtimeState?.anim_name === 'anet-topo-chrome-zoom-level-breath-kf' || runtimeState?.anim_name === 'none';

let dualAxisCatalog = null;
let tripleAxisCatalog = null;
let patterns = null;
try {
  dualAxisCatalog   = JSON.parse(runtimeState?.dual_axis   ?? '');
  tripleAxisCatalog = JSON.parse(runtimeState?.triple_axis ?? '');
  patterns          = JSON.parse(runtimeState?.patterns    ?? '');
} catch {}

const zlDualEntry = Array.isArray(dualAxisCatalog) ? dualAxisCatalog.find(e => e.anchor === 'zoom-level') : null;
const zlTripleInR716 = !!zlDualEntry
  && Array.isArray(zlDualEntry.axes)
  && JSON.stringify(zlDualEntry.axes) === JSON.stringify(['opacity', 'transform-scale', 'text-shadow']);

const zlTripleEntry = Array.isArray(tripleAxisCatalog) ? tripleAxisCatalog.find(e => e.anchor === 'zoom-level') : null;
const zlInTripleCatalog = !!zlTripleEntry
  && zlTripleEntry.cadence_s === 9
  && JSON.stringify(zlTripleEntry.axes) === JSON.stringify(['opacity', 'transform-scale', 'text-shadow']);

const textShadowAnchors = Array.isArray(dualAxisCatalog)
  ? dualAxisCatalog.filter(e => Array.isArray(e.axes) && e.axes.includes('text-shadow')).map(e => e.anchor).sort()
  : [];
/* R728 added recent + legend to the text-shadow set (now 6 total).
 * R727's specific claim was "zoom-level is in the text-shadow set" —
 * widen the cardinality assertion. */
const zoomLevelInTextShadowSet = textShadowAnchors.includes('zoom-level');

const sixSecondAnchors = Array.isArray(tripleAxisCatalog)
  ? tripleAxisCatalog.filter(e => e.cadence_s === 6).map(e => e.anchor).sort()
  : [];
const sixSecondPairIntact = JSON.stringify(sixSecondAnchors) === JSON.stringify(['kicker', 'watermark']);

const tierEntry = Array.isArray(patterns) ? patterns.find(p => p.name === 'triple-axis-tier') : null;
/* R728 extended tier cadences to [6, 8, 9, 10]. R727's claim was that
 * 9 is in the tier — widen to "9 ∈ tier.cadences". */
const tierIncludes9 = tierEntry && Array.isArray(tierEntry.cadences) && tierEntry.cadences.includes(9);

const results = {
  zoom_level_present:               !!runtimeState,
  has_breath_class:                 runtimeState?.has_class === true,
  runtime_anim_zl_kf:               runtimeAnimOk,
  css_0_100_triple_axis:            cssKf0_Triple,
  css_50_triple_axis_with_glow:     cssKf50_Triple,
  css_class_binds_9s:               cssClassBound9s,
  css_hover_gate_kept:              cssHoverGate,
  css_reduced_motion_guard:         cssReducedMotion,
  r716_zoom_level_three_axes:       zlTripleInR716,
  r723_at_least_four_entries:       Array.isArray(tripleAxisCatalog) && tripleAxisCatalog.length >= 4,
  r723_zoom_level_entry:            zlInTripleCatalog,
  zoom_level_in_text_shadow_set:    zoomLevelInTextShadowSet,
  six_second_pair_still_intact:     sixSecondPairIntact,
  r726_tier_includes_9s:            !!tierIncludes9,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R727 zoom-level triple-axis breath (4th triple-axis surface, 1st chrome data-tier @ 9s):`,
  JSON.stringify(results, null, 2),
  `\n  ZL R716 entry: ${JSON.stringify(zlDualEntry)}`,
  `\n  ZL R723 entry: ${JSON.stringify(zlTripleEntry)}`,
  `\n  text-shadow surfaces: ${JSON.stringify(textShadowAnchors)}`,
  `\n  R726 tier cadences: ${JSON.stringify(tierEntry?.cadences)}`);
process.exit(ok ? 0 : 1);
