/* Round 623 — extend node halo isHaloHovered gate to include
 * chatAlias. Single conceptual change cascades the halo's
 * 4-state opacity tiers (online/offline × hover/rest). 9th
 * anchor in chat-target-gated brightness family.
 *
 * Test phases:
 *   1. mock 2 idle nodes → node halo renders
 *   2. rest (idle, no hover, no chat): halo at rest opacity
 *      (online cyber 0.65)
 *   3. source: isHaloHovered declaration uses gate union
 *      (hoveredAlias || chatAlias)
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
await page.waitForSelector('[data-node-halo-hovered]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-halo-hovered]');
  if (!el) return null;
  return {
    hoveredAttr: el.getAttribute('data-node-halo-hovered'),
    resolvedAttr: el.getAttribute('data-node-halo-resolved-opacity'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGate = /const isHaloHovered = !reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\)/.test(src);

const results = {
  halo_present:           !!rest,
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  // online cyber rest = 0.65
  rest_opacity_idle:      rest?.resolvedAttr === '0.65',
  source_gate_or:         sourceGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R623 node halo chat-target gate (chat-gated family 9th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
