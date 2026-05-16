/* Round 443 verification: runtime badge inner-icon strokeWidth hover
 * lift — 2.4 → 2.8 on node hover. Sibling to R208 outer ring sw lift.
 *
 * Contract:
 *   - rest: every runtime icon path reports stroke-width '2.4' +
 *     active='false'
 *   - hover one node: that icon path stroke-width '2.8' + active='true'
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
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, runtime) => ({
    alias, status, model: 'claude-opus-4', runtime,
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working', 'claude-code-cli'),
    mk('beta',  'idle',    'claude-code-cli'),
    mk('gamma', 'working', 'claude-code-cli'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-runtime-badge-icon]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const ps = [...document.querySelectorAll('[data-runtime-badge-icon]')];
  return ps.map(p => ({
    alias:  p.getAttribute('data-runtime-badge-icon'),
    sw:     p.getAttribute('stroke-width'),
    active: p.getAttribute('data-runtime-badge-icon-active'),
  }));
});

const rest = await readAll();
let hover = null;
const box = await page.evaluate(() => {
  const t = document.querySelector('[data-node-alias-text="alpha"]');
  if (!t) return null;
  const node = t.closest('[data-node]');
  const target = node || t;
  const b = target.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (box) {
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(300);
  hover = await readAll();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /strokeWidth=\{isNodeActive \? '2\.8' : '2\.4'\}/.test(fileText);

await browser.close();

const restAll_2_4    = rest.every(r => r.sw === '2.4');
const restNoActive   = rest.every(r => r.active === 'false');
const hoveredEntry   = hover?.find(r => r.alias === 'alpha');
const hoverSw_2_8    = hoveredEntry?.sw === '2.8';
const hoverActive    = hoveredEntry?.active === 'true';
const othersRest     = hover ? hover.filter(r => r.alias !== 'alpha').every(r => r.sw === '2.4' && r.active === 'false') : false;

const results = {
  rest_count_ge_3:       rest.length >= 3,
  rest_all_sw_2_4:       restAll_2_4,
  rest_all_active_false: restNoActive,
  hover_target_sw_2_8:   hoverSw_2_8,
  hover_target_active:   hoverActive,
  hover_others_stay:     othersRest,
  source_wired:          sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} runtime icon hover sw:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);
