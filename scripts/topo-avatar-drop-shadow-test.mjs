/* Round 605 — per-node avatar gains drop-shadow on hover,
 * stacked with brightness via banked R582/R583 stacked-filter
 * pattern. 4th hover axis on avatar (brightness + rotate +
 * scale + drop-shadow). 3-element sibling edit (image + 2
 * fallback branches).
 *
 * Test phases:
 *   1. mock 2 idle nodes → avatar renders
 *   2. rest: filter='none', drop-shadow attr 'none'
 *   3. computed transition-property contains 'filter'
 *   4. source: stacked filter conditional + data-attr on all
 *      3 branches
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
await page.waitForSelector('[data-node-avatar-drop-shadow]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-node-avatar-drop-shadow]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    dropShadowAttr: el.getAttribute('data-node-avatar-drop-shadow'),
    brightnessAttr: el.getAttribute('data-node-avatar-brightness') || null,
    rotateAttr: el.getAttribute('data-node-avatar-rotate'),
    scaleAttr: el.getAttribute('data-node-avatar-scale'),
    hoveredAttr: el.getAttribute('data-node-avatar-hovered'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceImageDS = /data-node-avatar-drop-shadow=\{isAvatarHovered \? `0 0 4px \$\{pal\.legendAccent\}99` : 'none'\}/.test(src);
const sourceMonogramDS = /data-node-avatar-monogram-drop-shadow=\{isAvatarFallbackHovered \? `0 0 4px \$\{pal\.legendAccent\}99` : 'none'\}/.test(src);
const sourceFallbackDS = /data-node-avatar-fallback-drop-shadow=\{isAvatarFallbackHovered \? `0 0 4px \$\{pal\.legendAccent\}99` : 'none'\}/.test(src);
const sourceStackedFilters = (src.match(/`drop-shadow\(0 0 4px \$\{pal\.legendAccent\}99\) brightness\(1\.15\)`/g) || []).length >= 3;

const results = {
  avatar_present:         !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_drop_shadow_none:  rest?.dropShadowAttr === 'none',
  rest_hovered_false:     rest?.hoveredAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_image_ds_attr:   sourceImageDS,
  source_monogram_ds:     sourceMonogramDS,
  source_fallback_ds:     sourceFallbackDS,
  source_3_stacked:       sourceStackedFilters,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R605 avatar drop-shadow (3/3 branches, 4-axis hover signature):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
