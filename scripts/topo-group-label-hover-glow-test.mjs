/* Round 538 verification: group label drop-shadow extends from pin-only
 * (R479) to ALSO fire on hover, with 2-tier alpha ladder (pin: 80 hex /
 * hover: 4d hex).
 *
 * Test strategy: source-canonical (group labels only render in grid
 * layout AND group hover via Playwright is impractical for the same
 * SVG-deep reasons as edge-hover R534). Rest probe + source regex
 * covers the wiring.
 *
 * Test phases:
 *   1. rest grid (group label visible): glow attr='false', filter='none'
 *   2. source-side regex confirms:
 *      - filter ternary: pin > hover > undefined with 80/4d alpha
 *      - 3-value attr ('pin' | 'hover' | 'false')
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
    localStorage.setItem('anet-topo-layout', 'grid');  // grid for group labels
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Two prefix-groups so groupBoxes render
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'), mk('alpha·2', 'working'),
    mk('beta·1', 'idle'),    mk('beta·2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label-glow]', { timeout: 15000 });
await page.waitForTimeout(800);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-group-label-glow]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    glowAttr:   el.getAttribute('data-group-label-glow'),
    pinnedAttr: el.getAttribute('data-group-label-pinned'),
    filter:     cs.filter,
    transition: cs.transition,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterTernary =
  /filter: isPinned\s+\? `drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\)`\s+: isHovered\s+\? `drop-shadow\(0 0 3px \$\{pal\.legendAccent\}4d\)`\s+: undefined,/.test(src);
const sourceAttrTernary =
  /data-group-label-glow=\{isPinned \? 'pin' : isHovered \? 'hover' : 'false'\}/.test(src);

const results = {
  rest_glow_false:        rest?.glowAttr === 'false',
  rest_pinned_false:      rest?.pinnedAttr === 'false',
  rest_filter_none:       rest?.filter === 'none' || rest?.filter === '',
  rest_transition_has_filter: /\bfilter\b/.test(rest?.transition || ''),
  source_filter_ternary:  sourceFilterTernary,
  source_attr_ternary:    sourceAttrTernary,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R538 group-label hover-glow (source-canonical):`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest));
process.exit(ok ? 0 : 1);
