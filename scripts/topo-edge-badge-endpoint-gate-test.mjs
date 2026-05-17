/* Round 629 — extend edge-badge brightness gate (CIRCLE + TEXT)
 * to include isEndpointHoveredEdge. Closes the badge↔edge
 * brightness parity left open after R624 brightened the visible
 * path on endpoint-hover (incl. chat-target via R624's chatAlias
 * extension). 14th anchor in chat-target-gated brightness family
 * (indirect, via isEndpointHoveredEdge), and also a hover-gated
 * polish — two gate axes added in one expression.
 *
 * Test phases:
 *   1. mock 2 nodes + 3 messages → edge with count=3 visible
 *      (visible threshold), badge mounts
 *   2. rest (no hover, no chat): brightness '1', endpoint-active 'false'
 *      on both circle and text
 *   3. source: filter expression on circle + text includes
 *      isEndpointHoveredEdge in the OR-chain
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'one',   created_at: fresh },
  { from_alias: 'a·1', to_alias: 'a·2', content: 'two',   created_at: fresh },
  { from_alias: 'a·1', to_alias: 'a·2', content: 'three', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const c = document.querySelector('[data-edge-badge-brightness]');
  const t = document.querySelector('[data-edge-badge-text-brightness]');
  return {
    circleBrightness:   c?.getAttribute('data-edge-badge-brightness'),
    circleEndpoint:     c?.getAttribute('data-edge-badge-endpoint-active'),
    circleGlow:         c?.getAttribute('data-edge-badge-glow'),
    textBrightness:     t?.getAttribute('data-edge-badge-text-brightness'),
    textEndpoint:       t?.getAttribute('data-edge-badge-text-endpoint-active'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceCircleFilter = /filter: \(isHoveredEdge \|\| isPinned \|\| isEndpointHoveredEdge\)\s*\n\s*\? `drop-shadow\(0 0 3px \$\{pal\.legendAccent\}99\) brightness\(1\.15\)`/.test(src);
const sourceTextFilter   = /filter: \(isHoveredEdge \|\| isPinned \|\| isHot \|\| isEndpointHoveredEdge\)\s*\n\s*\? 'brightness\(1\.15\)'/.test(src);
const sourceCircleAttr   = /data-edge-badge-brightness=\{\(isHoveredEdge \|\| isPinned \|\| isHot \|\| isEndpointHoveredEdge\) \? '1\.15' : '1'\}/.test(src);
const sourceCircleEpAttr = /data-edge-badge-endpoint-active=\{isEndpointHoveredEdge \? 'true' : 'false'\}/.test(src);
const sourceTextAttr     = /data-edge-badge-text-brightness=\{\(isHoveredEdge \|\| isPinned \|\| isHot \|\| isEndpointHoveredEdge\) \? '1\.15' : '1'\}/.test(src);

const results = {
  circle_present:         rest.circleBrightness != null,
  rest_circle_brightness: rest.circleBrightness === '1',
  rest_circle_endpoint:   rest.circleEndpoint === 'false',
  rest_circle_glow_false: rest.circleGlow === 'false',
  text_present:           rest.textBrightness != null,
  rest_text_brightness:   rest.textBrightness === '1',
  rest_text_endpoint:     rest.textEndpoint === 'false',
  source_circle_filter:   sourceCircleFilter,
  source_text_filter:     sourceTextFilter,
  source_circle_attr:     sourceCircleAttr,
  source_circle_ep_attr:  sourceCircleEpAttr,
  source_text_attr:       sourceTextAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R629 edge-badge endpoint-active gate (chat-gated family 14th anchor, indirect):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
