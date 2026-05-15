/* Round 194 verification: node label card picks up drop-shadow
 * elevation that intensifies on node hover, mirroring R135's panel
 * hover-elevation but at per-node grain.
 *
 * Pre-R194 the card lifted 1.5 px on hover (R26) but had no shadow
 * follow — the elevation gesture lacked physical weight. R194 adds
 *   rest  : drop-shadow(0 1px 2px rgba(...,0.30 dark / 0.08 light))
 *   hover : drop-shadow(0 4px 12px rgba(0,0,0,0.60) dark
 *           / 0 3px 8px rgba(15,23,42,0.20) light)
 * with transition: filter 220ms ease-out.
 *
 * Test (cyber/dark theme, 4 sessions = card mode):
 *   1. data-node-label-card present + matches alias
 *   2. Idle elevation attr = 'idle'
 *   3. Idle filter style includes 'drop-shadow' (rest shadow on)
 *   4. Idle blur radius is small (1-2 px range)
 *   5. transition: filter 220ms ease-out
 *   6. Hover the node — wait past 250ms
 *   7. data-node-label-card-elevation flips to 'hover'
 *   8. Hover filter has bigger blur (>= 8px) — drop-shadow strengthened
 *   9. Other (non-hovered) cards stay 'idle'
 *  10. Unhover — flips back to 'idle'
 *  11. Filter transition string still present after settle
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
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-node-label-card]', { timeout: 10000 });
await page.waitForTimeout(400);

// Probe idle state of alpha's label card
const idleAlpha = await page.evaluate(() => {
  const el = document.querySelector('[data-node-label-card="alpha"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    alias:      el.getAttribute('data-node-label-card'),
    elevation:  el.getAttribute('data-node-label-card-elevation'),
    filter:     cs.filter,
    transition: cs.transitionProperty + ' / ' + cs.transitionDuration,
    inlineFilter: el.style.filter,
  };
});

// Hover the alpha node's <g> wrapper
await page.hover('g[data-node="alpha"]');
await page.waitForTimeout(280);  // past 220ms transition

const hoveredAlpha = await page.evaluate(() => {
  const el = document.querySelector('[data-node-label-card="alpha"]');
  const cs = getComputedStyle(el);
  return {
    elevation: el.getAttribute('data-node-label-card-elevation'),
    filter:    cs.filter,
    inlineFilter: el.style.filter,
  };
});

// Probe non-hovered card (beta) stays idle
const idleBeta = await page.evaluate(() => {
  const el = document.querySelector('[data-node-label-card="beta"]');
  return {
    elevation: el.getAttribute('data-node-label-card-elevation'),
  };
});

// Move away, wait for transition back
await page.mouse.move(0, 0);
await page.waitForTimeout(280);

const settledAlpha = await page.evaluate(() => {
  const el = document.querySelector('[data-node-label-card="alpha"]');
  const cs = getComputedStyle(el);
  return {
    elevation:  el.getAttribute('data-node-label-card-elevation'),
    filter:     cs.filter,
    transition: cs.transitionProperty + ' / ' + cs.transitionDuration,
  };
});

await browser.close();

// Parse blur radius out of drop-shadow(). Chrome's getComputedStyle
// canonicalises into `drop-shadow(rgba(...) 0px Ypx BLURpx)` with the
// color first — the standard write-order `drop-shadow(0 Ypx BLURpx
// rgba(...))` is rearranged. So scan all numeric tokens inside the
// drop-shadow() parens with rgba/hsla content stripped first; blur is
// the 3rd numeric value.
function parseShadowBlur(filterStr) {
  if (!filterStr) return null;
  const m = filterStr.match(/drop-shadow\(([\s\S]+)\)\s*$/);
  if (!m) return null;
  const stripped = m[1].replace(/(rgba?|hsla?)\([^)]*\)/g, '');
  const nums = (stripped.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  return nums.length >= 3 ? Math.abs(nums[2]) : null;
}
const idleBlur = parseShadowBlur(idleAlpha?.filter);
const hoverBlur = parseShadowBlur(hoveredAlpha?.filter);
const settledBlur = parseShadowBlur(settledAlpha?.filter);

const results = {
  card_present:          !!idleAlpha,
  alias_matches:         idleAlpha?.alias === 'alpha',
  idle_elevation_attr:   idleAlpha?.elevation === 'idle',
  idle_has_dropshadow:   (idleAlpha?.filter || '').includes('drop-shadow'),
  idle_blur_small:       idleBlur !== null && idleBlur > 0 && idleBlur <= 3,
  filter_transition:     idleAlpha?.transition.includes('filter') && idleAlpha?.transition.includes('0.22s'),

  hover_elevation_attr:  hoveredAlpha?.elevation === 'hover',
  hover_has_dropshadow:  (hoveredAlpha?.filter || '').includes('drop-shadow'),
  hover_blur_larger:     hoverBlur !== null && hoverBlur >= 8,
  hover_blur_grew:       idleBlur !== null && hoverBlur !== null && hoverBlur > idleBlur,
  hover_filter_changed:  idleAlpha?.filter !== hoveredAlpha?.filter,

  beta_stays_idle:       idleBeta?.elevation === 'idle',

  settled_back_to_idle:  settledAlpha?.elevation === 'idle',
  settled_blur_small:    settledBlur !== null && settledBlur <= 3,
  settled_keeps_transition: settledAlpha?.transition.includes('filter'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node label card elevation:`, JSON.stringify(results),
  `\n  idleAlpha:`,     idleAlpha,
  `\n  hoveredAlpha:`,  hoveredAlpha,
  `\n  idleBeta:`,      idleBeta,
  `\n  settledAlpha:`,  settledAlpha,
  `\n  blurs:`,         { idleBlur, hoverBlur, settledBlur });
process.exit(ok ? 0 : 1);
