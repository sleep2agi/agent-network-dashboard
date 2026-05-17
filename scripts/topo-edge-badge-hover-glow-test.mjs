/* Round 534 verification: edge midpoint badge gains drop-shadow glow on
 * hover/pin (cyan accent), with hover precedence over isHot (amber R480).
 *
 * Test strategy: source-side wiring is canonical because edge hover via
 * Playwright is impractical (topo-panel rect intercepts at SVG root;
 * R48 hitbox is the React handler target but isn't directly hoverable
 * through the panel). Rest-state DOM probe + source regex covers the
 * 4-axis hover-lift parity wiring.
 *
 * Test phases:
 *   1. rest cold: glow attr='false', filter='none', lifted attr='false'
 *      (regression check — pre-R534 behavior unchanged at rest)
 *   2. source-side regex confirms:
 *      - filter ternary precedence: (hovered||pinned) > isHot > undefined
 *      - cyan accent hue (pal.legendAccent) at 99 hex alpha
 *      - data-edge-badge-glow 3-value attr ('hover' | 'hot' | 'false')
 *      - transition list includes filter
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: {
  messages: [{ id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 'test', created_at: fresh }]
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-edge-badge-glow]', { timeout: 15000 });
await page.waitForTimeout(800);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-badge-glow]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    glowAttr:   el.getAttribute('data-edge-badge-glow'),
    liftedAttr: el.getAttribute('data-edge-badge-lifted'),
    filter:     cs.filter,
    transition: cs.transition,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterTernary =
  /filter: \(isHoveredEdge \|\| isPinned\)\s+\? `drop-shadow\(0 0 3px \$\{pal\.legendAccent\}99\)`\s+: isHot\s+\? `drop-shadow\(0 0 3px \$\{hotStroke\}80\)`\s+: undefined,/.test(src);
const sourceAttrTernary =
  /data-edge-badge-glow=\{\(isHoveredEdge \|\| isPinned\) \? 'hover' : isHot \? 'hot' : 'false'\}/.test(src);
const sourceTransitionFilter =
  /transition: 'r 180ms ease-out, stroke 300ms ease-out, stroke-width 300ms ease-out, fill 200ms ease-out, opacity 200ms ease-out, filter 200ms ease-out'/.test(src);

const results = {
  rest_glow_false:           rest?.glowAttr === 'false',
  rest_lifted_false:         rest?.liftedAttr === 'false',
  rest_filter_none:          rest?.filter === 'none' || rest?.filter === '',
  rest_transition_has_filter: /\bfilter\b/.test(rest?.transition || ''),
  source_filter_ternary:     sourceFilterTernary,
  source_attr_ternary:       sourceAttrTernary,
  source_transition_filter:  sourceTransitionFilter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R534 edge-badge hover-glow (source-canonical):`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest));
process.exit(ok ? 0 : 1);
