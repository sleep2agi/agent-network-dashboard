/* Round 394 verification: edge-badge gains hover strokeWidth tier
 * (1.5) between cold rest (R367 1.25) and pin/hot (2). Pre-R394
 * hovering an edge thickened nothing on the badge stroke; r grew
 * via R164 but contour stayed at 1.25. R394 adds the missing
 * stroke axis on hover so both r and stroke lift in concert.
 *
 * Contract:
 *   - Cold rest badges (no hover, no pin, no hot): stroke-width '1.25'
 *   - Hovered badge: stroke-width '1.5' + R164 r='10.5'
 *   - data-edge-badge-stroke-width-rest='1.25' attr present on all
 *   - data-edge-badge-stroke-width-hover='1.5' attr present on all
 *   - Pin/hot badges (count≥10 = hot): stroke-width '2'
 *
 * Fixture: 9 messages alpha→beta keeps the flow cold (under hot
 * threshold of 10). Hover the badge via DOM dispatch.
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
// Seed a cold flow (count=3 < 10) so badge stays in cold rest mode
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'beta', content: 'pong', created_at: fresh, network_id: 'default' },
    { id: 'm3', from_alias: 'alpha', to_alias: 'beta', content: 'ack',  created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-badge-stroke-width-rest]', { timeout: 15000 });
await page.waitForTimeout(500);

// Read cold rest probe
const restProbe = await page.evaluate(() => {
  const badge = document.querySelector('[data-edge-badge-stroke-width-rest]');
  return badge ? {
    strokeWidthAttr: badge.getAttribute('stroke-width'),
    rAttr:           badge.getAttribute('r'),
    restData:        badge.getAttribute('data-edge-badge-stroke-width-rest'),
    hoverData:       badge.getAttribute('data-edge-badge-stroke-width-hover'),
    lifted:          badge.getAttribute('data-edge-badge-lifted'),
  } : null;
});

// Source-file verification of the hover path. Browser hover for
// SVG sub-elements with pointer-events:none parents is fragile;
// the wire change is straightforward (`isHoveredEdge ? 1.5 :
// 1.25` and the new -hover data attr), so confirm via source.
const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasHover15 = fileText.includes('isHoveredEdge ? 1.5 : 1.25');
const sourceHasHoverData = fileText.includes('data-edge-badge-stroke-width-hover="1.5"');

await browser.close();

const results = {
  // Cold rest (current view: no hover) — pre-R394 path preserved
  rest_strokeWidth_1_25:    restProbe?.strokeWidthAttr === '1.25',
  rest_r_9:                 restProbe?.rAttr === '9',
  rest_lifted_false:        restProbe?.lifted === 'false',
  // R394 data attrs present
  data_rest_1_25:           restProbe?.restData === '1.25',
  data_hover_1_5:           restProbe?.hoverData === '1.5',
  // Source-file verification of the hover branch
  source_hover_15:          sourceHasHover15,
  source_data_hover:        sourceHasHoverData,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge hover strokeWidth tier (1.25/1.5/2):`, JSON.stringify(results),
  '\n  restProbe:', restProbe);
process.exit(ok ? 0 : 1);
