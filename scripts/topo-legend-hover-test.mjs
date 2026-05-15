/* Round 55 verification: hovering a legend status row dims nodes whose
 * status doesn't match.
 *
 * Sessions (mix of statuses):
 *   wkr  — working          (status=working)
 *   idl1 — idle online      (status=idle)
 *   idl2 — idle online      (status=idle)
 *   off  — offline          (status=offline, last_seen old)
 *
 * Hover the "working node" row → wkr stays bright (~1.0), the rest dim
 * (~0.28). Hover "online idle" → idl1/idl2 stay, wkr+off dim. Hover
 * "offline / no SSE" → off stays, the three online dim. Release →
 * all back to base.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

// Dashboard chrome pushes the SVG ~830 px down at width 1400, so the
// legend's offline row sits at screen y≈900 — below a 900-px viewport.
// 1500 px tall gives a comfortable margin for all three rows.
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

async function hoverRow(key) {
  const target = await page.evaluate((k) => {
    const g = document.querySelector(`g[data-legend-status="${k}"]`);
    if (!g) return null;
    const r = g.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, key);
  if (!target) throw new Error(`legend row ${key} not found`);
  // jiggle from a neutral spot, then to the target
  await page.mouse.move(10, 10);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(300);
  return await opacities();
}

const onWorking = await hoverRow('working');
const onIdle    = await hoverRow('idle');
const onOffline = await hoverRow('offline');
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const released = await opacities();

await browser.close();

const dim = (v) => v != null && v < 0.4;
const bright = (v) => v != null && v >= 0.55;
const results = {
  before_baseline: bright(before.wkr) && bright(before.idl1) && bright(before.idl2),
  working_keepsWorking: bright(onWorking.wkr),
  working_dimsIdle:     dim(onWorking.idl1) && dim(onWorking.idl2),
  working_dimsOffline:  dim(onWorking.off),
  idle_keepsIdle:       bright(onIdle.idl1) && bright(onIdle.idl2),
  idle_dimsWorking:     dim(onIdle.wkr),
  idle_dimsOffline:     dim(onIdle.off),
  // Offline base opacity is 0.6 (R17), so "kept" means >= 0.55 which the
  // bright() helper already covers — anything in [0.55, 1] counts.
  offline_keepsOffline: bright(onOffline.off),
  offline_dimsOnline:   dim(onOffline.wkr) && dim(onOffline.idl1) && dim(onOffline.idl2),
  released_restoresAll: bright(released.wkr) && bright(released.idl1) && bright(released.idl2),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend status hover:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  onWorking=`, onWorking,
  `\n  onIdle=`,    onIdle,
  `\n  onOffline=`, onOffline,
  `\n  released=`, released);
process.exit(ok ? 0 : 1);
