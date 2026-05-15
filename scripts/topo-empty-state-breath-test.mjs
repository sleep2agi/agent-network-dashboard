/* Round 200 verification (milestone): recent-signal panel empty-
 * state texts breathe in opacity. The two lines "no flow yet" and
 * "send a message between agents" each get a SMIL <animate> child
 * cycling opacity ~0.55 ↔ 0.78 (main) and 0.36 ↔ 0.58 (sub) over
 * 4.4s. Sub-line is phase-shifted -1.5s so the two read as
 * inhale-exhale, not synchronised pulse.
 *
 * Pre-R200 both texts sat at fixed opacity 0.65 / 0.45 — visually
 * identical to "frozen" or "broken" first-impression. Slow breath
 * = "waiting, listening" while staying calm.
 *
 * Test:
 *   1. Mock 0 messages → flowLinks.length === 0 → empty state fires.
 *   2. data-recent-signal-empty + data-recent-signal-empty-hint
 *      both present.
 *   3. data-recent-signal-empty-breathes='true'
 *      data-recent-signal-empty-hint-breathes='true'
 *   4. Both texts contain an <animate> child with:
 *      - attributeName='opacity'
 *      - dur='4.4s'
 *      - repeatCount='indefinite'
 *      - values cover a range (not a single value)
 *   5. Sub-line <animate> has begin='-1.5s' (phase-shift).
 *   6. Main <animate> begin is unset / '0s' (no phase shift).
 *   7. Captured opacity values shift over time (sample twice, ~2s
 *      apart): same element should produce different rendered
 *      opacity values because SMIL is animating.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
// 0 messages → empty state fires
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-signal-empty]', { timeout: 10000 });
await page.waitForTimeout(300);

const probeStructure = async () => page.evaluate(() => {
  const main = document.querySelector('[data-recent-signal-empty]');
  const sub  = document.querySelector('[data-recent-signal-empty-hint]');
  function pickAnim(textEl) {
    if (!textEl) return null;
    const a = textEl.querySelector('animate');
    if (!a) return { found: false };
    return {
      found:       true,
      attribute:   a.getAttribute('attributeName'),
      values:      a.getAttribute('values'),
      dur:         a.getAttribute('dur'),
      begin:       a.getAttribute('begin'),
      repeatCount: a.getAttribute('repeatCount'),
    };
  }
  return {
    mainText:    main?.textContent?.trim(),
    mainBreathes:main?.getAttribute('data-recent-signal-empty-breathes'),
    mainAnim:    pickAnim(main),
    subText:     sub?.textContent?.trim(),
    subBreathes: sub?.getAttribute('data-recent-signal-empty-hint-breathes'),
    subAnim:     pickAnim(sub),
  };
});

const s = await probeStructure();

// Sample rendered opacity twice ~2s apart to verify SMIL is actually
// animating in the browser, not just declared.
async function sampleOpacities() {
  return page.evaluate(() => {
    const main = document.querySelector('[data-recent-signal-empty]');
    const sub  = document.querySelector('[data-recent-signal-empty-hint]');
    // SMIL renders into the SVG-internal opacity (DOM attr stays
    // static at the React-rendered value; computed style reads the
    // animated current value).
    return {
      mainComputed: parseFloat(getComputedStyle(main).opacity),
      subComputed:  parseFloat(getComputedStyle(sub).opacity),
    };
  });
}
const sample1 = await sampleOpacities();
await page.waitForTimeout(2000);
const sample2 = await sampleOpacities();

await browser.close();

const parseValues = (v) => (v || '').split(/[;,]/).map(parseFloat).filter(Number.isFinite);
const mainVals = parseValues(s.mainAnim?.values);
const subVals  = parseValues(s.subAnim?.values);

const results = {
  empty_state_visible:           s.mainText === 'no flow yet',
  hint_visible:                  s.subText === 'send a message between agents',
  main_breathes_attr:            s.mainBreathes === 'true',
  hint_breathes_attr:            s.subBreathes === 'true',

  main_anim_found:               s.mainAnim?.found === true,
  main_anim_opacity:             s.mainAnim?.attribute === 'opacity',
  main_anim_dur_4p4s:            s.mainAnim?.dur === '4.4s',
  main_anim_indefinite:          s.mainAnim?.repeatCount === 'indefinite',
  main_anim_values_range:        mainVals.length >= 3 && (Math.max(...mainVals) - Math.min(...mainVals)) > 0.1,
  main_anim_no_phase_shift:      !s.mainAnim?.begin || s.mainAnim?.begin === '0s' || s.mainAnim?.begin === '',

  sub_anim_found:                s.subAnim?.found === true,
  sub_anim_opacity:              s.subAnim?.attribute === 'opacity',
  sub_anim_dur_4p4s:             s.subAnim?.dur === '4.4s',
  sub_anim_phase_shift:          s.subAnim?.begin === '-1.5s',
  sub_anim_values_range:         subVals.length >= 3 && (Math.max(...subVals) - Math.min(...subVals)) > 0.1,

  // SMIL actually animates — sampling at different cycle phases yields
  // different rendered opacities. With 4.4s period and 2s gap, the two
  // samples are at distinct phases and should diverge by at least 0.04
  // unless we landed on symmetric cycle points (extremely rare given
  // mock timing variance — re-check loose bound).
  main_opacity_animating:        Math.abs(sample1.mainComputed - sample2.mainComputed) > 0.02,
  sub_opacity_animating:         Math.abs(sample1.subComputed - sample2.subComputed) > 0.02,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} empty-state breath:`, JSON.stringify(results),
  `\n  structure:`, s,
  `\n  sample1:`, sample1,
  `\n  sample2:`, sample2);
process.exit(ok ? 0 : 1);
