/* Round 79 verification: header working + online count chips become
 * hover affordances (sister to R77 active-links chip).
 *  - Hover "N working" → setHoveredStatus('working') → idle + offline
 *    nodes dim, working stays bright. Same outcome as R55 legend row
 *    hover, just from the chip surface.
 *  - Hover "N online" with working present → same as above.
 *  - Mouseleave restores baseline.
 *
 * Fleet: 1 working (wkr), 2 idle (idl1, idl2), 1 offline (off).
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
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
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

// Hover working chip
await page.locator('[data-working-chip]').hover();
await page.waitForTimeout(250);
const onWorking = await opacities();

// Move away
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterWorking = await opacities();

// Hover online chip (working present → routes to 'working')
await page.locator('[data-online-chip]').hover();
await page.waitForTimeout(250);
const onOnline = await opacities();

await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterOnline = await opacities();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:           bright(before.wkr) && bright(before.idl1) && bright(before.idl2),
  working_keepsWkrBright:    bright(onWorking.wkr),
  working_dimsIdle:          dim(onWorking.idl1) && dim(onWorking.idl2),
  working_dimsOffline:       dim(onWorking.off),
  workingLeave_restoresAll:  bright(afterWorking.wkr) && bright(afterWorking.idl1),
  online_keepsWkrBright:     bright(onOnline.wkr),  // routes to working filter
  online_dimsIdle:           dim(onOnline.idl1) && dim(onOnline.idl2),
  onlineLeave_restoresAll:   bright(afterOnline.wkr) && bright(afterOnline.idl1),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} status-chip hover:`, JSON.stringify(results),
  `\n  before=`,        before,
  `\n  onWorking=`,     onWorking,
  `\n  afterWorking=`,  afterWorking,
  `\n  onOnline=`,      onOnline,
  `\n  afterOnline=`,   afterOnline);
process.exit(ok ? 0 : 1);
