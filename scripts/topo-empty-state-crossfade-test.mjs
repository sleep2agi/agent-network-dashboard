/* Round 222 verification: recent-signal panel empty state always-
 * mounts; visibility crossfades via wrapper <g> opacity instead of
 * conditional mount/unmount on flowLinks.length === 0.
 *
 * Pre-R222 the first flow arriving snap-removed the empty state
 * (R45 + R200) in one frame while R203 rows simultaneously faded
 * IN — half-smooth, half-snap. R222 closes the snap so the empty-
 * to-populated transition crossfades both directions cleanly.
 *
 * Test scenarios:
 *   A. 0 flows (empty):
 *      · wrapper visible='true', opacity=1
 *      · both empty texts present, R200 SMIL <animate> still on
 *      · rows NOT mounted (rows path returns null)
 *   B. 3 flows (populated):
 *      · wrapper visible='false', opacity=0
 *      · both empty texts STILL in DOM (always-mount)
 *      · R200 SMIL <animate> still in place (just invisible due
 *        to parent opacity 0)
 *      · rows present
 *   Both: inline transition includes 'opacity 300ms'
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function setup(messages) {
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
  await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages } }));
  await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForSelector('[data-recent-signal-empty-wrapper]', { timeout: 10000, state: 'attached' });
  await page.waitForTimeout(400);
  return page;
}

const probe = async (page) => page.evaluate(() => {
  const wrapper = document.querySelector('[data-recent-signal-empty-wrapper]');
  if (!wrapper) return null;
  const cs = getComputedStyle(wrapper);
  const main = wrapper.querySelector('[data-recent-signal-empty]');
  const hint = wrapper.querySelector('[data-recent-signal-empty-hint]');
  const mainAnim = main?.querySelector('animate');
  const hintAnim = hint?.querySelector('animate');
  const rowCount = document.querySelectorAll('[data-recent-row]').length;
  return {
    visible:     wrapper.getAttribute('data-recent-signal-empty-visible'),
    opacity:     parseFloat(cs.opacity),
    transition:  wrapper.style.transition,
    mainPresent: !!main,
    hintPresent: !!hint,
    mainText:    main?.textContent?.trim().split(/\s+/)[0] + ' ' + main?.textContent?.trim().split(/\s+/)[1]
                 + ' ' + main?.textContent?.trim().split(/\s+/)[2],
    mainAnimAttr: mainAnim?.getAttribute('attributeName'),
    hintAnimAttr: hintAnim?.getAttribute('attributeName'),
    rowCount,
  };
});

// Scenario A: 0 flows (empty)
const pageA = await setup([]);
const probeA = await probe(pageA);
await pageA.close();

// Scenario B: 3 flows (populated)
const now = Date.now();
const pageB = await setup([
  { id: '1', from_alias: 'alpha', to_alias: 'beta',  content: 'hi',
    network_id: 'default', created_at: new Date(now - 1000).toISOString() },
  { id: '2', from_alias: 'beta',  to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - 2000).toISOString() },
  { id: '3', from_alias: 'gamma', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - 3000).toISOString() },
]);
const probeB = await probe(pageB);
await pageB.close();
await browser.close();

const results = {
  // Scenario A — empty
  A_present_in_dom:        !!probeA,
  A_visible_true:          probeA?.visible === 'true',
  A_opacity_1:             probeA?.opacity === 1,
  A_main_present:          probeA?.mainPresent === true,
  A_hint_present:          probeA?.hintPresent === true,
  A_main_anim_opacity:     probeA?.mainAnimAttr === 'opacity',
  A_hint_anim_opacity:     probeA?.hintAnimAttr === 'opacity',
  A_no_rows:               probeA?.rowCount === 0,

  // Scenario B — populated (empty still in DOM)
  B_present_in_dom:        !!probeB,
  B_visible_false:         probeB?.visible === 'false',
  B_opacity_0:             probeB?.opacity === 0,
  B_main_still_in_dom:     probeB?.mainPresent === true,
  B_hint_still_in_dom:     probeB?.hintPresent === true,
  B_main_anim_still_on:    probeB?.mainAnimAttr === 'opacity',
  B_hint_anim_still_on:    probeB?.hintAnimAttr === 'opacity',
  B_three_rows:            probeB?.rowCount === 3,

  // Transitions present in both
  A_has_transition:        /opacity\s+(?:300ms|0\.3s)/.test(probeA?.transition || ''),
  B_has_transition:        /opacity\s+(?:300ms|0\.3s)/.test(probeB?.transition || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} empty-state crossfade:`, JSON.stringify(results),
  `\n  probeA (0 flows empty):`, probeA,
  `\n  probeB (3 flows populated):`, probeB);
process.exit(ok ? 0 : 1);
