/* Round 619 — extend isAvatarHovered + isAvatarFallbackHovered
 * to include chatAlias === session.alias. Cascades the same 4
 * avatar axes (brightness + rotate + scale + drop-shadow) to
 * also fire on chat-target across all 3 branches.
 *
 * Test phases:
 *   1. mock 2 idle nodes → avatar renders
 *   2. rest (no hover, no chat): all data attrs reflect idle
 *      state — rotate '0', scale '1', drop-shadow 'none'
 *   3. source: BOTH avatar hover state declarations use
 *      gate union (hoveredAlias || chatAlias)
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
await page.waitForSelector('[data-node-avatar]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-avatar]');
  if (!el) return null;
  return {
    rotateAttr: el.getAttribute('data-node-avatar-rotate'),
    scaleAttr: el.getAttribute('data-node-avatar-scale'),
    hoveredAttr: el.getAttribute('data-node-avatar-hovered'),
    dropShadowAttr: el.getAttribute('data-node-avatar-drop-shadow'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceImageGate = /const isAvatarHovered = !reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\)/.test(src);
const sourceFallbackGate = /const isAvatarFallbackHovered = !reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\)/.test(src);

const results = {
  avatar_present:         !!rest,
  rest_rotate_zero:       rest?.rotateAttr === '0',
  rest_scale_one:         rest?.scaleAttr === '1',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  rest_drop_shadow_none:  rest?.dropShadowAttr === 'none',
  source_image_gate:      sourceImageGate,
  source_fallback_gate:   sourceFallbackGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R619 avatar chat-target gate (chat-gated family 5th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
