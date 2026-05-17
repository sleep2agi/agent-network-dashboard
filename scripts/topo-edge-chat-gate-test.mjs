/* Round 624 — extend isEndpointHoveredEdge gate to include
 * chatAlias. All edges incident on the chat partner now light
 * up. 10th anchor in chat-target-gated brightness family.
 *
 * Test phases:
 *   1. mock 2 nodes + 1 flow message → 1 flowLink/edge renders
 *   2. rest (no hover, no chat): edge at idle stroke-width
 *   3. source: isEndpointHoveredEdge declaration uses gate union
 *      `(hover || chat)` joined by ||
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
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-visible]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-visible]');
  if (!el) return null;
  return {
    endpointAttr: el.getAttribute('data-edge-visible-endpoint-hovered'),
    brightnessAttr: el.getAttribute('data-edge-visible-brightness'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGate = /const isEndpointHoveredEdge = \(!!hoveredAlias && \(link\.from === hoveredAlias \|\| link\.to === hoveredAlias\)\)\s*\|\|\s*\(!!chatAlias\s*&& \(link\.from === chatAlias\s*\|\| link\.to === chatAlias\)\)/.test(src);

const results = {
  edge_present:           !!rest,
  rest_endpoint_false:    rest?.endpointAttr === 'false',
  rest_brightness_1:      rest?.brightnessAttr === '1',
  source_gate_or:         sourceGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R624 incident-edge chat-target gate (chat-gated family 10th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
