/* Round 529 verification: hub-highlight gains geometric amplify
 * r 5.5 → 6 on hub-hover — focal-amplify family 3rd anchor.
 *
 * Test phases (workingCount === 0 so highlight renders visibly):
 *   1. rest: data-topo-hub-highlight-radius = 5.5,
 *            computed r ≈ 5.5px (CSS property),
 *            hovered attr = 'false'
 *   2. hover hub (via page.mouse.move to highlight bbox):
 *            data-topo-hub-highlight-radius = 6,
 *            computed r ≈ 6px,
 *            hovered attr = 'true'
 *   3. transition list includes `r 200ms ease-out`
 *   4. source-side regex confirms highlightR ternary + style.r wiring
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
  // workingCount=0 (all idle) so highlight is visible
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1'), mk('alpha·2'), mk('alpha·3'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-hub-highlight]', { timeout: 15000 });
await page.waitForTimeout(800);

const restRead = async () => page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-highlight]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrR:        el.getAttribute('data-topo-hub-highlight-radius'),
    attrHovered:  el.getAttribute('data-topo-hub-highlight-hovered'),
    attrVisible: el.getAttribute('data-topo-hub-highlight-visible'),
    cssR:         cs.r,           // computed CSS `r` value
    transition:   cs.transition,
  };
});

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover hub (via mouse.move to highlight bbox center —
// banked path from R527 hub-digit-ls test)
const bbox = await page.locator('[data-topo-hub-highlight]').first().boundingBox();
if (bbox) {
  await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
}
await page.waitForTimeout(400);
const hover = await restRead();

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHighlightRTernary =
  /const highlightR = !reducedMotion && hoveredHub \? 6 : 5\.5;/.test(src);
const sourceStyleR =
  /r: `\$\{highlightR\}px`,/.test(src);
const sourceTransitionR =
  /transition: 'opacity 300ms ease-out, fill 200ms ease-out, r 200ms ease-out'/.test(src);
const sourceAttrDynamic =
  /data-topo-hub-highlight-radius=\{highlightR\}/.test(src);

const approxEq = (a, b, tol = 0.1) => Math.abs(a - b) < tol;

const results = {
  rest_attr_55:               rest?.attrR === '5.5',
  rest_hovered_false:         rest?.attrHovered === 'false',
  rest_visible_true:          rest?.attrVisible === 'true',  // workingCount=0
  rest_css_r_55:              approxEq(parseFloat(rest?.cssR || '0'), 5.5),
  rest_transition_has_r:      /\br\b/.test(rest?.transition || '') ||
                              /\b(r 200ms|r 0\.2s)/.test(rest?.transition || ''),
  hover_attr_6:               hover?.attrR === '6',
  hover_hovered_true:         hover?.attrHovered === 'true',
  hover_css_r_6:              approxEq(parseFloat(hover?.cssR || '0'), 6),
  source_highlightR_ternary:  sourceHighlightRTernary,
  source_style_r:             sourceStyleR,
  source_transition_r:        sourceTransitionR,
  source_attr_dynamic:        sourceAttrDynamic,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R529 hub-highlight hover r:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
