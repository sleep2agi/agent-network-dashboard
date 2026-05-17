/* Round 453 verification: chrome reset icon strokeWidth hover lift —
 * 2.5 → 2.8 on hoveredReset && !resetSpinning. Sibling to R443
 * runtime badge inner-icon sw lift.
 *
 * Contract:
 *   - rest: reset icon reports stroke-width '2.5' + hover='false'
 *   - hover the reset button: icon stroke-width '2.8' + hover='true'
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
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-reset-icon]', { timeout: 15000 });
await page.waitForTimeout(400);

const readIcon = () => page.evaluate(() => {
  const i = document.querySelector('[data-topo-chrome-reset-icon]');
  return i ? {
    sw:     i.getAttribute('stroke-width'),
    sw_d:   i.getAttribute('data-topo-chrome-reset-icon-stroke-width'),
    hover:  i.getAttribute('data-topo-chrome-reset-icon-hover'),
  } : null;
});

const rest = await readIcon();

let hover = null;
const btn = await page.$('[data-topo-chrome-reset]');
if (btn) {
  await btn.hover({ force: true });
  await page.waitForTimeout(250);
  hover = await readIcon();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /strokeWidth=\{hoveredReset && !resetSpinning \? '2\.8' : '2\.5'\}/.test(fileText);

await browser.close();

const results = {
  rest_mounted:        !!rest,
  rest_sw_2_5:         rest?.sw === '2.5',
  rest_hover_false:    rest?.hover === 'false',
  hover_sw_2_8:        hover?.sw === '2.8',
  hover_sw_data_2_8:   hover?.sw_d === '2.8',
  hover_hover_true:    hover?.hover === 'true',
  source_wired:        sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome reset icon sw hover:`, JSON.stringify(results),
  '\n  rest:', rest, '\n  hover:', hover);
process.exit(ok ? 0 : 1);
