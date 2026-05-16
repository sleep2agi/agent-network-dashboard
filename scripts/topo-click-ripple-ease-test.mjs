/* Round 227 verification: click-ripple SMIL <animate> gets ease-out
 * curve via calcMode/keySplines instead of default linear
 * interpolation. Click triggers ripple state (R14 node click); test
 * probes the resulting <circle data-click-ripple> element's two
 * <animate> children for the spline attributes.
 *
 * Test scenario:
 *   - Load TopoGraph with 4 nodes
 *   - Click the first node (R14 click-feel state machine)
 *   - Within 500ms (before ripple expires), probe [data-click-ripple]
 *   - Verify both <animate> children have:
 *       calcMode="spline"
 *       keyTimes="0;1"
 *       keySplines="0.25 0.1 0.25 1"
 *       dur="0.5s"
 *       fill="freeze"
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
await page.waitForTimeout(400);

// Click the first node body (its <circle data-node-status-ring> sits
// inside the node <g>, which has the onClick handler that fires
// setClickRipple). Programmatic dispatch — Playwright .click() can
// be flaky on SVG <g>, so we synthesize the event directly.
await page.evaluate(() => {
  const node = document.querySelector('g[data-node]');
  if (!node) throw new Error('no node found');
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
// Ripple element mounts on next React commit — wait for it.
await page.waitForSelector('[data-click-ripple]', { timeout: 3000, state: 'attached' });

const probe = await page.evaluate(() => {
  const ripple = document.querySelector('[data-click-ripple]');
  if (!ripple) return null;
  const animates = ripple.querySelectorAll('animate');
  return Array.from(animates).map((a) => ({
    attr:       a.getAttribute('attributeName'),
    calcMode:   a.getAttribute('calcMode'),
    keyTimes:   a.getAttribute('keyTimes'),
    keySplines: a.getAttribute('keySplines'),
    dur:        a.getAttribute('dur'),
    fill:       a.getAttribute('fill'),
  }));
});
await browser.close();

const easeSpline = '0.25 0.1 0.25 1';
const expected = ['r', 'opacity'];

const results = {
  ripple_mounted:       probe !== null,
  two_animates:         probe?.length === 2,
  has_r_animate:        probe?.some(a => a.attr === 'r') ?? false,
  has_opacity_animate:  probe?.some(a => a.attr === 'opacity') ?? false,
  both_spline_calcmode: probe?.every(a => a.calcMode === 'spline') ?? false,
  both_keytimes_0_1:    probe?.every(a => a.keyTimes === '0;1') ?? false,
  both_ease_keysplines: probe?.every(a => a.keySplines === easeSpline) ?? false,
  both_dur_0_5s:        probe?.every(a => a.dur === '0.5s') ?? false,
  both_fill_freeze:     probe?.every(a => a.fill === 'freeze') ?? false,
  attrs_match_expected: probe?.map(a => a.attr).sort().join(',') === expected.sort().join(','),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} click-ripple ease-out:`, JSON.stringify(results), '\n  probe:', probe);
process.exit(ok ? 0 : 1);
