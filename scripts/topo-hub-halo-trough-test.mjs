/* Round 404 verification: hub-halo SMIL trough opacity cyber 0.08
 * → 0.10. Extends the stale-state legibility lift family (R317 /
 * R358 / R372) to the canvas's signature breath low-point.
 * Per-bucket peaks [0.16/0.20/0.26/0.32] unchanged so the R84
 * breath tuning is preserved.
 *
 * Contract:
 *   - Idle fixture (no working sessions, bucket=0):
 *     * data-hub-busyness === '0'
 *     * data-topo-hub-halo-trough === '0.1' (cyber theme)
 *     * data-topo-hub-halo-peak === '0.16' (idle bucket peak invariant)
 *   - Source-file verification of:
 *     * `const troughDark  = 0.10;`
 *     * peakDark array unchanged
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
  // All idle so workingCount=0, busy bucket=0 (peak 0.16)
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
    trough:   halo.getAttribute('data-topo-hub-halo-trough'),
    peak:     halo.getAttribute('data-topo-hub-halo-peak'),
    radius:   halo.getAttribute('r'),
    fill:     halo.getAttribute('fill'),
  };
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasTrough010 = /const troughDark\s*=\s*0\.10;/.test(fileText);
const sourceHasPeakArray = /const peakDark\s*=\s*\[0\.16, 0\.20, 0\.26, 0\.32\]\[busy\];/.test(fileText);

await browser.close();

const results = {
  // Idle fixture invariants
  busyness_0:               probe?.busyness === '0',
  // R404: cyber trough lifted to 0.10
  trough_cyber_0_1:         probe?.trough === '0.1',
  // R84 peak invariants (bucket=0 idle peak)
  peak_idle_0_16:           probe?.peak === '0.16',
  // Pre-R404 base hub-halo invariants
  radius_18:                probe?.radius === '18',
  fill_cyber:               probe?.fill === '#10b981',
  // Source-file canonical wire
  source_trough_010:        sourceHasTrough010,
  source_peak_array:        sourceHasPeakArray,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-halo cyber trough 0.08 → 0.10:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
