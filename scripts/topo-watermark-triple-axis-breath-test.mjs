/* Round 722 — watermark becomes the 2ND triple-axis breath surface.
 * R519 SMIL opacity + R712 SMIL letter-spacing joined by R722 CSS
 * text-shadow — all 3 axes at 6 s in phase. Together with R721 kicker
 * they form the "6 s triple-axis PAIR" — the first multi-member
 * triple-axis structural pattern in the family.
 *
 * Tuning vs kicker: blur 8px (vs 6px), alpha 0.20 (vs 0.30) — wider
 * spread + lower alpha to register at the watermark's quieter base
 * opacity (0.4 from R282) without overpowering.
 *
 * Assertions:
 *   - CSS keyframes 0%/100% has text-shadow: none
 *   - CSS keyframes 50% has text-shadow: 0 0 8px rgba(34, 211, 238, 0.20)
 *   - .anet-topo-brand-watermark-glow-breath rule binds 6s cadence
 *   - prefers-reduced-motion guard present
 *   - runtime watermark <text> has the glow class
 *   - runtime glow-breath data-attr = "6s" (or "false" if reducedMotion)
 *   - existing R519 SMIL opacity animate child still present (regression)
 *   - existing R712 SMIL letter-spacing animate child still present (regression)
 *   - R716 catalog watermark entry axes = ["opacity", "letter-spacing", "text-shadow"]
 *   - 2 surfaces now triple-axis (kicker + watermark) — 6s triple-axis PAIR
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
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const wm = document.querySelector('[data-topo-brand-watermark]');
  if (!wm) return null;
  const cs = getComputedStyle(wm);
  const smilOpacity      = wm.querySelector('animate[attributeName="opacity"]');
  const smilLetterSpace  = wm.querySelector('animate[attributeName="letter-spacing"]');
  const svg = document.querySelector('[data-topo-canvas-aria]');
  return {
    has_glow_class:        wm.classList.contains('anet-topo-brand-watermark-glow-breath'),
    glow_attr:             wm.getAttribute('data-topo-brand-watermark-glow-breath'),
    anim_name:             cs.animationName,
    anim_duration:         cs.animationDuration,
    smil_opacity_present:  !!smilOpacity,
    smil_opacity_dur:      smilOpacity?.getAttribute('dur'),
    smil_letter_present:   !!smilLetterSpace,
    smil_letter_dur:       smilLetterSpace?.getAttribute('dur'),
    catalog:               svg?.getAttribute('data-topo-respiratory-dual-axis-surfaces') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKfNone  = /@keyframes anet-topo-brand-watermark-glow-breath-kf\s*\{[\s\S]*?0%,\s*100%\s*\{[\s\S]*?text-shadow:\s*none/.test(cssSrc);
const cssKfGlow  = /@keyframes anet-topo-brand-watermark-glow-breath-kf\s*\{[\s\S]*?50%\s*\{[\s\S]*?text-shadow:\s*0\s+0\s+8px\s+rgba\(34,\s*211,\s*238,\s*0\.20\)/.test(cssSrc);
const cssClassBound6s = /\.anet-topo-brand-watermark-glow-breath\s*\{[\s\S]*?animation:\s*anet-topo-brand-watermark-glow-breath-kf\s+6s\s+ease-in-out\s+infinite/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-brand-watermark-glow-breath\s*\{\s*animation:\s*none/.test(cssSrc);

const runtimeAnimOk = runtimeState?.anim_name === 'anet-topo-brand-watermark-glow-breath-kf' || runtimeState?.anim_name === 'none';

let catalog = null;
try { catalog = JSON.parse(runtimeState?.catalog ?? ''); } catch {}
const wmEntry = Array.isArray(catalog) ? catalog.find(e => e.anchor === 'watermark') : null;
const wmTripleAxes = !!wmEntry
  && Array.isArray(wmEntry.axes)
  && wmEntry.axes.length === 3
  && JSON.stringify(wmEntry.axes) === JSON.stringify(['opacity', 'letter-spacing', 'text-shadow']);

const tripleAxisSurfaces = Array.isArray(catalog)
  ? catalog.filter(e => Array.isArray(e.axes) && e.axes.length === 3)
  : [];
const tripleAxisAnchorsSorted = tripleAxisSurfaces.map(e => e.anchor).sort();
/* R725 added H2 as a 3rd triple-axis surface at 10 s — the "6 s pair"
 * subset still exists (kicker + watermark @ 6 s), but the catalog
 * has 3 total entries now. Widen the assertion to verify the 6 s
 * pair SUBSET is intact rather than asserting it's the whole set. */
const sixSecondMembers = tripleAxisSurfaces.filter(e => e.cadence_s === 6);
const sixSecondAnchorsSorted = sixSecondMembers.map(e => e.anchor).sort();
const triple6sPair =
  sixSecondMembers.length === 2
  && JSON.stringify(sixSecondAnchorsSorted) === JSON.stringify(['kicker', 'watermark']);

const results = {
  watermark_present:               !!runtimeState,
  has_glow_class:                  runtimeState?.has_glow_class === true,
  glow_attr_6s:                    runtimeState?.glow_attr === '6s',
  runtime_anim_kf:                 runtimeAnimOk,
  css_keyframes_norm_none:         cssKfNone,
  css_keyframes_mid_glow:          cssKfGlow,
  css_class_binds_6s:              cssClassBound6s,
  css_reduced_motion_guard:        cssReducedMotion,
  r519_smil_opacity_kept:          runtimeState?.smil_opacity_present === true && runtimeState?.smil_opacity_dur === '6s',
  r712_smil_letter_kept:           runtimeState?.smil_letter_present === true && runtimeState?.smil_letter_dur === '6s',
  catalog_watermark_three_axes:    wmTripleAxes,
  triple_axis_pair_6s:             triple6sPair,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R722 watermark triple-axis breath (2nd triple-axis surface, 6s triple-axis PAIR with kicker):`,
  JSON.stringify(results, null, 2),
  `\n  watermark entry: ${JSON.stringify(wmEntry)}`,
  `\n  triple-axis surfaces: ${JSON.stringify(tripleAxisAnchorsSorted)}`,
  `\n  runtime: ${JSON.stringify({ anim_name: runtimeState?.anim_name, anim_duration: runtimeState?.anim_duration, smil_opacity: runtimeState?.smil_opacity_dur, smil_letter: runtimeState?.smil_letter_dur })}`);
process.exit(ok ? 0 : 1);
