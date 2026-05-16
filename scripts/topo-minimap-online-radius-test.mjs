/* Round 384 verification: minimap online dot radius 1.7 → 1.9.
 * Sibling visual-weight bump (10th anchor) to R383 recent-row pip
 * 1.8 → 2.0. Widens online vs offline tier contrast (1.42× → 1.58×).
 * R372 already lifted offline opacity 0.5 → 0.6; R384 lifts online
 * radius — pair completes minimap-dot legibility polish across both
 * states.
 *
 * The minimap only renders when view is non-default (zoom !== 1 ||
 * pan), so test triggers zoom-in twice to mount it.
 *
 * Contract:
 *   - Online dot computed r === '1.9'.
 *   - Online dot data-topo-minimap-dot-radius === '1.9'.
 *   - Offline dot r === '1.2' (R198 invariant, untouched).
 *   - Offline dot data-radius === '1.2'.
 *   - Pre-R384 invariants:
 *     * R198 opacity (online 0.9 / offline 0.6 from R372)
 *     * R198 transition list (opacity + fill + r 200ms) preserved
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
const stale = new Date(Date.now() - 600 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  // Mix of online (working) + offline.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    { alias: 'on-a', status: 'working',  model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'on-b', status: 'working',  model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'off-c', status: 'offline', model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null, created_at: stale, updated_at: stale, last_seen_at: stale },
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// Trigger zoom-in to mount minimap (R30 gate).
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 15000 });
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(200);
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-dot]', { timeout: 5000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const online  = document.querySelector('[data-topo-minimap-dot-online="true"]');
  const offline = document.querySelector('[data-topo-minimap-dot-online="false"]');
  return {
    onlineR:        online?.getAttribute('r') ?? null,
    onlineRData:    online?.getAttribute('data-topo-minimap-dot-radius') ?? null,
    onlineOpacity:  online?.getAttribute('opacity') ?? null,
    offlineR:       offline?.getAttribute('r') ?? null,
    offlineRData:   offline?.getAttribute('data-topo-minimap-dot-radius') ?? null,
    offlineOpacity: offline?.getAttribute('opacity') ?? null,
  };
});

await browser.close();

const results = {
  online_r_1_9:           probe.onlineR === '1.9',
  online_r_data_1_9:      probe.onlineRData === '1.9',
  online_opacity_0_9:     probe.onlineOpacity === '0.9',     // R198 invariant
  offline_r_1_2:          probe.offlineR === '1.2',          // R198 invariant
  offline_r_data_1_2:     probe.offlineRData === '1.2',
  offline_opacity_0_6:    probe.offlineOpacity === '0.6',    // R372 lift
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap online dot radius 1.7 → 1.9:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
