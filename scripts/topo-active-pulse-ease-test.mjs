/* Round 243 verification: active-node pulse ring gets two polishes
 * on a single element:
 *
 *   1. Always-mount-opacity-gate wrapper <g> — pulse stays in DOM
 *      for all online nodes (when reducedMotion is off); isActive
 *      flips wrapper opacity 1 ↔ 0 with 300ms ease-out, instead of
 *      conditional mount that snap-restarted SMIL from phase 0.
 *
 *   2. SMIL ease-in-out keySplines on both r + opacity animates —
 *      the breath rises and settles at both endpoints instead of
 *      linear constant-velocity interp.
 *
 * Scenario: 4 working agents + 5-msg alpha→beta flow.
 *   activeAliases = {alpha, beta} (active=true)
 *   gamma, delta = active=false
 *
 * Test scope per node:
 *   - [data-node-pulse] always present (4 pulses in DOM)
 *   - alpha + beta: data-node-pulse-active='true', wrapper opacity=1
 *   - gamma + delta: data-node-pulse-active='false', wrapper opacity=0
 *   - All 4 wrappers have style.transition with 'opacity 300ms'
 *   - All 4 contain two <animate> children (r + opacity)
 *   - Each <animate> has calcMode='spline', keyTimes='0;0.5;1',
 *     keySplines='0.42 0 0.58 1;0.42 0 0.58 1', dur='2.4s'
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
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
const now = Date.now();
const msgs = [];
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-node-pulse]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const pulses = Array.from(document.querySelectorAll('[data-node-pulse]'));
  return pulses.map((g) => {
    const animates = Array.from(g.querySelectorAll('animate'));
    return {
      alias:        g.getAttribute('data-node-pulse'),
      active:       g.getAttribute('data-node-pulse-active'),
      opacityAttr:  g.getAttribute('opacity'),
      transition:   g.style.transition,
      animateCount: animates.length,
      animates: animates.map(a => ({
        attr:       a.getAttribute('attributeName'),
        calcMode:   a.getAttribute('calcMode'),
        keyTimes:   a.getAttribute('keyTimes'),
        keySplines: a.getAttribute('keySplines'),
        dur:        a.getAttribute('dur'),
      })),
    };
  });
});
await browser.close();

const EASE_INOUT = '0.42 0 0.58 1;0.42 0 0.58 1';
const hasOpTransition = (s) => /opacity\s+(?:300ms|0\.3s)/.test(s || '');
const activeAliases = new Set(['alpha', 'beta']);
const expectAlias = (p) => activeAliases.has(p.alias) ? 'true' : 'false';

const animateOK = (a) =>
  (a.attr === 'r' || a.attr === 'opacity') &&
  a.calcMode === 'spline' &&
  a.keyTimes === '0;0.5;1' &&
  a.keySplines === EASE_INOUT &&
  a.dur === '2.4s';

const results = {
  four_pulses:                probe.length === 4,
  all_have_alias:             probe.every(p => typeof p.alias === 'string'),
  active_state_matches:       probe.every(p => p.active === expectAlias(p)),
  active_pulses_opacity_1:    probe.filter(p => p.active === 'true').every(p => p.opacityAttr === '1'),
  inactive_pulses_opacity_0:  probe.filter(p => p.active === 'false').every(p => p.opacityAttr === '0'),
  all_have_op_transition:     probe.every(p => hasOpTransition(p.transition)),
  all_two_animates:           probe.every(p => p.animateCount === 2),
  all_animates_have_r:        probe.every(p => p.animates.some(a => a.attr === 'r')),
  all_animates_have_opacity:  probe.every(p => p.animates.some(a => a.attr === 'opacity')),
  all_animates_ease_inout:    probe.every(p => p.animates.every(animateOK)),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active pulse ease+gate:`, JSON.stringify(results),
  '\n  pulses:', probe.map(p => ({ a: p.alias, active: p.active, op: p.opacityAttr })));
process.exit(ok ? 0 : 1);
