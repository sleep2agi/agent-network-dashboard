/* Round 631 — click-ripple gains a THIRD animate axis:
 * stroke-width 2 → 0.5 over 500ms with the same R227 ease-out
 * keySplines as r + opacity. Reads as a real-water-ripple thinning
 * wavefront instead of a constant-thickness expanding line.
 *
 * Test phases:
 *   1. mock 2 nodes → no ripple at rest, no [data-click-ripple]
 *   2. click a node → ripple mounts with 3 <animate> children:
 *      - r       (R14/R227)
 *      - opacity (R227/R403)
 *      - stroke-width (R631 — this round)
 *      all dur=0.5s, calcMode=spline, keySplines='0.25 0.1 0.25 1',
 *      fill=freeze
 *   3. ripple disappears after ~600ms (setClickRipple→null timeout)
 *   4. source: stroke-width animate sits as a sibling of the opacity
 *      animate inside the [data-click-ripple] <circle>
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
await page.waitForSelector('[data-node="a·1"]', { timeout: 15000 });
await page.waitForTimeout(500);

// 1. rest: no ripple
const restRipple = await page.evaluate(() => !!document.querySelector('[data-click-ripple]'));

// 2. click node — ripple mounts
await page.click('[data-node="a·1"]', { force: true });
// poll quickly to catch the ripple before it self-cleans
let activeState = null;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(40);
  const s = await page.evaluate(() => {
    const el = document.querySelector('[data-click-ripple]');
    if (!el) return null;
    const animates = Array.from(el.querySelectorAll('animate'));
    return {
      strokeWidth: el.getAttribute('stroke-width'),
      animateCount: animates.length,
      animateAttrs: animates.map(a => ({
        attr:  a.getAttribute('attributeName'),
        dur:   a.getAttribute('dur'),
        vals:  a.getAttribute('values'),
        calc:  a.getAttribute('calcMode'),
        spl:   a.getAttribute('keySplines'),
        fill:  a.getAttribute('fill'),
      })),
    };
  });
  if (s) { activeState = s; break; }
}

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceSwAnimate = /<animate\s+attributeName="stroke-width"\s+values="2;0\.5"\s+dur="0\.5s"\s+calcMode="spline"\s+keyTimes="0;1"\s+keySplines="0\.25 0\.1 0\.25 1"\s+fill="freeze"/.test(src);
const sourceSwAttrs = /data-click-ripple-stroke-width-start="2"\s+data-click-ripple-stroke-width-end="0\.5"/.test(src);

const swAnimate = activeState?.animateAttrs?.find(a => a.attr === 'stroke-width');
const rAnimate  = activeState?.animateAttrs?.find(a => a.attr === 'r');
const opAnimate = activeState?.animateAttrs?.find(a => a.attr === 'opacity');

const results = {
  rest_no_ripple:           restRipple === false,
  active_ripple_present:    activeState != null,
  active_3_animates:        activeState?.animateCount === 3,
  active_has_r:             rAnimate != null,
  active_has_opacity:       opAnimate != null,
  active_has_sw:            swAnimate != null,
  active_sw_values:         swAnimate?.vals === '2;0.5',
  active_sw_dur:            swAnimate?.dur === '0.5s',
  active_sw_spline_easeout: swAnimate?.spl === '0.25 0.1 0.25 1',
  active_sw_calc_spline:    swAnimate?.calc === 'spline',
  active_sw_fill_freeze:    swAnimate?.fill === 'freeze',
  source_sw_animate:        sourceSwAnimate,
  source_sw_attrs:          sourceSwAttrs,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R631 click-ripple stroke-width thinning (3-axis ripple):`,
  JSON.stringify(results, null, 2),
  `\n  active: ${JSON.stringify(activeState)}`);
process.exit(ok ? 0 : 1);
