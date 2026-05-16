/* Round 445 verification: recent-row count tspan fontWeight lift on
 * isRowPinned. Extends R320 cold/hot fw binary (600/700) to also fire
 * on pin. cold+pinned → 700; cold+un-pinned → 600.
 *
 * Contract:
 *   - rest: every recent-row-count reports font-weight '600' +
 *     pinned='false'
 *   - click a recent-row: that row's count flips to '700' +
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
    mk('beta',  'idle'),
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    // Use only 1 message each so neither row crosses the hot threshold (≥10)
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta',  content: 'ping', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'gamma', content: 'pong', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-row-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ts = [...document.querySelectorAll('[data-recent-row-count]')];
  return ts.map(t => {
    const row = t.closest('[data-recent-row]');
    return {
      rowKey: row?.getAttribute('data-recent-row') || null,
      fw:     t.getAttribute('font-weight'),
      pinned: t.getAttribute('data-recent-row-count-pinned'),
      hot:    t.getAttribute('data-recent-row-count-hot'),
    };
  });
});

const rest = await readAll();
const firstRow = rest[0]?.rowKey;

// Pin the first row via click on its <g data-recent-row>
let pinned = null;
if (firstRow) {
  const row = await page.$(`[data-recent-row="${firstRow}"]`);
  if (row) {
    await row.click();
    await page.waitForTimeout(250);
    pinned = await readAll();
  }
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /fontWeight=\{\(isHot \|\| isRowPinned\) \? '700' : '600'\}/.test(fileText);

await browser.close();

const restAll600    = rest.every(r => r.fw === '600');
const restNoPin     = rest.every(r => r.pinned === 'false');
const restNoHot     = rest.every(r => !r.hot || r.hot !== 'true');
const pinnedEntry   = pinned?.find(r => r.rowKey === firstRow);
const pinFw_700     = pinnedEntry?.fw === '700';
const pinFlag       = pinnedEntry?.pinned === 'true';
const othersRest    = pinned ? pinned.filter(r => r.rowKey !== firstRow).every(r => r.fw === '600' && r.pinned === 'false') : false;

const results = {
  rest_count_ge_2:       rest.length >= 2,
  rest_all_fw_600:       restAll600,
  rest_no_pin:           restNoPin,
  rest_no_hot:           restNoHot,
  pinned_target_fw_700:  pinFw_700,
  pinned_target_flag:    pinFlag,
  pinned_others_stay:    othersRest,
  source_wired:          sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row count fw pin:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned target:', JSON.stringify(pinnedEntry));
process.exit(ok ? 0 : 1);
