/* Round 451 verification: hub center halo radius hover lift —
 * r 20 → 22 on hoveredHub.
 *
 * Contract:
 *   - rest: hub halo reports data-topo-hub-halo-radius '20' + hovered='false'
 *   - hover the hub <g>: halo lifts to r '22' + hovered='true'
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
await page.waitForSelector('[data-topo-hub-halo-radius]', { timeout: 15000 });
await page.waitForTimeout(400);

const readHalo = () => page.evaluate(() => {
  const c = document.querySelector('[data-topo-hub-halo-radius]');
  return c ? {
    r_data:  parseFloat(c.getAttribute('data-topo-hub-halo-radius') || '0'),
    hovered: c.getAttribute('data-topo-hub-halo-hovered'),
  } : null;
});

const rest = await readHalo();

let hover = null;
const hubBox = await page.evaluate(() => {
  const hub = document.querySelector('[data-topo-hub]');
  if (!hub) return null;
  const b = hub.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (hubBox) {
  await page.mouse.move(hubBox.x, hubBox.y);
  await page.waitForTimeout(300);
  hover = await readHalo();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /const haloR = isHaloHovered \? 22 : 20/.test(fileText);

await browser.close();

const results = {
  rest_mounted:        !!rest,
  rest_r_20:           rest?.r_data === 20,
  rest_hovered_false:  rest?.hovered === 'false',
  hover_r_22:          hover?.r_data === 22,
  hover_hovered_true:  hover?.hovered === 'true',
  source_wired:        sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub halo hover r:`, JSON.stringify(results),
  '\n  rest:', rest, '\n  hover:', hover);
process.exit(ok ? 0 : 1);
