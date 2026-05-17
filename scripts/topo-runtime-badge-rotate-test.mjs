/* Round 599 verification: runtime badge outer <g> gains
 * hover-rotate-3 via CSS individual `rotate` property. 5th
 * anchor in hover-rotate idiom (R350/R547/R549/R576/R599).
 * Extends runtime badge hover signature to 6 axes.
 *
 * Test phases:
 *   1. mock 2 idle nodes → runtime badges render
 *   2. rest: rotate='0deg' (or 'none'), rotate-attr='0'
 *   3. computed transition-property contains 'rotate'
 *   4. transform-origin set to badge center coords
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
await page.waitForSelector('[data-runtime-badge-rotate]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-runtime-badge-rotate]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    rotate: cs.rotate,
    transformOrigin: cs.transformOrigin,
    transitionProperty: cs.transitionProperty,
    rotateAttr: el.getAttribute('data-runtime-badge-rotate'),
    glowAttr: el.getAttribute('data-runtime-badge-glow'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRotate = /rotate: isNodeActive \? '3deg' : '0deg'/.test(src);
const sourceAttr = /data-runtime-badge-rotate=\{isNodeActive \? '3' : '0'\}/.test(src);
const sourceTransformOrigin = /transformOrigin: `\$\{bx\}px \$\{by\}px`/.test(src);
const sourceTransition = /transition: 'filter 150ms ease-out, rotate 150ms ease-out'/.test(src);

const results = {
  badge_present:          !!rest,
  // CSS rotate at rest = 'none' or '0deg' depending on browser
  rest_rotate_zero:       rest?.rotate === 'none' || rest?.rotate === '0deg',
  rest_rotate_attr:       rest?.rotateAttr === '0',
  rest_glow_false:        rest?.glowAttr === 'false',
  has_transform_origin:   !!rest?.transformOrigin && rest.transformOrigin !== '',
  transition_has_rotate:  /rotate/.test(rest?.transitionProperty || ''),
  source_rotate:          sourceRotate,
  source_attr:            sourceAttr,
  source_transform_origin: sourceTransformOrigin,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R599 runtime-badge rotate (5th hover-rotate anchor, badge 6-axis):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
