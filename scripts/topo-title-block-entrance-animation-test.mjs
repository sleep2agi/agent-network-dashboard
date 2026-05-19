/* Round 742 — title-block entrance animation. 2nd member of the
 * entrance family (after R740 canvas root). Staggered choreography:
 *   R740 canvas        0   → 600 ms   scale 0.99 → 1, opacity 0.8 → 1
 *   R742 title-block   200 → 700 ms   translateY -4 → 0, opacity 0.7 → 1
 *
 * Assertions:
 *   - .anet-topo-title-block-entrance class on title-block wrapper
 *   - data-topo-section-titleblock-entrance="true"
 *   - CSS @keyframes 0% translateY(-4px) opacity 0.7 → 100% translateY(0) opacity 1
 *   - .anet-topo-title-block-entrance binds 500ms ease-out 200ms delay
 *   - animation NOT infinite (runtime iteration count === '1')
 *   - prefers-reduced-motion guard present
 *   - Animation completes within ~900ms (200ms delay + 500ms + 200ms buffer)
 *     → after 900ms wait, computed transform is identity & opacity = 1
 *   - Existing R706 envelope-breath class still composed (regression)
 *   - R741 catalog one-shot-mount.members === 2, includes title-block in examples
 *   - R740 canvas entrance still present (regression)
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
await page.waitForSelector('[data-topo-section-titleblock-group]', { timeout: 15000, state: 'attached' });
/* Wait for both R740 (0-600ms) and R742 (200-700ms) animations to
 * complete plus a safety buffer. */
await page.waitForTimeout(900);

const state = await page.evaluate(() => {
  const tb = document.querySelector('[data-topo-section-titleblock-group]');
  const svg = document.querySelector('[data-topo-canvas-aria]');
  if (!tb) return null;
  const cs = getComputedStyle(tb);
  return {
    has_entrance_class:        tb.classList.contains('anet-topo-title-block-entrance'),
    entrance_attr:             tb.getAttribute('data-topo-section-titleblock-entrance'),
    envelope_breath_kept:      tb.classList.contains('anet-topo-title-block-envelope-breath'),
    anim_name:                 cs.animationName,
    anim_duration:             cs.animationDuration,
    anim_delay:                cs.animationDelay,
    anim_iteration:            cs.animationIterationCount,
    computed_transform:        cs.transform,
    computed_opacity:          cs.opacity,
    canvas_entrance_class:     svg?.classList.contains('anet-topo-canvas-entrance') ?? null,
    temporal_modes:            svg?.getAttribute('data-topo-animation-temporal-modes') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKfStart = /@keyframes anet-topo-title-block-entrance-kf\s*\{[\s\S]*?0%\s*\{[\s\S]*?transform:\s*translateY\(-4px\)[\s\S]*?opacity:\s*0\.7/.test(cssSrc);
const cssKfEnd   = /@keyframes anet-topo-title-block-entrance-kf\s*\{[\s\S]*?100%\s*\{[\s\S]*?transform:\s*translateY\(0\)[\s\S]*?opacity:\s*1/.test(cssSrc);
const cssClassBound = /\.anet-topo-title-block-entrance\s*\{[\s\S]*?animation:\s*anet-topo-title-block-entrance-kf\s+500ms\s+ease-out\s+200ms\s+backwards/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-title-block-entrance\s*\{\s*animation:\s*none/.test(cssSrc);

const transformSettled = state?.computed_transform === 'none'
  || state?.computed_transform === 'matrix(1, 0, 0, 1, 0, 0)';
/* The title-block carries TWO animations via the R742 compound:
 *   1. entrance      one-shot, 500ms — settles after ~700ms
 *   2. envelope-breath infinite, 11s — opacity 0.92 ↔ 1 forever (R706)
 * After the entrance completes, opacity is governed by the ongoing
 * envelope breath, so it sits SOMEWHERE in [0.92, 1] — never exactly
 * 1 at a random sample. Assert opacity ∈ [0.90, 1.00] (the R706
 * breath band with a small tolerance) rather than === 1. */
const opacityInBreathBand = (() => {
  const o = parseFloat(state?.computed_opacity ?? '0');
  return o >= 0.90 && o <= 1.0;
})();
/* The compound animation's FIRST entry is the one-shot entrance;
 * the SECOND is the infinite breath. Verify the entrance part is
 * one-shot by checking the first iteration-count token === '1'. */
const entranceIsOneShot = (state?.anim_iteration ?? '').split(',')[0].trim() === '1';
const entranceIsFirstInCompound = (state?.anim_name ?? '').split(',')[0].trim() === 'anet-topo-title-block-entrance-kf';

let modes = null;
try { modes = JSON.parse(state?.temporal_modes ?? ''); } catch {}
const oneShot = Array.isArray(modes) ? modes.find(m => m.mode === 'one-shot-mount') : null;
const oneShotHas2 = oneShot?.members === 2 && Array.isArray(oneShot?.examples) && oneShot.examples.includes('title-block');

const results = {
  has_entrance_class:              state?.has_entrance_class === true,
  entrance_attr_true:              state?.entrance_attr === 'true',
  envelope_breath_kept:            state?.envelope_breath_kept === true,
  css_keyframe_start:              cssKfStart,
  css_keyframe_end:                cssKfEnd,
  css_class_binds_500ms_delay_200: cssClassBound,
  css_reduced_motion_guard:        cssReducedMotion,
  entrance_part_is_one_shot:       entranceIsOneShot,
  entrance_first_in_compound:      entranceIsFirstInCompound,
  transform_settled:               transformSettled,
  opacity_in_breath_band:          opacityInBreathBand,
  r740_canvas_entrance_kept:       state?.canvas_entrance_class === true,
  r741_one_shot_members_now_2:     oneShotHas2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R742 title-block entrance animation (2nd one-shot member, staggered after canvas):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`,
  `\n  one-shot entry: ${JSON.stringify(oneShot)}`);
process.exit(ok ? 0 : 1);
