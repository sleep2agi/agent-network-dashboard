/* Round 540 verification: minimap viewport gains drop-shadow glow on
 * hover, with hover precedence over R481 zoom-state glow. 2-tier alpha
 * ladder (hover 99 / zoom 80).
 *
 * Test strategy: minimap is only visible when canvas is zoomed or
 * panned (default view returns null). Trigger zoom via the chrome
 * zoom-in button, verify zoom-state glow renders, then hover the
 * minimap container and verify hover precedence + alpha distinction
 * via the data-attr. Source regex covers the ternary wiring.
 *
 * Test phases:
 *   1. trigger zoom > 1.5 via chrome zoom-in clicks
 *   2. minimap visible, viewport glow attr = 'zoom'
 *   3. hover minimap container: viewport glow = 'hover'
 *   4. source-side regex confirms 3-value attr + filter ternary
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'), mk('a·3'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 15000 });
await page.waitForTimeout(500);

// Phase 1: click zoom-in until zoom > 1.5 (1.2^3 = 1.728)
for (let i = 0; i < 3; i++) {
  await page.click('[data-topo-chrome-zoom-in]');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(500);

// Minimap should now be visible
await page.waitForSelector('[data-topo-minimap-viewport]', { timeout: 5000 });

// Phase 2: zoom-state read
const zoomState = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-minimap-viewport]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    glow: el.getAttribute('data-topo-minimap-viewport-glow'),
    filter: cs.filter,
  };
});

// Phase 3: hover minimap container
await page.hover('[data-topo-minimap]');
await page.waitForTimeout(400);
const hoverState = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-minimap-viewport]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    glow: el.getAttribute('data-topo-minimap-viewport-glow'),
    filter: cs.filter,
  };
});

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterTernary =
  /filter: hoveredMinimap\s+\? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}99\)`\s+: view\.zoom > 1\.5\s+\? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\)`\s+: undefined,/.test(src);
const sourceAttrTernary =
  /data-topo-minimap-viewport-glow=\{hoveredMinimap \? 'hover' : view\.zoom > 1\.5 \? 'zoom' : 'false'\}/.test(src);

const results = {
  zoom_glow_zoom:        zoomState?.glow === 'zoom',
  zoom_filter_drop_shadow: /drop-shadow/.test(zoomState?.filter || ''),
  hover_glow_hover:      hoverState?.glow === 'hover',
  hover_filter_drop_shadow: /drop-shadow/.test(hoverState?.filter || ''),
  source_filter_ternary: sourceFilterTernary,
  source_attr_ternary:   sourceAttrTernary,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R540 minimap viewport hover-glow:`,
  JSON.stringify(results, null, 2),
  '\n  zoom:', JSON.stringify(zoomState),
  '\n  hover:', JSON.stringify(hoverState));
process.exit(ok ? 0 : 1);
