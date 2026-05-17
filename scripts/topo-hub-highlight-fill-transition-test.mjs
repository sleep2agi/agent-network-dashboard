/* Round 510 verification: hub-highlight transition list extends to
 * include `fill 200ms ease-out` alongside existing `opacity 300ms`.
 * R509 introduced theme-conditional fill but the snap-vs-fade hadn't
 * been wired; R510 makes theme-toggle smooth.
 *
 * Verifies:
 *   1. computed transition-property includes both 'fill' and 'opacity'
 *   2. computed transition-duration shows 200ms and 300ms
 *   3. source-side regex confirms the new spec
 *   4. R509 theme-conditional fill still works (cross-theme differential)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(theme) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('anet-theme', t);
      localStorage.setItem('anet-topo-layout', 'ring');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, theme);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias, status) => ({
      alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1', 'idle')] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-topo-hub-highlight]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const circle = document.querySelector('[data-topo-hub-highlight]');
    if (!circle) return null;
    const cs = window.getComputedStyle(circle);
    return {
      fill_attr: circle.getAttribute('fill'),
      transition_property: cs.transitionProperty,
      transition_duration: cs.transitionDuration,
    };
  });
  await browser.close();
  return result;
}

const cyber = await probe('cyber');
const light = await probe('light');

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /transition: 'opacity 300ms ease-out, fill 200ms ease-out'/.test(src);

const tpHas = (s, prop) => new RegExp(`\\b${prop}\\b`, 'i').test(s || '');
const durHas = (s, ms) => (s || '').split(',').map((x) => x.trim()).includes(ms);

const results = {
  cyber_tp_has_fill:    cyber && tpHas(cyber.transition_property, 'fill'),
  cyber_tp_has_opacity: cyber && tpHas(cyber.transition_property, 'opacity'),
  cyber_dur_200ms:      cyber && durHas(cyber.transition_duration, '0.2s'),
  cyber_dur_300ms:      cyber && durHas(cyber.transition_duration, '0.3s'),
  light_tp_has_fill:    light && tpHas(light.transition_property, 'fill'),
  light_tp_has_opacity: light && tpHas(light.transition_property, 'opacity'),
  cyber_fill_d1fae5:    cyber && cyber.fill_attr === '#d1fae5',
  light_fill_10b981:    light && light.fill_attr === '#10b981',
  source_wired:         sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R510 hub-highlight fill transition:`, JSON.stringify(results),
  '\n  cyber:', JSON.stringify(cyber),
  '\n  light:', JSON.stringify(light));
process.exit(ok ? 0 : 1);
