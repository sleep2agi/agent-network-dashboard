/* Round 446 verification: legend-row count fontWeight lift on isPinned.
 * 600 → 700 when the status tier is pinned. Mirror of R444/R445 at
 * legend-row scope.
 *
 * Contract:
 *   - rest: every legend-count reports font-weight '600' + pinned='false'
 *   - click a legend-status group: that row's count flips to '700' +
 *     pinned='true'; siblings stay rest
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'working'),
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-legend-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-legend-count]')];
  return ts.map(t => ({
    key:    t.getAttribute('data-legend-count'),
    fw:     t.getAttribute('font-weight'),
    pinned: t.getAttribute('data-legend-count-pinned'),
  }));
});

const rest = await readAll();

// Click the 'working' status row to pin it
let pinned = null;
const workingGroup = await page.$(`[data-legend-status="working"]`);
if (workingGroup) {
  await workingGroup.click();
  await page.waitForTimeout(250);
  pinned = await readAll();
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /fontWeight=\{isPinned \? '700' : '600'\}/.test(fileText);

await browser.close();

const restAll600    = rest.every(r => r.fw === '600');
const restNoPin     = rest.every(r => r.pinned === 'false');
const pinnedEntry   = pinned?.find(r => r.key === 'working');
const pinFw_700     = pinnedEntry?.fw === '700';
const pinFlag       = pinnedEntry?.pinned === 'true';
const othersStayRest = pinned ? pinned.filter(r => r.key !== 'working').every(r => r.fw === '600' && r.pinned === 'false') : false;

const results = {
  rest_three_rows:       rest.length === 3,
  rest_all_fw_600:       restAll600,
  rest_no_pin:           restNoPin,
  pinned_target_fw_700:  pinFw_700,
  pinned_target_flag:    pinFlag,
  pinned_others_stay:    othersStayRest,
  source_wired:          sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend count fw pin:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned target:', JSON.stringify(pinnedEntry));
process.exit(ok ? 0 : 1);
