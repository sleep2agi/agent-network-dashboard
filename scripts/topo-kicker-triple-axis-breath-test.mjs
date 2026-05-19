/* Round 721 — kicker promoted from dual-axis to TRIPLE-axis breath.
 * R699 opacity (6 s) + R714 transform-scale (6 s) joined by R721
 * text-shadow (6 s) — all 3 axes share the 6 s cadence in phase.
 * First triple-axis surface in the family.
 *
 * Glow specification: at mid-breath (50%) the kicker emits
 * text-shadow: 0 0 6px rgba(34, 211, 238, 0.30). Reads as an "inhale
 * glow" — a subtle cyan aura appears as the text dims and shrinks.
 *
 * Assertions:
 *   - CSS keyframes 0%/100% has text-shadow: none
 *   - CSS keyframes 50% has text-shadow: 0 0 6px rgba(34, 211, 238, 0.30)
 *   - existing opacity (1 ↔ 0.78) + transform-scale (1 ↔ 0.995) axes
 *     preserved in same @keyframes block (R699 + R714 still composing)
 *   - .anet-topo-kicker-breath rule still binds 6 s cadence
 *   - prefers-reduced-motion guard still present
 *   - runtime kicker has the breath class + 6s data attr (preserved)
 *   - R716 catalog kicker entry axes = ["opacity", "transform-scale", "text-shadow"]
 *   - kicker is the ONLY entry with 3 axes (first triple-axis surface)
 *   - text-shadow appears nowhere else in the catalog (kicker exclusive)
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
await page.waitForSelector('.anet-topo-kicker-breath', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const kicker = document.querySelector('.anet-topo-kicker-breath');
  if (!kicker) return null;
  const cs = getComputedStyle(kicker);
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    has_class:     kicker.classList.contains('anet-topo-kicker-breath'),
    breath_attr:   kicker.getAttribute('data-topo-section-kicker-breath'),
    anim_name:     cs.animationName,
    anim_duration: cs.animationDuration,
    catalog:       svg?.getAttribute('data-topo-respiratory-dual-axis-surfaces') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
// 0%/100% keyframe must include text-shadow: none + opacity:1 + transform: scale(1)
const cssKf0_Triple = /@keyframes anet-topo-kicker-breath-kf\s*\{[\s\S]*?0%,\s*100%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?transform:\s*scale\(1\)[\s\S]*?text-shadow:\s*none[\s\S]*?\}/.test(cssSrc);
// 50% keyframe must include text-shadow: 0 0 6px rgba(34, 211, 238, 0.30) + dim opacity + retract scale
const cssKf50_Triple = /@keyframes anet-topo-kicker-breath-kf\s*\{[\s\S]*?50%\s*\{[\s\S]*?opacity:\s*0\.78[\s\S]*?transform:\s*scale\(0\.995\)[\s\S]*?text-shadow:\s*0\s+0\s+6px\s+rgba\(34,\s*211,\s*238,\s*0\.30\)/.test(cssSrc);
const cssClassBound6s = /\.anet-topo-kicker-breath\s*\{[\s\S]*?animation:\s*anet-topo-kicker-breath-kf\s+6s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-kicker-breath\s*\{\s*animation:\s*none/.test(cssSrc);

const runtimeAnim = runtimeState?.anim_name === 'anet-topo-kicker-breath-kf' || runtimeState?.anim_name === 'none';

let catalog = null;
try { catalog = JSON.parse(runtimeState?.catalog ?? ''); } catch {}
const kickerEntry = Array.isArray(catalog) ? catalog.find(e => e.anchor === 'kicker') : null;
const kickerTripleAxes = !!kickerEntry
  && Array.isArray(kickerEntry.axes)
  && kickerEntry.axes.length === 3
  && JSON.stringify(kickerEntry.axes) === JSON.stringify(['opacity', 'transform-scale', 'text-shadow']);

const tripleAxisSurfaces = Array.isArray(catalog)
  ? catalog.filter(e => Array.isArray(e.axes) && e.axes.length === 3)
  : [];
const onlyKickerTriple = tripleAxisSurfaces.length === 1 && tripleAxisSurfaces[0]?.anchor === 'kicker';

const textShadowSurfaces = Array.isArray(catalog)
  ? catalog.filter(e => Array.isArray(e.axes) && e.axes.includes('text-shadow'))
  : [];
const textShadowKickerExclusive = textShadowSurfaces.length === 1 && textShadowSurfaces[0]?.anchor === 'kicker';

const results = {
  kicker_present:                   !!runtimeState,
  has_breath_class:                 runtimeState?.has_class === true,
  breath_cadence_attr_6s:           runtimeState?.breath_attr === '6s',
  runtime_anim_kicker_kf:           runtimeAnim,
  css_0_100_triple_axis:            cssKf0_Triple,
  css_50_triple_axis_with_glow:     cssKf50_Triple,
  css_class_binds_6s:               cssClassBound6s,
  css_reduced_motion_guard:         cssReducedMotion,
  catalog_kicker_three_axes:        kickerTripleAxes,
  only_kicker_is_triple_axis:       onlyKickerTriple,
  text_shadow_exclusive_to_kicker:  textShadowKickerExclusive,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R721 kicker triple-axis breath (first 3-axis surface: opacity + transform-scale + text-shadow @ 6s):`,
  JSON.stringify(results, null, 2),
  `\n  kicker entry: ${JSON.stringify(kickerEntry)}`,
  `\n  runtime: ${JSON.stringify({ anim_name: runtimeState?.anim_name, anim_duration: runtimeState?.anim_duration })}`);
process.exit(ok ? 0 : 1);
