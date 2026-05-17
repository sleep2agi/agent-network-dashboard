/* Round 601 — extends R600 hover-rotate-3 to the 2 avatar
 * fallback branches (vendor monogram + prefix-group initial),
 * closing per-node avatar rotate coverage at 3/3 branches.
 * Same R558 brightness-coverage closure pattern, now for rotate.
 *
 * Test phases:
 *   1. mock node with non-vendor-logo runtime → monogram branch
 *      renders OR fallback branch renders (depends on vendor map)
 *   2. rest: rotate='0deg' or 'none', rotate-attr='0'
 *   3. computed transition-property contains 'rotate'
 *   4. transform-origin set to node center coords
 *   5. source: rotate conditional on BOTH branch elements
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
  // Use an unknown vendor model to force fallback branch render
  await route.fulfill({ response: r, json: { ...b, sessions: [
    { alias: 'unknown·1', status: 'idle', model: 'mystery-model-3000',
      runtime: 'claude-code-cli', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'unknown·2', status: 'idle', model: 'mystery-model-3000',
      runtime: 'claude-code-cli', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
// Either monogram or fallback should render based on vendor resolution
await page.waitForSelector('[data-node-avatar-fallback-rotate], [data-node-avatar-monogram-rotate]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const fallback = document.querySelector('[data-node-avatar-fallback-rotate]');
  const monogram = document.querySelector('[data-node-avatar-monogram-rotate]');
  const el = fallback || monogram;
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    branch: fallback ? 'fallback' : 'monogram',
    rotate: cs.rotate,
    transformOrigin: cs.transformOrigin,
    transitionProperty: cs.transitionProperty,
    rotateAttr: el.getAttribute('data-node-avatar-fallback-rotate') || el.getAttribute('data-node-avatar-monogram-rotate'),
    hoveredAttr: el.getAttribute('data-node-avatar-fallback-hovered') || el.getAttribute('data-node-avatar-monogram-hovered'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceMonogramRotate = /data-node-avatar-monogram-rotate=\{isAvatarFallbackHovered \? '3' : '0'\}/.test(src);
const sourceFallbackRotate = /data-node-avatar-fallback-rotate=\{isAvatarFallbackHovered \? '3' : '0'\}/.test(src);
const sourceBothBranches = (src.match(/rotate: isAvatarFallbackHovered \? '3deg' : '0deg'/g) || []).length >= 2;
const sourceBothTransitions = (src.match(/transition: 'filter 200ms ease-out, rotate 200ms ease-out'/g) || []).length >= 3;

const results = {
  branch_present:         !!rest,
  rest_rotate_zero:       rest?.rotate === 'none' || rest?.rotate === '0deg',
  rest_rotate_attr:       rest?.rotateAttr === '0',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  has_transform_origin:   !!rest?.transformOrigin && rest.transformOrigin !== '',
  transition_has_rotate:  /rotate/.test(rest?.transitionProperty || ''),
  source_monogram_rotate: sourceMonogramRotate,
  source_fallback_rotate: sourceFallbackRotate,
  source_both_branches:   sourceBothBranches,
  source_both_transitions: sourceBothTransitions,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R601 avatar fallback rotate (3/3 branches closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
