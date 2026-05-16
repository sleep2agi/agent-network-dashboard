/* Round 372 verification: minimap offline-dot opacity 0.5 → 0.6.
 * Sibling stale-state legibility lift to R358 (freshness ramp floor
 * 0.25 → 0.30). Pre-R372 R198 drew offline dots at α=0.5; R372 lifts
 * to 0.6 (+20 % relative) for better readability while keeping a
 * clear two-tier distinction vs online α=0.9.
 *
 * The minimap only renders when view is non-default (zoom !== 1 ||
 * pan). Test triggers zoom-in to mount it, then probes the offline
 * dot's opacity attr.
 *
 * Contract:
 *   - data-topo-minimap-dot-online="false" element opacity === '0.6'.
 *   - data-topo-minimap-dot-opacity === '0.6' for offline dot.
 *   - Online dot still at opacity '0.9' (R198 invariant).
 *   - Pre-R372 invariants:
 *     * R198 offline r=1.2, online r=1.7 preserved
 *     * R198 transition list (opacity + fill + r) preserved
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
  // Mix of online (working) + offline sessions.
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
// Minimap only mounts when view is non-default — zoom in twice.
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 15000 });
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(200);
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-dot]', { timeout: 5000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const offline = document.querySelector('[data-topo-minimap-dot-online="false"]');
  const online  = document.querySelector('[data-topo-minimap-dot-online="true"]');
  const cs = offline ? getComputedStyle(offline) : null;
  return {
    offlineOpacity:  offline?.getAttribute('opacity') ?? null,
    offlineData:     offline?.getAttribute('data-topo-minimap-dot-opacity') ?? null,
    offlineR:        offline?.getAttribute('r') ?? null,
    offlineTrans:    cs?.transition ?? null,
    onlineOpacity:   online?.getAttribute('opacity') ?? null,
    onlineR:         online?.getAttribute('r') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  offline_opacity_0_6:   probe.offlineOpacity === '0.6',
  offline_data_0_6:      probe.offlineData === '0.6',
  offline_r_1_2:         probe.offlineR === '1.2',       // R198 invariant
  online_opacity_0_9:    probe.onlineOpacity === '0.9',  // R198 invariant
  online_r_1_7:          probe.onlineR === '1.7',        // R198 invariant
  trans_has_opacity:     hasTrans(probe.offlineTrans, 'opacity'),  // R198
  trans_has_fill:        hasTrans(probe.offlineTrans, 'fill'),     // R198
  trans_has_r:           hasTrans(probe.offlineTrans, 'r'),        // R198
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap offline opacity 0.5 → 0.6:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
