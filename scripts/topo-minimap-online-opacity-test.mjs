/* Round 392 verification: minimap online dot opacity 0.9 → 0.95.
 * Theme-consistency / canvas-presence polish family (7th anchor)
 * after R370 hub-ring, R371 edge-badge, R372 minimap offline,
 * R386 hub-highlight idle, R387 hover-detail panel, R391 hub-spoke
 * active. Halves the online dot's idle alpha gap (0.10 → 0.05).
 * Mirrors R386's hub-highlight idle 0.9 → 0.95 on the minimap.
 *
 * Contract:
 *   - Minimap only mounts when view is non-default — test clicks
 *     zoom-in twice to mount it before probing.
 *   - Online dots: opacity attr === '0.95', data-opacity === '0.95',
 *     R384 r=1.9 invariant, data-online='true'
 *   - Offline dot (one ghost session): opacity attr === '0.6'
 *     (R372 invariant), r=1.2 invariant, data-online='false'
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago → offline

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
  await route.fulfill({ response: r, json: {
    ...b,
    sessions: [
      { alias: 'alpha', status: 'idle',    model: 'claude-opus-4',  runtime: 'claude-code-cli', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'beta',  status: 'working', model: 'claude-opus-4',  runtime: 'claude-code-cli', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'ghost', status: 'offline', model: 'claude-opus-4',  runtime: 'claude-code-cli', network_id: nid, project_dir: null, created_at: stale, updated_at: stale, last_seen_at: stale },
    ],
  } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(300);

// Minimap mounts only on non-default view — click zoom-in twice
await page.click('[data-topo-chrome-zoom-in]');
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-dot]', { timeout: 5000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const dots = Array.from(document.querySelectorAll('[data-topo-minimap-dot]'));
  const online  = dots.filter((d) => d.getAttribute('data-topo-minimap-dot-online') === 'true');
  const offline = dots.filter((d) => d.getAttribute('data-topo-minimap-dot-online') === 'false');
  const read = (el) => el ? ({
    opacityAttr:  el.getAttribute('opacity'),
    opacityData:  el.getAttribute('data-topo-minimap-dot-opacity'),
    radiusAttr:   el.getAttribute('r'),
  }) : null;
  return {
    total:        dots.length,
    onlineCount:  online.length,
    offlineCount: offline.length,
    onlineSample: read(online[0]),
    offlineSample: read(offline[0]),
  };
});

await browser.close();

const results = {
  // Setup: 2 online + 1 offline
  total_3_dots:          probe.total === 3,
  online_2_dots:         probe.onlineCount === 2,
  offline_1_dot:         probe.offlineCount === 1,
  // R392: online opacity 0.9 → 0.95
  online_opacity_0_95:   probe.onlineSample?.opacityAttr === '0.95',
  online_data_0_95:      probe.onlineSample?.opacityData === '0.95',
  online_r_1_9:          probe.onlineSample?.radiusAttr === '1.9',     // R384 invariant
  // R372 invariant: offline opacity 0.6
  offline_opacity_0_6:   probe.offlineSample?.opacityAttr === '0.6',
  offline_data_0_6:      probe.offlineSample?.opacityData === '0.6',
  offline_r_1_2:         probe.offlineSample?.radiusAttr === '1.2',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap online dot opacity 0.9 → 0.95:`, JSON.stringify(results),
  '\n  probe:', JSON.stringify(probe, null, 2));
process.exit(ok ? 0 : 1);
