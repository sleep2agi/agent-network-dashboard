/* Round 600 milestone — node vendor avatar gains hover-rotate-3
 * via CSS individual `rotate` property. 6th anchor in hover-
 * rotate idiom. Brings per-node hover signature to 11 axes.
 *
 * Test phases:
 *   1. mock 2 idle nodes → avatar <image> renders
 *   2. rest: rotate='0deg' or 'none', rotate-attr='0'
 *   3. computed transition-property contains 'rotate'
 *   4. transform-origin set to node center coords
 *   5. source: rotate conditional + data-attr + transition extension
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
await page.waitForSelector('[data-node-avatar-rotate]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-avatar-rotate]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    rotate: cs.rotate,
    transformOrigin: cs.transformOrigin,
    transitionProperty: cs.transitionProperty,
    rotateAttr: el.getAttribute('data-node-avatar-rotate'),
    hoveredAttr: el.getAttribute('data-node-avatar-hovered'),
    alias: el.getAttribute('data-node-avatar'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRotate = /rotate: isAvatarHovered \? '3deg' : '0deg'/.test(src);
const sourceAttr = /data-node-avatar-rotate=\{isAvatarHovered \? '3' : '0'\}/.test(src);
const sourceTransformOrigin = /transformOrigin: `\$\{pos\.x\}px \$\{pos\.y\}px`/.test(src);
const sourceTransition = /transition: 'filter 200ms ease-out, rotate 200ms ease-out'/.test(src);

const results = {
  avatar_present:         !!rest,
  rest_rotate_zero:       rest?.rotate === 'none' || rest?.rotate === '0deg',
  rest_rotate_attr:       rest?.rotateAttr === '0',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  has_transform_origin:   !!rest?.transformOrigin && rest.transformOrigin !== '',
  has_alias:              !!rest?.alias,
  transition_has_rotate:  /rotate/.test(rest?.transitionProperty || ''),
  source_rotate:          sourceRotate,
  source_attr:            sourceAttr,
  source_transform_origin: sourceTransformOrigin,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R600 MILESTONE — node avatar rotate (6th hover-rotate anchor, 11-axis per-node):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
