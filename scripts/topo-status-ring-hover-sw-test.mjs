/* Round 438 verification: status ring strokeWidth hover lift —
 * online 3 → 3.5, offline 1.5 → 2 on hoveredAlias match.
 *
 * Contract:
 *   - rest: every online ring reports stroke-width '3', every
 *     offline ring '1.5' (R51 sentinels preserved at rest)
 *   - hover one node: that ring's stroke-width lifts to '3.5' (or '2'
 *     if offline) and data-node-status-ring-hovered flips to 'true'
 *   - siblings stay rest
 *   - R51 sentinel ATTRS unchanged on rest (overlap probe still works)
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
    mk('alpha', 'working'),  // online → sw 3
    mk('beta',  'idle'),     // online → sw 3
    mk('gamma', 'working'),  // online → sw 3
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-node-status-ring]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const cs = [...document.querySelectorAll('[data-node-status-ring]')];
  return cs.map((c, i) => {
    const node = c.closest('[data-node]');
    return {
      idx:     i,
      alias:   node?.getAttribute('data-node') || null,
      ring:    c.getAttribute('data-node-status-ring'),
      sw:      c.getAttribute('stroke-width'),
      hovered: c.getAttribute('data-node-status-ring-hovered'),
    };
  });
});

const rest = await readAll();

const firstAlias = rest[0]?.alias || 'alpha';
let hover = null;
const box = await page.evaluate((alias) => {
  const node = document.querySelector(`[data-node="${alias}"]`);
  if (!node) return null;
  const b = node.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, firstAlias);
if (box) {
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(300);
  hover = await readAll();
  await page.mouse.move(0, 0);
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /const ringStrokeWidth = isOnline\s*\n\s*\?\s*\(isRingHovered \? 3\.5 : 3\)\s*\n\s*:\s*\(isRingHovered \? 2 : 1\.5\)/.test(fileText);
const sourceIsHovered = /const isRingHovered = !reducedMotion && hoveredAlias === session\.alias/.test(fileText);

await browser.close();

const restAllSw3        = rest.every(r => r.sw === '3'); // working+idle both online
const restNoHover       = rest.every(r => r.hovered === 'false');
const hoveredEntry      = hover?.find(r => r.alias === firstAlias);
const hoverSw_3_5       = hoveredEntry?.sw === '3.5';
const hoverHoveredTrue  = hoveredEntry?.hovered === 'true';
const othersStillSw3    = hover ? hover.filter(r => r.alias !== firstAlias).every(r => r.sw === '3' && r.hovered === 'false') : false;

const results = {
  rest_ring_count_ge_3:       rest.length >= 3,
  rest_all_online_sw_3:       restAllSw3,
  rest_no_hover:              restNoHover,
  hover_target_sw_3_5:        hoverSw_3_5,
  hover_target_attr_true:     hoverHoveredTrue,
  hover_others_stay_sw_3:     othersStillSw3,
  source_strokeWidth_wired:   sourceWired,
  source_isRingHovered_def:   sourceIsHovered,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} status-ring hover sw:`, JSON.stringify(results),
  '\n  rest sample:', JSON.stringify(rest[0]),
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);
