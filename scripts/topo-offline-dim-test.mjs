/* Round 17 verification: offline nodes render at opacity 0.6 at rest,
 * online stay at 1, and the chat-focused node (even if offline) jumps
 * to 1 when its ChatPopover opens. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.removeItem('anet-brand');
    localStorage.removeItem('anet-topo-view');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
// fresh-enough so the ghost-age-out filter doesn't drop the offline node
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'on1', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'on2', status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'off1', status: 'offline', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'off2', status: 'offline', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('g[data-node]').length === 4;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(500);

const opacityOf = (alias) => page.$eval(`g[data-node="${alias}"]`, el =>
  parseFloat(getComputedStyle(el).opacity || el.style.opacity || '1'));

const restOn1 = await opacityOf('on1');
const restOn2 = await opacityOf('on2');
const restOff1 = await opacityOf('off1');
const restOff2 = await opacityOf('off2');

// Click an offline node — the chat popover should open and that node
// should jump to full opacity.
await page.locator('g[data-node="off1"]').click();
await page.waitForTimeout(300);
const focusedOff1 = await opacityOf('off1');
const otherOff2 = await opacityOf('off2');

await browser.close();
const results = {
  onlineFullOpacity: Math.abs(restOn1 - 1) < 0.01 && Math.abs(restOn2 - 1) < 0.01,
  offlineDimmedAtRest: Math.abs(restOff1 - 0.6) < 0.01 && Math.abs(restOff2 - 0.6) < 0.01,
  chatFocusOfflineRestoresOpacity: Math.abs(focusedOff1 - 1) < 0.01,
  otherOfflineStaysDimmed: Math.abs(otherOff2 - 0.6) < 0.01,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} offline dim:`, JSON.stringify(results),
  `rest=on1:${restOn1} on2:${restOn2} off1:${restOff1} off2:${restOff2}`,
  `clicked off1=${focusedOff1} off2=${otherOff2}`);
process.exit(ok ? 0 : 1);
