/* Round 444 verification: group label count tspan fontWeight lift —
 * 500 → 600 on isPinned. Mirror of R416/R424/R425/R426 "data tightens
 * under attention" pattern at group-label-count scope.
 *
 * Contract:
 *   - rest: every group-label-count reports font-weight '500' +
 *     pinned='false'
 *   - click a group-label-hit: that group's count flips to '600' +
 *     pinned='true'
 *   - siblings stay rest
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
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
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('beta·1',  'working'),
    mk('beta·2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-group-label-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-group-label-count]')];
  return ts.map(t => ({
    key:    t.getAttribute('data-group-label-count'),
    fw:     t.getAttribute('font-weight'),
    pinned: t.getAttribute('data-group-label-count-pinned'),
  }));
});

const rest = await readAll();
const firstKey = rest[0]?.key;

// Pin the first group by clicking its label-hit wrapper
let pinned = null;
if (firstKey) {
  const hit = await page.$(`[data-group-label-hit="${firstKey}"]`);
  if (hit) {
    await hit.click();
    await page.waitForTimeout(250);
    pinned = await readAll();
  }
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /fontWeight=\{isPinned \? '600' : '500'\}/.test(fileText);

await browser.close();

const restAll500    = rest.every(r => r.fw === '500');
const restNoPin     = rest.every(r => r.pinned === 'false');
const pinnedEntry   = pinned?.find(r => r.key === firstKey);
const pinnedFw_600  = pinnedEntry?.fw === '600';
const pinnedFlag    = pinnedEntry?.pinned === 'true';
const othersRest    = pinned ? pinned.filter(r => r.key !== firstKey).every(r => r.fw === '500' && r.pinned === 'false') : false;

const results = {
  rest_count_ge_2:        rest.length >= 2,
  rest_all_fw_500:        restAll500,
  rest_no_pin:            restNoPin,
  pinned_target_fw_600:   pinnedFw_600,
  pinned_target_flag:     pinnedFlag,
  pinned_others_stay:     othersRest,
  source_wired:           sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group label count fw pin:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned target:', JSON.stringify(pinnedEntry));
process.exit(ok ? 0 : 1);
