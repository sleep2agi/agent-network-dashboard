/* Round 83 verification: pressure-bar segments expose a hover preview
 * before the click pins. Matches the R55 legend + R79 status chip +
 * R80 vendor letter hover pattern — same activeStatus mechanism, just
 * the last surface that was click-only.
 *
 * Fleet: 1 working + 2 idle + 1 offline. Hover the working segment →
 * working node stays bright, idle + offline dim. Mouseleave → restore.
 * Then click the working segment → pin sticks via boxShadow. Hovering
 * idle while working is pinned → live preview switches; mouseleave
 * falls back to the working pin (activeStatus = hoveredStatus ??
 * pinnedStatus).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh   = new Date(Date.now() - 60 * 1000).toISOString();
const stale10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'wkr',  status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh,   updated_at: fresh,   last_seen_at: fresh },
    { alias: 'idl1', status: 'idle',    model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh,   updated_at: fresh,   last_seen_at: fresh },
    { alias: 'idl2', status: 'idle',    model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh,   updated_at: fresh,   last_seen_at: fresh },
    { alias: 'off',  status: 'offline', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: stale10, updated_at: stale10, last_seen_at: stale10 },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(500);

const ops = () => page.evaluate(() => {
  const o = {};
  for (const a of ['wkr', 'idl1', 'idl2', 'off']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});
const segShadow = (k) => page.evaluate((key) => {
  const s = document.querySelector(`[data-pressure-seg="${key}"]`);
  return s ? (s.getAttribute('style') || '').includes('inset') : false;
}, k);

const before = await ops();

// Hover working segment → working stays bright, others dim.
await page.locator('[data-pressure-seg="working"]').hover();
await page.waitForTimeout(250);
const onHoverWorking = await ops();
const hoverPinShadowBefore = await segShadow('working');

// Mouseleave → baseline restores (no pin yet).
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterLeave = await ops();

// Click to pin working — segment gets inset shadow.
await page.locator('[data-pressure-seg="working"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterPin    = await ops();
const pinShadow   = await segShadow('working');

// Hover idle while working is pinned — hoveredStatus overrides for the
// duration of the hover. idle stays bright, working dims (transient).
await page.locator('[data-pressure-seg="idle"]').hover();
await page.waitForTimeout(250);
const onHoverIdle = await ops();

// Mouseleave → falls back to working pin (NOT cleared).
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterLeaveIdle = await ops();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:           bright(before.wkr) && bright(before.idl1) && bright(before.idl2) && before.off <= 0.6,
  hoverWorking_workerStays:  bright(onHoverWorking.wkr),
  hoverWorking_idlesDim:     dim(onHoverWorking.idl1) && dim(onHoverWorking.idl2),
  hoverWorking_offDim:       dim(onHoverWorking.off),
  hoverWorking_noPinYet:    !hoverPinShadowBefore,
  leave_restoresBaseline:    bright(afterLeave.wkr) && bright(afterLeave.idl1) && bright(afterLeave.idl2),
  pin_workerStays:           bright(afterPin.wkr),
  pin_idlesDim:              dim(afterPin.idl1) && dim(afterPin.idl2),
  pin_shadowRendered:        pinShadow,
  hoverIdle_transient:       bright(onHoverIdle.idl1) && bright(onHoverIdle.idl2) && dim(onHoverIdle.wkr),
  leaveIdle_pinPersists:     bright(afterLeaveIdle.wkr) && dim(afterLeaveIdle.idl1) && dim(afterLeaveIdle.idl2),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure-hover:`, JSON.stringify(results),
  `\n  before=`,          before,
  `\n  onHoverWorking=`,  onHoverWorking,
  `\n  afterPin=`,        afterPin,
  `\n  onHoverIdle=`,     onHoverIdle,
  `\n  afterLeaveIdle=`,  afterLeaveIdle);
process.exit(ok ? 0 : 1);
