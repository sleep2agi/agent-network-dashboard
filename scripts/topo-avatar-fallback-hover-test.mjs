/* Round 558 verification: per-node avatar hover-brightness family
 * closes at 3 anchors. R501 already covers the vendor.logo image
 * branch; R558 adds the monogram + prefix-group fallback branches.
 *
 * Mock with claude-code-cli runtime and no recognized vendor model
 * → triggers the prefix-group fallback branch (hue-hashed initial).
 *
 * Test phases:
 *   1. wait for [data-node-avatar-fallback] to render
 *   2. rest filter = 'none', hovered attr = 'false'
 *   3. hover the node → filter contains 'brightness(1.15)',
 *      hovered attr = 'true'
 *   4. source-side regex confirms both fallback branches wired
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
// model=null → vendor=unknown → prefix-group fallback branch.
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: null, runtime: null,
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('foo·1'), mk('foo·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-avatar-fallback="foo·1"]', { timeout: 15000 });
await page.waitForTimeout(500);

const avatarSel = '[data-node-avatar-fallback="foo·1"]';
const nodeSel   = 'g[data-node="foo·1"]';

const rest = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    hoveredAttr: el.getAttribute('data-node-avatar-fallback-hovered'),
  };
}, avatarSel);

// Hover the parent node group (the avatar is pointerEvents:none inside,
// but the node group handles hover; node-hovered state is what we test).
await page.hover(nodeSel);
await page.waitForTimeout(400);
const hover = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    hoveredAttr: el.getAttribute('data-node-avatar-fallback-hovered'),
  };
}, avatarSel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceMonogramG = /data-node-avatar-monogram-hovered=\{isAvatarFallbackHovered/.test(src);
const sourceFallbackG = /data-node-avatar-fallback-hovered=\{isAvatarFallbackHovered/.test(src);
const sourceBrightnessExpr = /filter: isAvatarFallbackHovered \? 'brightness\(1\.15\)' : undefined/.test(src);
const sourceTransitionExpr = /transition: 'filter 200ms ease-out'/.test(src);

const results = {
  rest_filter_none:      rest?.filter === 'none',
  rest_hovered_false:    rest?.hoveredAttr === 'false',
  hover_filter_brightness: /brightness\(1\.15\)/.test(hover?.filter || ''),
  hover_hovered_true:    hover?.hoveredAttr === 'true',
  transition_filter:     /filter/.test(rest?.transitionProperty || ''),
  transition_duration:   rest?.transitionDuration === '0.2s',
  source_monogram_group:  sourceMonogramG,
  source_fallback_group:  sourceFallbackG,
  source_brightness_expr: sourceBrightnessExpr,
  source_transition_expr: sourceTransitionExpr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R558 per-node avatar fallback hover-brightness (closes 3-anchor family):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`,
  `\n  hover: ${JSON.stringify(hover)}`);
process.exit(ok ? 0 : 1);
