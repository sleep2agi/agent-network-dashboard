/* Round 60 verification: each pressure-bar segment toggles a sticky
 * status filter. Click "working" → all non-working nodes dim, working
 * ones stay. Click again → release. Pin and the R55 legend hover feed
 * the same node-opacity branch via `activeStatus = hoveredStatus ??
 * pinnedStatus`, so hover transiently overrides without nuking the pin.
 *
 * Sessions:
 *   wkr   — working
 *   idl1  — idle
 *   idl2  — idle
 *   off   — offline
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'wkr',  status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl1', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl2', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'off',  status: 'offline', network_id: nid, project_dir: null, created_at: stale, updated_at: stale, last_seen_at: stale },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(500);

const opacities = () => page.evaluate(() => {
  const o = {};
  for (const a of ['wkr', 'idl1', 'idl2', 'off']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});

const before = await opacities();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;

// Click the WORKING segment.
const workingSeg = page.locator('[data-pressure-seg="working"]').first();
const workingExists = await workingSeg.count() > 0;
if (!workingExists) { console.log('❌ pressure segment[working] not found'); process.exit(1); }
await workingSeg.click({ force: true });
await page.waitForTimeout(250);
const afterPin = await opacities();

// Pin should persist past mouse moving away.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterMouseMove = await opacities();

// Click again to release. R79 added hover-affordances on the working
// + online chips, so the click locator's mouse path can light a
// transient hoveredStatus en route to the pressure segment. Mouse-move
// to a neutral spot after the release click so we observe pin-only
// state (same gotcha R61's test documented inline).
await workingSeg.click({ force: true });
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterRelease = await opacities();

// Repeat for offline segment.
const offlineSeg = page.locator('[data-pressure-seg="offline"]').first();
await offlineSeg.click({ force: true });
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterOfflinePin = await opacities();
await offlineSeg.click({ force: true });
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterOfflineRelease = await opacities();

await browser.close();

const results = {
  before_baseline:           bright(before.wkr) && bright(before.idl1),
  working_pinKeepsWorking:   bright(afterPin.wkr),
  working_pinDimsIdle:       dim(afterPin.idl1) && dim(afterPin.idl2),
  working_pinDimsOffline:    dim(afterPin.off),
  working_pinSurvivesMouse:  bright(afterMouseMove.wkr) && dim(afterMouseMove.idl1),
  working_releaseRestoresAll: bright(afterRelease.wkr) && bright(afterRelease.idl1),
  offline_pinKeepsOffline:   bright(afterOfflinePin.off),   // base offline 0.6 reads as bright (>=0.55)
  offline_pinDimsOnline:     dim(afterOfflinePin.wkr) && dim(afterOfflinePin.idl1),
  offline_releaseRestoresAll: bright(afterOfflineRelease.wkr),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure pin:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  afterPin=`, afterPin,
  `\n  afterMouseMove=`, afterMouseMove,
  `\n  afterRelease=`, afterRelease,
  `\n  afterOfflinePin=`, afterOfflinePin,
  `\n  afterOfflineRelease=`, afterOfflineRelease);
process.exit(ok ? 0 : 1);
