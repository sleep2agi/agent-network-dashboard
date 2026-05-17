/* Round 527 verification: hub-center workingCount digit gains letter-
 * spacing 0 → 0.3px on hub-hover — focal-amplify family 2nd anchor.
 *
 * Test phases (workingCount > 0 so hub-digit renders):
 *   1. rest:  computed letter-spacing=0px (or 'normal'),
 *             attr = '0px'
 *   2. hover hub: computed letter-spacing=0.3px, attr='0.3px'
 *   3. mouseleave: returns to 0px / normal
 *   4. transition list includes 'letter-spacing 200ms'
 *   5. source-side regex confirms ternary + transition wiring
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 2 working so digit shows "2" (visible) — but we test the css
  // letter-spacing regardless of digit count
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'working'), mk('a·3', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-hub-working-count]', { timeout: 15000 });
await page.waitForTimeout(800);

const restRead = async () => page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-working-count]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrLS:        el.getAttribute('data-topo-hub-working-count-letter-spacing'),
    attrHovered:   el.getAttribute('data-topo-hub-working-count-hovered'),
    letterSpacing: cs.letterSpacing,
    transition:    cs.transition,
  };
});

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover the hub — find a hub-related interactive element.
// hoveredHub is set when the user hovers the hub (R52/R177 family).
// The hub spoke chip-style group has the onPointerEnter. Search for
// data-topo-hub-spoke or hub center clickable.
// Simpler: find the hub container element that triggers hoveredHub.
// From source, hoveredHub is set somewhere — let me try clicking the
// hub center area near (cx, cy) = (500, 340) per VIEWBOX 1000×680.
// But viewport is 1500×1200, so SVG width depends on container.
// Use locator on the hub digit element itself and walk up to find
// a hoverable ancestor — the digit's parent <g> typically has the
// pointer-enter.
const hubBbox = await page.locator('[data-topo-hub-working-count]').first().boundingBox();
if (hubBbox) {
  // Hover slightly off-center to ensure we hit the hub group, not just the digit
  await page.mouse.move(hubBbox.x + hubBbox.width / 2, hubBbox.y + hubBbox.height / 2);
}
await page.waitForTimeout(400);
const hover = await restRead();

// Phase 3: mouseleave
await page.mouse.move(50, 50);
await page.waitForTimeout(400);
const leave = await restRead();

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLsTernary =
  /letterSpacing: !reducedMotion && hoveredHub \? '0\.3px' : '0px',/.test(src);
const sourceAttrWired =
  /data-topo-hub-working-count-letter-spacing=\{!reducedMotion && hoveredHub \? '0\.3px' : '0px'\}/.test(src);
const sourceTransitionExt =
  /transition: 'transform 200ms ease-out, opacity 300ms ease-out, fill 200ms ease-out, font-weight 200ms ease-out, filter 200ms ease-out, letter-spacing 200ms ease-out'/.test(src);

const results = {
  rest_attr_0:               rest?.attrLS === '0px',
  rest_hovered_false:        rest?.attrHovered === 'false',
  rest_ls_0:                 rest?.letterSpacing === '0px' || rest?.letterSpacing === 'normal',
  rest_transition_has_ls:    /letter-spacing/.test(rest?.transition || ''),
  hover_attr_03:             hover?.attrLS === '0.3px',
  hover_hovered_true:        hover?.attrHovered === 'true',
  hover_ls_03:               hover?.letterSpacing === '0.3px',
  leave_attr_0:              leave?.attrLS === '0px',
  source_ls_ternary:         sourceLsTernary,
  source_attr_wired:         sourceAttrWired,
  source_transition_ext:     sourceTransitionExt,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R527 hub-digit hover letter-spacing:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  leave:', JSON.stringify(leave));
process.exit(ok ? 0 : 1);
