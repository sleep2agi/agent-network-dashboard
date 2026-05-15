/* Round 95 verification: legend rows show live counts. Fleet = 3
 * working + 2 idle + 1 offline. Each row's data-legend-count
 * attribute matches the expected number. Pinning a row brightens
 * its count alongside the label.
 *
 * The count is right-aligned at x=215 (after the flow-arrow swatch
 * which spans x=140-196 on the offline row), pointerEvents:none so
 * the row's R55 hover affordance still hits.
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
  } catch {}
});

const fresh   = new Date(Date.now() - 60 * 1000).toISOString();
const stale10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, ts) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: ts, updated_at: ts, last_seen_at: ts,
  });
  const sessions = [
    mk('wkr1', 'working', fresh),
    mk('wkr2', 'working', fresh),
    mk('wkr3', 'working', fresh),
    mk('idl1', 'idle',    fresh),
    mk('idl2', 'idle',    fresh),
    mk('off1', 'offline', stale10),
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForTimeout(400);

const counts = () => page.evaluate(() => ({
  working: document.querySelector('[data-legend-count="working"]')?.textContent,
  idle:    document.querySelector('[data-legend-count="idle"]')?.textContent,
  offline: document.querySelector('[data-legend-count="offline"]')?.textContent,
}));
const opacities = () => page.evaluate(() => ({
  working: +(document.querySelector('[data-legend-count="working"]')?.getAttribute('opacity') || '0'),
  idle:    +(document.querySelector('[data-legend-count="idle"]')?.getAttribute('opacity') || '0'),
  offline: +(document.querySelector('[data-legend-count="offline"]')?.getAttribute('opacity') || '0'),
}));

const c = await counts();
const opsRest = await opacities();

// Pin the working row — its count should brighten.
await page.locator('[data-legend-status="working"]').click();
await page.waitForTimeout(250);
const opsPinned = await opacities();

await browser.close();

const results = {
  workingCount_3:        c.working === '3',
  idleCount_2:           c.idle === '2',
  offlineCount_1:        c.offline === '1',
  resting_dim:           opsRest.working < 0.7 && opsRest.idle < 0.7 && opsRest.offline < 0.7,
  pinnedWorking_bright:  opsPinned.working >= 0.9,
  pinnedWorking_othersUnchanged: opsPinned.idle < 0.7 && opsPinned.offline < 0.7,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend counts:`, JSON.stringify(results),
  `\n  counts=`,      c,
  `\n  opsRest=`,     opsRest,
  `\n  opsPinned=`,   opsPinned);
process.exit(ok ? 0 : 1);
