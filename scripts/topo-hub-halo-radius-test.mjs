/* Round 408 verification: hub-halo radius 18 → 20. Visual-weight
 * bump family 13th anchor — the canvas's signature breath element
 * gets +2px radius (~23% area increase). Per-bucket opacity envelope
 * and breath rhythm preserved exactly.
 *
 * Contract:
 *   - The hub-halo <circle> r attr === '20'
 *   - data-topo-hub-halo-radius === '20'
 *   - Pre-R408 invariants preserved:
 *     * R404 cyber trough '0.1'
 *     * R405 light trough '0.34'
 *     * idle bucket peakDark '0.16'
 *     * data-hub-busyness === '0' for all-idle fixture
 *     * fill remains theme-correct (#10b981 cyber / #d1fae5 light)
 *
 * Source-file verification of the radius change for redundancy.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-hub-busyness]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const halo = document.querySelector('[data-hub-busyness]');
  if (!halo) return null;
  return {
    busyness: halo.getAttribute('data-hub-busyness'),
    rAttr:    halo.getAttribute('r'),
    rData:    halo.getAttribute('data-topo-hub-halo-radius'),
    trough:   halo.getAttribute('data-topo-hub-halo-trough'),
    peak:     halo.getAttribute('data-topo-hub-halo-peak'),
    fill:     halo.getAttribute('fill'),
  };
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceR20 = /cx=\{cx\} cy=\{cy\} r="20"/.test(fileText);
const sourceDataR20 = /data-topo-hub-halo-radius="20"/.test(fileText);

await browser.close();

const results = {
  // R408 wire
  r_attr_20:                  probe?.rAttr === '20',
  r_data_20:                  probe?.rData === '20',
  // R404/R405 trough invariants preserved
  cyber_trough_0_1:           probe?.trough === '0.1',
  // R84 idle bucket peak invariant
  cyber_peak_0_16:            probe?.peak === '0.16',
  // Pre-R408 base invariants
  busyness_0:                 probe?.busyness === '0',
  fill_cyber:                 probe?.fill === '#10b981',
  // Source-file canonical wire
  source_r_20:                sourceR20,
  source_data_r_20:           sourceDataR20,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-halo radius 18 → 20:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
