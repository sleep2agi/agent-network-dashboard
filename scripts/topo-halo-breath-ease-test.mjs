/* Round 244 verification: hub grounding halo (R84) AND node working
 * halos (R112/R226) both pick up ease-in-out keySplines on their
 * SMIL breath animates. The three breath surfaces on canvas — hub
 * (R84+R244) + active-node pulse (R243) + working halos (R226+R244)
 * — now share the same curve shape and feel.
 *
 * Test scope:
 *   - hub grounding halo: probe [data-hub-busyness] → child
 *     <animate> has calcMode='spline', keyTimes='0;0.5;1',
 *     keySplines='0.42 0 0.58 1;0.42 0 0.58 1'
 *   - working halos: probe all [data-node-halo-breath='on'] →
 *     each child <animate> has same calcMode/keyTimes/keySplines
 *
 * Scenario: 4 working agents (hub busy bucket > 0 → halo breath
 * is present; all 4 nodes are working → 4 halo breath animates).
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
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-hub-busyness]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const probeAnimate = (parent) => {
    const a = parent?.querySelector('animate');
    if (!a) return null;
    return {
      attr:       a.getAttribute('attributeName'),
      calcMode:   a.getAttribute('calcMode'),
      keyTimes:   a.getAttribute('keyTimes'),
      keySplines: a.getAttribute('keySplines'),
      dur:        a.getAttribute('dur'),
    };
  };
  const hub = document.querySelector('[data-hub-busyness]');
  const halos = Array.from(document.querySelectorAll('[data-node-halo-breath="on"]'));
  return {
    hub: probeAnimate(hub),
    halos: halos.map(h => probeAnimate(h)),
  };
});
await browser.close();

const EASE_INOUT = '0.42 0 0.58 1;0.42 0 0.58 1';
const KEY_TIMES = '0;0.5;1';

const animateOK = (a) =>
  a &&
  a.attr === 'opacity' &&
  a.calcMode === 'spline' &&
  a.keyTimes === KEY_TIMES &&
  a.keySplines === EASE_INOUT;

const results = {
  hub_animate_present:   out.hub !== null,
  hub_ease_in_out:       animateOK(out.hub),
  halos_count_4:         out.halos.length === 4,
  halos_all_present:     out.halos.every(h => h !== null),
  halos_all_ease_in_out: out.halos.every(animateOK),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} halo breath ease:`, JSON.stringify(results),
  '\n  hub:  ', out.hub,
  '\n  halos:', out.halos);
process.exit(ok ? 0 : 1);
