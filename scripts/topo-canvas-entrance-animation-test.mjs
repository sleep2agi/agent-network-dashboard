/* Round 740 — one-time canvas entrance animation. Plays on first
 * paint, then the canvas sits at scale(1) opacity(1) for the rest of
 * the session. Distinct from breath (infinite rest-axis) and ambient
 * (infinite sweep-axis) — R740 is ONE-SHOT.
 *
 * Assertions:
 *   - .anet-topo-canvas-entrance class on root <svg> (reducedMotion off)
 *   - data-topo-canvas-entrance="true" attribute
 *   - CSS @keyframes 0% scale(0.99) opacity 0.8 → 100% scale(1) opacity 1
 *   - .anet-topo-canvas-entrance binds 600ms ease-out animation
 *   - CSS animation NOT infinite (no `infinite` keyword) — one-shot
 *   - transform-origin: 50% 50%
 *   - prefers-reduced-motion guard present
 *   - Animation completes within ~1s (test waits 1.2s after mount,
 *     then verifies computed transform is identity matrix)
 *   - Existing canvas className tokens (w-full h-auto block) preserved
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

/* Wait past the 600ms animation duration so computed transform settles
 * to the final state (scale(1)). */
await page.waitForTimeout(1200);

const state = await page.evaluate(() => {
  const svg = document.querySelector('[data-topo-canvas-aria]');
  if (!svg) return null;
  const cs = getComputedStyle(svg);
  return {
    has_entrance_class:  svg.classList.contains('anet-topo-canvas-entrance'),
    entrance_attr:       svg.getAttribute('data-topo-canvas-entrance'),
    class_attr:          svg.getAttribute('class'),
    anim_name:           cs.animationName,
    anim_duration:       cs.animationDuration,
    anim_iteration:      cs.animationIterationCount,
    transform_origin:    cs.transformOrigin,
    computed_transform:  cs.transform,
    computed_opacity:    cs.opacity,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKfStart = /@keyframes anet-topo-canvas-entrance-kf\s*\{[\s\S]*?0%\s*\{[\s\S]*?transform:\s*scale\(0\.99\)[\s\S]*?opacity:\s*0\.8/.test(cssSrc);
const cssKfEnd   = /@keyframes anet-topo-canvas-entrance-kf\s*\{[\s\S]*?100%\s*\{[\s\S]*?transform:\s*scale\(1\)[\s\S]*?opacity:\s*1/.test(cssSrc);
const cssClassBound = /\.anet-topo-canvas-entrance\s*\{[\s\S]*?animation:\s*anet-topo-canvas-entrance-kf\s+600ms\s+ease-out/.test(cssSrc);
/* The CSS source regex was too broad (matched `infinite` in OTHER
 * class blocks past this one). Verify one-shot directly via the
 * runtime computed animation-iteration-count — this is the property
 * that actually determines whether the animation replays. */
const runtimeOneShot = state?.anim_iteration === '1';
const cssTransformOrigin = /\.anet-topo-canvas-entrance\s*\{[\s\S]*?transform-origin:\s*50%\s+50%/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-canvas-entrance\s*\{\s*animation:\s*none/.test(cssSrc);

/* After 1.2s the animation should have completed; computed transform
 * should be identity-matrix (scale 1). matrix(1, 0, 0, 1, 0, 0) === 'none'
 * in some browsers; accept either. */
const transformSettled = state?.computed_transform === 'none'
  || state?.computed_transform === 'matrix(1, 0, 0, 1, 0, 0)';

const opacitySettled = parseFloat(state?.computed_opacity ?? '0') > 0.99;

const classKept = typeof state?.class_attr === 'string'
  && state.class_attr.includes('w-full')
  && state.class_attr.includes('h-auto')
  && state.class_attr.includes('block')
  && state.class_attr.includes('anet-topo-canvas-entrance');

const results = {
  has_entrance_class:               state?.has_entrance_class === true,
  entrance_attr_true:               state?.entrance_attr === 'true',
  original_classes_preserved:       classKept,
  css_keyframe_start:               cssKfStart,
  css_keyframe_end:                 cssKfEnd,
  css_class_binds_600ms_ease_out:   cssClassBound,
  runtime_animation_one_shot:       runtimeOneShot,
  css_transform_origin_center:      cssTransformOrigin,
  css_reduced_motion_guard:         cssReducedMotion,
  transform_settled_to_identity:    transformSettled,
  opacity_settled_to_1:             opacitySettled,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R740 one-time canvas entrance animation (scale 0.99→1 + opacity 0.8→1 @ 600ms ease-out, one-shot):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`);
process.exit(ok ? 0 : 1);
