/* Round 743 — chrome strip entrance animation. 3rd member of the
 * entrance family, completing the entrance trio. Three-stage cascade:
 *   R740 canvas       0   → 600 ms   scale 0.99→1, opacity 0.8→1
 *   R742 title-block  200 → 700 ms   translateY -4→0, opacity 0.7→1
 *   R743 chrome strip 400 → 900 ms   translateX 8→0, opacity 0.7→1
 *
 * Assertions:
 *   - .anet-topo-chrome-strip-entrance class on [data-topo-chrome]
 *   - data-topo-chrome-entrance="true"
 *   - CSS @keyframes 0% translateX(8px) opacity 0.7 → 100% translateX(0) opacity 1
 *   - .anet-topo-chrome-strip-entrance binds 500ms ease-out 400ms delay
 *   - one-shot (runtime iteration count === '1')
 *   - prefers-reduced-motion guard present
 *   - Animation done within ~1.1s (400ms delay + 500ms + buffer);
 *     after 1100ms computed transform is identity & opacity = 1
 *   - chrome strip wrapper has NO compound animation (single anim) —
 *     anim_name is exactly the entrance keyframe (not comma-joined)
 *   - R741 catalog one-shot-mount.members === 3, includes chrome strip
 *   - R740 + R742 entrance siblings still present (regression)
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
await page.waitForSelector('[data-topo-chrome]', { timeout: 15000, state: 'attached' });
/* Wait past the 400ms delay + 500ms duration + buffer. */
await page.waitForTimeout(1100);

const state = await page.evaluate(() => {
  const chrome = document.querySelector('[data-topo-chrome]');
  const svg = document.querySelector('[data-topo-canvas-aria]');
  const titleBlock = document.querySelector('[data-topo-section-titleblock-group]');
  if (!chrome) return null;
  const cs = getComputedStyle(chrome);
  return {
    has_entrance_class:    chrome.classList.contains('anet-topo-chrome-strip-entrance'),
    entrance_attr:         chrome.getAttribute('data-topo-chrome-entrance'),
    anim_name:             cs.animationName,
    anim_duration:         cs.animationDuration,
    anim_delay:            cs.animationDelay,
    anim_iteration:        cs.animationIterationCount,
    computed_transform:    cs.transform,
    computed_opacity:      cs.opacity,
    canvas_entrance:       svg?.classList.contains('anet-topo-canvas-entrance') ?? null,
    title_block_entrance:  titleBlock?.classList.contains('anet-topo-title-block-entrance') ?? null,
    temporal_modes:        svg?.getAttribute('data-topo-animation-temporal-modes') ?? null,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssKfStart = /@keyframes anet-topo-chrome-strip-entrance-kf\s*\{[\s\S]*?0%\s*\{[\s\S]*?transform:\s*translateX\(8px\)[\s\S]*?opacity:\s*0\.7/.test(cssSrc);
const cssKfEnd   = /@keyframes anet-topo-chrome-strip-entrance-kf\s*\{[\s\S]*?100%\s*\{[\s\S]*?transform:\s*translateX\(0\)[\s\S]*?opacity:\s*1/.test(cssSrc);
const cssClassBound = /\.anet-topo-chrome-strip-entrance\s*\{[\s\S]*?animation:\s*anet-topo-chrome-strip-entrance-kf\s+500ms\s+ease-out\s+400ms\s+backwards/.test(cssSrc);
const cssReducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.anet-topo-chrome-strip-entrance\s*\{\s*animation:\s*none/.test(cssSrc);

const transformSettled = state?.computed_transform === 'none'
  || state?.computed_transform === 'matrix(1, 0, 0, 1, 0, 0)';
const opacitySettled = parseFloat(state?.computed_opacity ?? '0') > 0.99;
const singleAnimation = state?.anim_name === 'anet-topo-chrome-strip-entrance-kf';

let modes = null;
try { modes = JSON.parse(state?.temporal_modes ?? ''); } catch {}
const oneShot = Array.isArray(modes) ? modes.find(m => m.mode === 'one-shot-mount') : null;
const oneShotHas3 = oneShot?.members === 3 && Array.isArray(oneShot?.examples) && oneShot.examples.includes('chrome strip');

const results = {
  has_entrance_class:              state?.has_entrance_class === true,
  entrance_attr_true:              state?.entrance_attr === 'true',
  css_keyframe_start:              cssKfStart,
  css_keyframe_end:                cssKfEnd,
  css_class_binds_500ms_delay_400: cssClassBound,
  css_reduced_motion_guard:        cssReducedMotion,
  runtime_animation_one_shot:      state?.anim_iteration === '1',
  single_animation_no_compound:    singleAnimation,
  transform_settled:               transformSettled,
  opacity_settled_to_1:            opacitySettled,
  r740_canvas_entrance_kept:       state?.canvas_entrance === true,
  r742_title_block_entrance_kept:  state?.title_block_entrance === true,
  r741_one_shot_members_now_3:     oneShotHas3,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R743 chrome strip entrance animation (3rd one-shot member, entrance trio complete):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`,
  `\n  one-shot entry: ${JSON.stringify(oneShot)}`);
process.exit(ok ? 0 : 1);
