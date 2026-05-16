/* Round 265 verification: canvas top-rail gradient gains theme-toggle
 * transition — closes the last canvas-envelope theme-snap.
 *
 * Pre-R265 the top-rail was:
 *   <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${pal.topRailGradient}`} />
 *
 * pal.topRailGradient is theme-conditional:
 *   cyber: 'from-transparent via-cyan-400/70 to-transparent'
 *   light: 'from-transparent via-emerald-500/40 to-transparent'
 *
 * On theme toggle the className swap changes the gradient color but no
 * inline transition existed — so the 1px-tall bright line at the
 * canvas top edge SNAPPED while the wrapper bg (R254), border (R254),
 * and shadow (R263) all eased. Small visible holdover.
 *
 * R265 adds `transition: background-image 200ms ease-out`. CSS
 * gradient interpolation works on browsers ≥ Chrome 89 / Safari 14.1 /
 * FF 96 when both gradients share matching stop structure — both
 * gradients here are `from-transparent via-X to-transparent`
 * (identical 3-stop layout).
 *
 * Test scope:
 *   1. Top-rail element present at `[data-topo-top-rail]`.
 *   2. Inline transition contains `background-image` at 200ms (or 0.2s).
 *   3. Computed backgroundImage is a non-empty linear-gradient (not
 *      'none' / empty — confirms the className gradient applied).
 *   4. R263 wrapper box-shadow transition still in place (regression).
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-top-rail]', { timeout: 10000 });
await page.waitForSelector('[data-topo-wrapper]',  { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const rail    = document.querySelector('[data-topo-top-rail]');
  const wrapper = document.querySelector('[data-topo-wrapper]');
  return {
    railTransition:      rail    ? rail.style.transition                                    : null,
    railBackgroundImage: rail    ? window.getComputedStyle(rail).backgroundImage            : null,
    wrapperTransition:   wrapper ? wrapper.style.transition                                 : null,
  };
});
await browser.close();

const has = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  rail_present:                         probe.railTransition !== null,
  rail_transition_has_bg_image_200:     has(probe.railTransition, 'background-image'),
  rail_has_non_empty_gradient:          probe.railBackgroundImage != null
                                        && probe.railBackgroundImage !== 'none'
                                        && probe.railBackgroundImage.includes('linear-gradient'),
  r263_wrapper_has_box_shadow_200:      has(probe.wrapperTransition, 'box-shadow'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} top-rail theme ease:`, JSON.stringify(results),
  '\n  rail transition:        ', probe.railTransition,
  '\n  rail backgroundImage:   ', probe.railBackgroundImage,
  '\n  wrapper transition:     ', probe.wrapperTransition);
process.exit(ok ? 0 : 1);
