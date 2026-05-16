/* Round 435 verification: hub-spoke stroke-width hover lift —
 * sibling to R430 opacity hover at the same surface. 2-axis hover
 * signature now: paint (opacity R430) + geometry (stroke-width R435).
 *
 * Rest tiers:
 *   idle    sw 1.00 / α 0.50
 *   active  sw 2.25 / α 0.80
 * Hover tiers (hoveredAlias === session.alias):
 *   idle    sw 1.25 / α 0.70
 *   active  sw 2.50 / α 0.95
 *
 * Contract:
 *   - rest: all idle spokes report data-topo-hub-spoke-stroke-width '1'
 *   - hover one node: exactly one spoke flips to hover with sw '1.25'
 *     AND opacity '0.7' (both R430+R435 axes lift together)
 *   - siblings stay rest sw '1' / opacity '0.5'
 *   - source-file probe confirms wired stroke-width conditional
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-spoke-active]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const paths = [...document.querySelectorAll('[data-topo-hub-spoke-active]')];
  return paths.map((p, i) => ({
    idx:     i,
    active:  p.getAttribute('data-topo-hub-spoke-active'),
    hovered: p.getAttribute('data-topo-hub-spoke-hovered'),
    opacity: p.getAttribute('data-topo-hub-spoke-opacity'),
    sw:      p.getAttribute('data-topo-hub-spoke-stroke-width'),
    sw_a:    p.getAttribute('stroke-width'),
  }));
});

const rest = await readAll();

// Hover the first node's <g> group
const firstAlias = await page.evaluate(() => {
  const t = document.querySelector('[data-node-alias-text]');
  return t?.getAttribute('data-node-alias-text');
});
let hover = null;
if (firstAlias) {
  const box = await page.evaluate((alias) => {
    const t = document.querySelector(`[data-node-alias-text="${alias}"]`);
    if (!t) return null;
    const node = t.closest('[data-node]');
    const target = node || t;
    const b = target.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, firstAlias);
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(300);
    hover = await readAll();
    await page.mouse.move(0, 0);
  }
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /const spokeStrokeWidth = isActiveSpoke\s*\n\s*\?\s*\(isHoveredSpoke\s*\?\s*2\.5\s*:\s*2\.25\)\s*\n\s*:\s*\(isHoveredSpoke\s*\?\s*1\.25\s*:\s*1\)/.test(fileText);

await browser.close();

const restAllIdle    = rest.length > 0 && rest.every(r => r.active === 'false');
const restAllSw1     = rest.every(r => r.sw === '1');
const restAllOpacity = rest.every(r => r.opacity === '0.5');
const restNoHover    = rest.every(r => r.hovered === 'false');
const hoveredCount   = hover ? hover.filter(s => s.hovered === 'true').length : -1;
const hoveredEntry   = hover?.find(s => s.hovered === 'true');
const hoverSw_1_25   = hoveredEntry?.sw === '1.25';
const hoverOpacity_0_7 = hoveredEntry?.opacity === '0.7';
const othersRestSw   = hover ? hover.filter(s => s.hovered === 'false').every(s => s.sw === '1') : false;

const results = {
  rest_spoke_count_ge_3:        rest.length >= 3,
  rest_all_idle:                restAllIdle,
  rest_all_sw_1:                restAllSw1,
  rest_all_opacity_0_5:         restAllOpacity,
  rest_no_hover:                restNoHover,
  hover_exactly_one_match:      hoveredCount === 1,
  hover_target_sw_1_25:         hoverSw_1_25,
  hover_target_opacity_0_7:     hoverOpacity_0_7, /* R430 parity */
  hover_others_stay_sw_1:       othersRestSw,
  source_strokeWidth_3tier:     sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-spoke hover sw (R435):`, JSON.stringify(results),
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);
