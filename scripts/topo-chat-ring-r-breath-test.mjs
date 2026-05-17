/* Round 640 — chat-target ring gains a THIRD breath axis: radius.
 * r=radius+14 ↔ radius+14.5 over 3s, in lockstep with R120 opacity
 * + R630 stroke-width breaths. Three concurrent SMIL animates run
 * through the same fragment gate.
 *
 * Test phases:
 *   1. mock 2 idle nodes
 *   2. rest (no chat): chat-target ring exists, no <animate>
 *      children; r-breath attr 'off'
 *   3. click a node to open chat → ring becomes chat target →
 *      3 <animate> children: opacity, stroke-width, r — all
 *      dur='3s', repeatCount='indefinite'
 *   4. r animate values = `${radius+14};${radius+14.5};${radius+14}`
 *   5. source: new <animate attributeName="r"> sibling inside the
 *      same fragment gate
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

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-chat-target-ring]');
  if (!el) return null;
  return {
    rBreath: el.getAttribute('data-chat-target-ring-r-breath'),
    active: el.getAttribute('data-chat-target-active'),
    animateCount: el.querySelectorAll('animate').length,
  };
});

// Open chat with a·1
await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const active = await page.evaluate(() => {
  const node = document.querySelector('[data-node="a·1"]');
  if (!node) return null;
  const ring = node.querySelector('[data-chat-target-ring]');
  if (!ring) return null;
  const animates = Array.from(ring.querySelectorAll('animate'));
  return {
    rBreath: ring.getAttribute('data-chat-target-ring-r-breath'),
    swBreath: ring.getAttribute('data-chat-target-ring-sw-breath'),
    breath: ring.getAttribute('data-chat-target-breath'),
    active: ring.getAttribute('data-chat-target-active'),
    rAttr: ring.getAttribute('r'),
    animateCount: animates.length,
    animateAttrs: animates.map(a => ({
      attr: a.getAttribute('attributeName'),
      dur:  a.getAttribute('dur'),
      vals: a.getAttribute('values'),
      rep:  a.getAttribute('repeatCount'),
    })),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRAnimate = /<animate\s+attributeName="r"\s+values=\{`\$\{radius \+ 14\};\$\{radius \+ 14\.5\};\$\{radius \+ 14\}`\}\s+dur="3s"\s+repeatCount="indefinite"\s*\/>/.test(src);
const sourceRBreathAttr = /data-chat-target-ring-r-breath=\{!reducedMotion && isChat \? 'on' : 'off'\}/.test(src);

const rAnimate = active?.animateAttrs?.find(a => a.attr === 'r');
const opAnimate = active?.animateAttrs?.find(a => a.attr === 'opacity');
const swAnimate = active?.animateAttrs?.find(a => a.attr === 'stroke-width');

const results = {
  rest_ring_present:        !!rest,
  rest_r_breath_off:        rest?.rBreath === 'off',
  rest_no_animate:          rest?.animateCount === 0,
  active_ring_present:      !!active,
  active_r_breath_on:       active?.rBreath === 'on',
  active_sw_breath_on:      active?.swBreath === 'on',
  active_breath_on:         active?.breath === 'on',
  active_animate_count_3:   active?.animateCount === 3,
  active_has_r:             rAnimate != null,
  active_has_opacity:       opAnimate != null,
  active_has_stroke_width:  swAnimate != null,
  active_r_dur_3s:          rAnimate?.dur === '3s',
  active_r_rep_indef:       rAnimate?.rep === 'indefinite',
  // r animate values include radius+14 + radius+14.5 (radius is per-node-tier-dependent)
  active_r_values_format:   /^[\d.]+;[\d.]+;[\d.]+$/.test(rAnimate?.vals || ''),
  source_r_animate:         sourceRAnimate,
  source_r_breath_attr:     sourceRBreathAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R640 chat-target ring radius breath (3-axis 呼吸感: opacity + sw + r):`,
  JSON.stringify(results, null, 2),
  `\n  rest:   ${JSON.stringify(rest)}`,
  `\n  active: ${JSON.stringify(active)}`);
process.exit(ok ? 0 : 1);
