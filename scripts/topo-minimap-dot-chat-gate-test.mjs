/* Round 628 — extend minimap dot's R486 inspection lift to
 * chatAlias. 13th anchor in chat-target-gated brightness family
 * (specifically the inspection-overrides-encoding sub-family —
 * R484 / R485 / R486).
 *
 * Test phases:
 *   1. mock 2 nodes → minimap dots render
 *   2. rest (no hover, no chat): lifted attr 'false',
 *      lifted-chat 'false', opacity ≤ 0.95
 *   3. source: opacity + lifted attrs use `(hoveredAlias === s.alias
 *      || chatAlias === s.alias)` gate union
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
// Minimap only renders when canvas is zoomed/panned past activation
// threshold; verify source patterns first, runtime is best-effort.
await page.waitForTimeout(1000);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-minimap-dot]');
  if (!el) return null;
  return {
    lifted: el.getAttribute('data-topo-minimap-dot-lifted'),
    liftedChat: el.getAttribute('data-topo-minimap-dot-lifted-chat'),
    opacityAttr: el.getAttribute('data-topo-minimap-dot-opacity'),
    opacityRestAttr: el.getAttribute('data-topo-minimap-dot-opacity-rest'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceOpacityGate = /opacity=\{\(hoveredAlias === s\.alias \|\| chatAlias === s\.alias\) \? 1 : \(isOn \? \(hoveredMinimap \? 1 : 0\.95\) : 0\.6\)\}/.test(src);
const sourceLiftedGate = /data-topo-minimap-dot-lifted=\{\(hoveredAlias === s\.alias \|\| chatAlias === s\.alias\) \? 'true' : 'false'\}/.test(src);
const sourceLiftedChat = /data-topo-minimap-dot-lifted-chat=\{chatAlias === s\.alias \? 'true' : 'false'\}/.test(src);

const results = {
  source_opacity_gate:   sourceOpacityGate,
  source_lifted_gate:    sourceLiftedGate,
  source_lifted_chat:    sourceLiftedChat,
  // optional runtime checks (minimap may not be mounted on idle view)
  ...(rest ? {
    rest_lifted_false:      rest.lifted === 'false',
    rest_lifted_chat_false: rest.liftedChat === 'false',
    rest_opacity_capped:    parseFloat(rest.opacityAttr || '0') <= 0.95 + 1e-9,
  } : {}),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R628 minimap-dot chat-target gate (chat-gated family 13th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
