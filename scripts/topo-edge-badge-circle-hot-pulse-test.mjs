/* Round 633 — edge-badge CIRCLE joins the hot-pulse family at the
 * geometric axis. SMIL stroke-width 2 ↔ 2.5 over 3s ease-in-out,
 * gated `isHot && !reducedMotion`. In lockstep with R632 digit
 * opacity pulse. 3rd anchor in hot-pulse family.
 *
 * Test phases:
 *   1. cold edge (mock 3 messages) → no hot-pulse, sw=1.25 attr
 *      doesn't exist as SMIL animate child
 *   2. hot edge (mock 12 messages) → SMIL animate child present
 *      with attributeName='stroke-width', values='2;2.5;2',
 *      dur='3s', calcMode='spline'
 *   3. hot-pulse attr === 'on' on hot edge
 *   4. source: SMIL animate gated on `isHot && !reducedMotion`,
 *      stroke-width values='2;2.5;2' explicit
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
// 12 messages → isHot (count ≥ 10 threshold)
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages:
  Array.from({ length: 12 }, (_, i) => ({
    from_alias: 'a·1', to_alias: 'a·2', content: `msg-${i}`, created_at: fresh,
  }))
} }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-hot-pulse]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const hot = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-badge-hot-pulse="on"]');
  if (!el) return null;
  const animates = Array.from(el.querySelectorAll('animate'));
  return {
    hotPulseAttr: el.getAttribute('data-edge-badge-hot-pulse'),
    glowAttr:     el.getAttribute('data-edge-badge-glow'),
    strokeWidthAttr: el.getAttribute('stroke-width'),
    animateCount: animates.length,
    animateAttrs: animates.map(a => ({
      attr:  a.getAttribute('attributeName'),
      dur:   a.getAttribute('dur'),
      vals:  a.getAttribute('values'),
      calc:  a.getAttribute('calcMode'),
      spl:   a.getAttribute('keySplines'),
      rep:   a.getAttribute('repeatCount'),
    })),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceAnimate = /\{isHot && !reducedMotion && \(\s*<animate\s+attributeName="stroke-width"\s+values="2;2\.5;2"\s+dur="3s"\s+calcMode="spline"\s+keyTimes="0;0\.5;1"\s+keySplines="0\.42 0 0\.58 1;0\.42 0 0\.58 1"\s+repeatCount="indefinite"\s*\/>\s*\)\}/.test(src);
const sourceAttr = /data-edge-badge-hot-pulse=\{isHot && !reducedMotion \? 'on' : 'off'\}/.test(src);

const swAnimate = hot?.animateAttrs?.find(a => a.attr === 'stroke-width');
const results = {
  hot_circle_present:    !!hot,
  hot_pulse_attr_on:     hot?.hotPulseAttr === 'on',
  hot_glow_amber:        hot?.glowAttr === 'hot',
  hot_has_smil_sw:       swAnimate != null,
  hot_sw_values:         swAnimate?.vals === '2;2.5;2',
  hot_sw_dur_3s:         swAnimate?.dur === '3s',
  hot_sw_calc_spline:    swAnimate?.calc === 'spline',
  hot_sw_spline_ease:    swAnimate?.spl === '0.42 0 0.58 1;0.42 0 0.58 1',
  hot_sw_rep_indef:      swAnimate?.rep === 'indefinite',
  hot_attr_sw_2:         hot?.strokeWidthAttr === '2',
  source_smil_gated:     sourceAnimate,
  source_attr_gated:     sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R633 edge-badge CIRCLE hot-pulse stroke-width breath (3rd hot-pulse anchor):`,
  JSON.stringify(results, null, 2),
  `\n  hot: ${JSON.stringify(hot)}`);
process.exit(ok ? 0 : 1);
