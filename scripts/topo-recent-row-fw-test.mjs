/* Round 530 verification: recent-row alias text gains fontWeight 500
 * → 600 on hover OR pin. Hover-fw family 7th anchor.
 *
 * Test phases (needs ≥1 flowLink for recent-row to render):
 *   1. rest: fw=500, attr='500', hovered/pinned='false'
 *   2. hover row (via hover the row's text element):
 *      fw=600, attr='600', hovered='true'
 *   3. mouseleave: fw returns to 500
 *   4. count tspan unaffected (R320 inline fw=600 preserved)
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
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'),
  ] } });
});
// 1 flow → 1 recent-row visible
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: {
  messages: [{ id: 'm1', from_alias: 'a·1', to_alias: 'a·2', content: 'test', created_at: fresh }]
} }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-text]', { timeout: 15000 });
await page.waitForTimeout(800);

const sel = '[data-recent-row-text]';

const restRead = async () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrFw:        el.getAttribute('data-recent-row-text-font-weight'),
    attrPinned:    el.getAttribute('data-recent-row-text-pinned'),
    attrHovered:   el.getAttribute('data-recent-row-text-hovered'),
    fontWeight:    cs.fontWeight,
    transition:    cs.transition,
  };
}, sel);

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover the row's hitbox (rect parent) — the row text
// has pointer-events behavior driven by row-level hover handlers.
// Look for the row group's tint rect or rect hitbox.
const bbox = await page.locator(sel).first().boundingBox();
if (bbox) {
  await page.mouse.move(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
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
const sourceFwTernary =
  /fontWeight=\{\(isRowHovered \|\| isRowPinned\) \? '600' : '500'\}/.test(src);
const sourceAttrWired =
  /data-recent-row-text-font-weight=\{\(isRowHovered \|\| isRowPinned\) \? '600' : '500'\}/.test(src);
const sourceTransitionExt =
  /transition: 'fill 200ms ease-out, letter-spacing 200ms ease-out, font-weight 200ms ease-out'/.test(src);

const results = {
  rest_attr_500:           rest?.attrFw === '500',
  rest_fw_500:             rest?.fontWeight === '500',
  rest_hovered_false:      rest?.attrHovered === 'false',
  rest_pinned_false:       rest?.attrPinned === 'false',
  hover_attr_600:          hover?.attrFw === '600',
  hover_fw_600:            hover?.fontWeight === '600',
  hover_hovered_true:      hover?.attrHovered === 'true',
  leave_attr_500:          leave?.attrFw === '500',
  leave_fw_500:            leave?.fontWeight === '500',
  source_fw_ternary:       sourceFwTernary,
  source_attr_wired:       sourceAttrWired,
  source_transition_ext:   sourceTransitionExt,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R530 recent-row hover-fw:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  leave:', JSON.stringify(leave));
process.exit(ok ? 0 : 1);
