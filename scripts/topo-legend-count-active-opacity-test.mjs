/* Round 449 verification: legend-row count active-state opacity
 * 0.95 → 1.0 on (hoveredStatus===row.key || isPinned). Closes the 5%
 * alpha gap on populated active rows.
 *
 * Contract:
 *   - rest: every populated legend-count reports opacity '0.65' (R204)
 *   - click 'working' status: that count opacity '1'
 *   - empty (0-count) rows stay at R204 dim (0.28/0.30) unaffected
 *   - siblings stay at rest 0.65
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
    key:     t.getAttribute('data-legend-count'),
    opacity: t.getAttribute('opacity'),
    empty:   t.getAttribute('data-legend-count-empty'),
  }));
});

const rest = await readAll();

// Click 'working' status row to pin
let pinned = null;
const workingGroup = await page.$(`[data-legend-status="working"]`);
if (workingGroup) {
  await workingGroup.click();
  await page.waitForTimeout(250);
  pinned = await readAll();
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /:\s*\(hoveredStatus === row\.key \|\| isPinned \? 1 : 0\.65\)/.test(fileText);

await browser.close();

// rest: populated rows (working=2, idle=1) should be 0.65; offline (count=0) should be 0.28/0.30
const workingRest = rest.find(r => r.key === 'working');
const idleRest = rest.find(r => r.key === 'idle');
const offlineRest = rest.find(r => r.key === 'offline');

const restWorking_065 = workingRest?.opacity === '0.65';
const restIdle_065 = idleRest?.opacity === '0.65';
const restOfflineEmpty = offlineRest?.empty === 'true' && (offlineRest?.opacity === '0.3' || offlineRest?.opacity === '0.28');

// pinned: working should be 1
const pinnedWorking = pinned?.find(r => r.key === 'working');
const pinnedIdle = pinned?.find(r => r.key === 'idle');
const pinnedOffline = pinned?.find(r => r.key === 'offline');

const pinWorking_1 = pinnedWorking?.opacity === '1';
const pinIdleRest = pinnedIdle?.opacity === '0.65';
const pinOfflineEmpty = pinnedOffline?.empty === 'true';

const results = {
  rest_working_065:          restWorking_065,
  rest_idle_065:             restIdle_065,
  rest_offline_empty_dim:    restOfflineEmpty,
  pin_working_opacity_1:     pinWorking_1,
  pin_idle_stays_rest_065:   pinIdleRest,
  pin_offline_stays_empty:   pinOfflineEmpty,
  source_wired:              sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend count active opacity:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned:', JSON.stringify(pinned));
process.exit(ok ? 0 : 1);
