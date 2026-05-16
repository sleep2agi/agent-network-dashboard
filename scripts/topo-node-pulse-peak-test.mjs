/* Round 409 verification: active-node pulse SMIL peak opacity lift
 * — cyber 0.18 → 0.20 / light 0.12 → 0.14. Active-state breath
 * widens slightly at peak (+0.02 both themes) while trough stays.
 *
 * Contract:
 *   - Seed a flow link so a node becomes "active" (R243 isActive gate)
 *   - The active node's <g data-node-pulse> child has an <animate>
 *     opacity element with:
 *     * cyber: values='0.20;0.04;0.20' + data-node-pulse-peak='0.20'
 *     * light: values='0.14;0.02;0.14' + data-node-pulse-peak='0.14'
 *   - Pre-R409 invariants preserved:
 *     * dur='2.4s', calcMode='spline', repeatCount='indefinite'
 *     * keySplines='0.42 0 0.58 1;0.42 0 0.58 1'
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probeTheme(theme) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('anet-theme', t); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  }, theme);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
    json: { messages: [
      { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
    ] },
  }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-node-pulse-active="true"]', { timeout: 15000 });
  await page.waitForTimeout(500);
  const probe = await page.evaluate(() => {
    const pulseGroup = document.querySelector('[data-node-pulse-active="true"]');
    if (!pulseGroup) return null;
    const animates = pulseGroup.querySelectorAll('animate');
    const opacityAnim = Array.from(animates).find(a => a.getAttribute('attributeName') === 'opacity');
    return opacityAnim ? {
      attributeName: opacityAnim.getAttribute('attributeName'),
      values:        opacityAnim.getAttribute('values'),
      dur:           opacityAnim.getAttribute('dur'),
      calcMode:      opacityAnim.getAttribute('calcMode'),
      repeatCount:   opacityAnim.getAttribute('repeatCount'),
      keySplines:    opacityAnim.getAttribute('keySplines'),
      peakData:      opacityAnim.getAttribute('data-node-pulse-peak'),
    } : null;
  });
  await browser.close();
  return probe;
}

const cyber = await probeTheme('cyber');
const light = await probeTheme('light');

const results = {
  // R409: peak lifts to 0.20 cyber / 0.14 light
  cyber_values_0_20:        cyber?.values === '0.20;0.04;0.20',
  cyber_peak_data_0_20:     cyber?.peakData === '0.20',
  light_values_0_14:        light?.values === '0.14;0.02;0.14',
  light_peak_data_0_14:     light?.peakData === '0.14',
  // Pre-R409 invariants
  cyber_dur_2_4s:           cyber?.dur === '2.4s',
  cyber_spline:             cyber?.calcMode === 'spline',
  cyber_repeat_indefinite:  cyber?.repeatCount === 'indefinite',
  cyber_keySplines:         cyber?.keySplines === '0.42 0 0.58 1;0.42 0 0.58 1',
  light_dur_2_4s:           light?.dur === '2.4s',
  light_keySplines:         light?.keySplines === '0.42 0 0.58 1;0.42 0 0.58 1',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-node pulse peak lift:`, JSON.stringify(results),
  '\n  cyber:', cyber,
  '\n  light:', light);
process.exit(ok ? 0 : 1);
