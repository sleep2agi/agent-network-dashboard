/* Round 602 — per-node avatar gains hover-scale-1.05 across
 * all 3 branches (image + monogram + fallback). Avatar now
 * has 3-axis hover signature: rotate (R600/R601) + brightness
 * (R501/R558) + scale (R602). Mirrors R548 brand 书生 logo
 * scale-105 idiom at the per-node tier.
 *
 * Test phases:
 *   1. mock 2 idle nodes → avatar renders
 *   2. rest: scale='none' or '1', scale-attr='1'
 *   3. computed transition-property contains 'scale'
 *   4. source: scale conditional + data-attr + transition extension
 *      on all 3 branches
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
await page.waitForSelector('[data-node-avatar-scale]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-avatar-scale]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    scale: cs.scale,
    transitionProperty: cs.transitionProperty,
    scaleAttr: el.getAttribute('data-node-avatar-scale'),
    rotateAttr: el.getAttribute('data-node-avatar-rotate'),
    hoveredAttr: el.getAttribute('data-node-avatar-hovered'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceImageScale = /data-node-avatar-scale=\{isAvatarHovered \? '1\.05' : '1'\}/.test(src);
const sourceMonogramScale = /data-node-avatar-monogram-scale=\{isAvatarFallbackHovered \? '1\.05' : '1'\}/.test(src);
const sourceFallbackScale = /data-node-avatar-fallback-scale=\{isAvatarFallbackHovered \? '1\.05' : '1'\}/.test(src);
const sourceBothBranchesScale = (src.match(/scale: isAvatarFallbackHovered \? '1\.05' : '1'/g) || []).length >= 2;
const sourceImageBranchScale = /scale: isAvatarHovered \? '1\.05' : '1'/.test(src);
const sourceAllTransitions = (src.match(/transition: 'filter 200ms ease-out, rotate 200ms ease-out, scale 200ms ease-out'/g) || []).length >= 3;

const results = {
  avatar_present:         !!rest,
  // CSS scale at rest = 'none' or '1' depending on browser
  rest_scale_one:         rest?.scale === 'none' || rest?.scale === '1',
  rest_scale_attr:        rest?.scaleAttr === '1',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  transition_has_scale:   /scale/.test(rest?.transitionProperty || ''),
  source_image_attr:      sourceImageScale,
  source_monogram_attr:   sourceMonogramScale,
  source_fallback_attr:   sourceFallbackScale,
  source_image_branch:    sourceImageBranchScale,
  source_both_fallback:   sourceBothBranchesScale,
  source_all_3_transitions: sourceAllTransitions,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R602 avatar scale (3/3 branches, 3-axis hover signature):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
