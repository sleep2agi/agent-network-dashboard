/* Round 630 — chat-target ring gains a SECOND breath axis:
 * stroke-width 2.5↔2.75 over 3s, in lockstep with the existing
 * R120 opacity breath (0.72↔0.95 / 0.82↔1.0). Doubles the 呼吸感
 * — the ring "swells" as it brightens, then settles as it dims.
 * Gated `!reducedMotion && isChat`. R51 sentinel-safe (sw range
 * [2.5, 2.75] stays clear of reserved {1.5, 3}).
 *
 * Test phases:
 *   1. mock 2 nodes → no chat: chat-target ring opacity=0,
 *      sw-breath attr 'off', NO <animate> children
 *   2. click a node → opens ChatPopover for that alias →
 *      chat-target ring becomes isChat → sw-breath attr 'on',
 *      TWO <animate> children present (one opacity + one
 *      stroke-width, both dur='3s' repeatCount='indefinite')
 *   3. source: stroke-width animate uses values '2.5;2.75;2.5'
 *      and sits inside the same `!reducedMotion && isChat`
 *      gate as the opacity animate
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
await page.waitForSelector('[data-chat-target-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  const el = document.querySelector('[data-chat-target-ring]');
  if (!el) return null;
  return {
    active: el.getAttribute('data-chat-target-active'),
    breath: el.getAttribute('data-chat-target-breath'),
    swBreath: el.getAttribute('data-chat-target-ring-sw-breath'),
    animateCount: el.querySelectorAll('animate').length,
  };
});

// Click a node to open chat → that node's chat-target ring activates
await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const activeState = await page.evaluate(() => {
  // Find the chat-target ring of node a·1 — it's inside g[data-node="a·1"]
  const node = document.querySelector('[data-node="a·1"]');
  if (!node) return null;
  const ring = node.querySelector('[data-chat-target-ring]');
  if (!ring) return null;
  const animates = Array.from(ring.querySelectorAll('animate'));
  return {
    active:  ring.getAttribute('data-chat-target-active'),
    breath:  ring.getAttribute('data-chat-target-breath'),
    swBreath: ring.getAttribute('data-chat-target-ring-sw-breath'),
    animateCount: animates.length,
    animateAttrs: animates.map(a => ({
      attr:  a.getAttribute('attributeName'),
      dur:   a.getAttribute('dur'),
      vals:  a.getAttribute('values'),
      rep:   a.getAttribute('repeatCount'),
    })),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceSwAnimate = /<animate\s+attributeName="stroke-width"\s+values="2\.5;2\.75;2\.5"\s+dur="3s"\s+repeatCount="indefinite"\s*\/>/.test(src);
const sourceSwAttr = /data-chat-target-ring-sw-breath=\{!reducedMotion && isChat \? 'on' : 'off'\}/.test(src);
// Ensure both animates sit inside the same `!reducedMotion && isChat &&` gate
const sourceFragmentGate = /\{!reducedMotion && isChat && \(\s*<>\s*<animate\s+attributeName="opacity"[\s\S]*?<animate\s+attributeName="stroke-width"/.test(src);

const swAnimate = activeState?.animateAttrs?.find(a => a.attr === 'stroke-width');
const opAnimate = activeState?.animateAttrs?.find(a => a.attr === 'opacity');

const results = {
  rest_ring_present:      !!restState,
  rest_active_false:      restState?.active === 'false',
  rest_breath_off:        restState?.breath === 'off',
  rest_sw_breath_off:     restState?.swBreath === 'off',
  rest_no_animate:        restState?.animateCount === 0,
  active_active_true:     activeState?.active === 'true',
  active_breath_on:       activeState?.breath === 'on',
  active_sw_breath_on:    activeState?.swBreath === 'on',
  active_animate_count_2: activeState?.animateCount === 2,
  active_sw_dur_3s:       swAnimate?.dur === '3s',
  active_sw_values:       swAnimate?.vals === '2.5;2.75;2.5',
  active_sw_rep_indef:    swAnimate?.rep === 'indefinite',
  active_op_dur_3s:       opAnimate?.dur === '3s',  // existing R120 still present
  source_sw_animate:      sourceSwAnimate,
  source_sw_attr:         sourceSwAttr,
  source_fragment_gate:   sourceFragmentGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R630 chat-target ring stroke-width breath (呼吸感 2nd axis):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`,
  `\n  active: ${JSON.stringify(activeState)}`);
process.exit(ok ? 0 : 1);
