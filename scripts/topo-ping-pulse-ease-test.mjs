/* Round 228 verification: arrival-ping (R75) and dispatch-pulse
 * (R76) SMIL <animate>s get pulse-pop ease curves via calcMode/
 * keyTimes/keySplines.
 *
 * Coverage:
 *   - [data-arrival-ping] r       → ease-out across both segments
 *   - [data-arrival-ping] opacity → ease-out rise, ease-in fall
 *   - [data-dispatch-pulse] r       → ease-out across both segments
 *   - [data-dispatch-pulse] opacity → ease-out rise, ease-in fall
 *
 * Scenario: 4 working agents + 5 messages alpha→beta so:
 *   - link.count = 5 ≥ 3   (dispatch pulse fires)
 *   - fresh > 0.5          (both ping + pulse gate active)
 *   - reducedMotion off    (cyber-themed cookie default)
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
await page.waitForSelector('[data-arrival-ping]', { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-dispatch-pulse]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(400);

const out = await page.evaluate(() => {
  const probe = (parentSelector) => {
    const el = document.querySelector(parentSelector);
    if (!el) return null;
    const animates = Array.from(el.querySelectorAll('animate'));
    return animates.map((a) => ({
      attr:       a.getAttribute('attributeName'),
      calcMode:   a.getAttribute('calcMode'),
      keyTimes:   a.getAttribute('keyTimes'),
      keySplines: a.getAttribute('keySplines'),
    }));
  };
  return {
    arrival:  probe('[data-arrival-ping]'),
    dispatch: probe('[data-dispatch-pulse]'),
  };
});
await browser.close();

const easeOutBoth   = '0.25 0.1 0.25 1;0.25 0.1 0.25 1';
const pulsePop      = '0.25 0.1 0.25 1;0.42 0 1 1';
const keyTimes      = '0;0.5;1';

const find = (arr, attr) => arr?.find(a => a.attr === attr);
const matches = (a, splines) => a && a.calcMode === 'spline' && a.keyTimes === keyTimes && a.keySplines === splines;

const results = {
  arrival_present:    Array.isArray(out.arrival) && out.arrival.length === 2,
  arrival_r_easeout:  matches(find(out.arrival, 'r'),       easeOutBoth),
  arrival_op_pulse:   matches(find(out.arrival, 'opacity'), pulsePop),
  dispatch_present:   Array.isArray(out.dispatch) && out.dispatch.length === 2,
  dispatch_r_easeout: matches(find(out.dispatch, 'r'),       easeOutBoth),
  dispatch_op_pulse:  matches(find(out.dispatch, 'opacity'), pulsePop),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} ping+pulse ease:`, JSON.stringify(results),
  '\n  arrival:',  out.arrival,
  '\n  dispatch:', out.dispatch);
process.exit(ok ? 0 : 1);
