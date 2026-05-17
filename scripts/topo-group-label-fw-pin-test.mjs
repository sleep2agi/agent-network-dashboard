/* Round 457 verification: group label parent text fontWeight 700 → 800
 * on isPinned. Adds typographic weight axis at parent-text scope.
 *
 * Contract:
 *   - rest: every group-label parent <text> reports font-weight '700' +
 *     pinned='false'
 *   - click a group-label-hit: that group's <text> flips to '800' +
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
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-group-label]')];
  return ts.map(t => ({
    key:    t.getAttribute('data-group-label'),
    fw:     t.getAttribute('font-weight'),
    fw_d:   t.getAttribute('data-group-label-font-weight'),
    pinned: t.getAttribute('data-group-label-pinned'),
  }));
});

const rest = await readAll();
const firstKey = rest[0]?.key;

// Pin first group by clicking its hit-area
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
const sourceWired = /fontWeight=\{isPinned \? '800' : '700'\}/.test(fileText);

await browser.close();

const restAll700    = rest.every(r => r.fw === '700');
const restNoPin     = rest.every(r => r.pinned === 'false');
const pinnedEntry   = pinned?.find(r => r.key === firstKey);
const pinFw800      = pinnedEntry?.fw === '800';
const pinFlag       = pinnedEntry?.pinned === 'true';
const othersRest    = pinned ? pinned.filter(r => r.key !== firstKey).every(r => r.fw === '700' && r.pinned === 'false') : false;

const results = {
  rest_count_ge_2:        rest.length >= 2,
  rest_all_fw_700:        restAll700,
  rest_no_pin:            restNoPin,
  pinned_target_fw_800:   pinFw800,
  pinned_target_flag:     pinFlag,
  pinned_others_stay:     othersRest,
  source_wired:           sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group label fw pin:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned target:', JSON.stringify(pinnedEntry));
process.exit(ok ? 0 : 1);
