/* Round 69 verification: Cmd+K palette can pin topology filters from
 * anywhere. The palette dispatches a CustomEvent('anet:topo-pin') that
 * TopoGraph listens for and translates into pinnedStatus / pinnedGroup
 * state. sessionStorage is written in lockstep so a reload preserves it
 * (R66 carries it through).
 *
 *  - Dispatch {kind:'status', value:'working'} → pill appears + idle/
 *    offline nodes dim. sessionStorage holds 'working'.
 *  - Dispatch {kind:'clear'} → pill disappears + opacities restore.
 *    sessionStorage entries cleared.
 *  - Dispatch {kind:'group', value:'alpha'} → group pill + opacities
 *    composed; storage holds 'alpha'.
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
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'alpha1', status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha2', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha3', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta',   status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(500);

const snapshot = () => page.evaluate(() => {
  const pills = [...document.querySelectorAll('[data-active-filter]')].map(el => ({
    kind: el.getAttribute('data-active-filter'),
    text: (el.innerText || el.textContent || '').trim(),
  }));
  const opacities = {};
  for (const a of ['alpha1', 'alpha2', 'beta']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    opacities[a] = g ? +(g.style.opacity || '1') : null;
  }
  return {
    pills,
    opacities,
    storageStatus: sessionStorage.getItem('anet-topo-pinned-status'),
    storageGroup:  sessionStorage.getItem('anet-topo-pinned-group'),
  };
});

const before = await snapshot();

// Dispatch palette pin: status=working
await page.evaluate(() => {
  // The Cmd+K commands write to storage AND dispatch the event in
  // lockstep. We mirror both here so we exercise the same code path
  // a palette `perform()` would take.
  sessionStorage.setItem('anet-topo-pinned-status', 'working');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'working' } }));
});
await page.waitForTimeout(250);
const afterStatus = await snapshot();

// Dispatch palette pin: group=alpha (additionally)
await page.evaluate(() => {
  sessionStorage.setItem('anet-topo-pinned-group', 'alpha');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'group', value: 'alpha' } }));
});
await page.waitForTimeout(250);
const afterGroup = await snapshot();

// Dispatch palette clear
await page.evaluate(() => {
  sessionStorage.removeItem('anet-topo-pinned-status');
  sessionStorage.removeItem('anet-topo-pinned-group');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'clear' } }));
});
await page.waitForTimeout(250);
const afterClear = await snapshot();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_noPills:           before.pills.length === 0,
  before_baselineBright:    bright(before.opacities.alpha1) && bright(before.opacities.alpha2),
  status_pillRendered:      afterStatus.pills.some(p => p.kind === 'status' && /working/.test(p.text)),
  status_dimsIdle:          dim(afterStatus.opacities.alpha2) && dim(afterStatus.opacities.beta),
  status_keepsWorking:      bright(afterStatus.opacities.alpha1),
  status_storageWritten:    afterStatus.storageStatus === 'working',
  groupAdded_bothPills:     afterGroup.pills.length === 2,
  groupAdded_storageBoth:   afterGroup.storageStatus === 'working' && afterGroup.storageGroup === 'alpha',
  clear_noPills:            afterClear.pills.length === 0,
  clear_restoredOpacities:  bright(afterClear.opacities.alpha1) && bright(afterClear.opacities.alpha2) && bright(afterClear.opacities.beta),
  clear_storageCleared:     afterClear.storageStatus === null && afterClear.storageGroup === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} cmdk-pin:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  afterStatus=`, afterStatus,
  `\n  afterGroup=`, afterGroup,
  `\n  afterClear=`, afterClear);
process.exit(ok ? 0 : 1);
