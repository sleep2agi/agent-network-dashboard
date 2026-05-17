/* Round 531 verification: legend-row label gains fontWeight 500 → 600 on
 * hover OR pin. Hover-fw family 8th anchor; symmetric to R530 recent-row.
 *
 * Test phases:
 *   1. rest: attr='500', fw=500, hovered/pinned='false'
 *   2. hover legend `idle` row label:
 *      attr='600', fw=600, hovered='true'
 *   3. mouseleave: attr returns to '500'
 *   4. source-side regex confirms ternary + transition list extension
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
  // 3 idle, 1 working — legend rows have counts
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'idle'), mk('a·2', 'idle'), mk('a·3', 'idle'), mk('a·4', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-row-label="idle"]', { timeout: 15000 });
await page.waitForTimeout(800);

const sel = '[data-legend-row-label="idle"]';

const restRead = async () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrFw:      el.getAttribute('data-legend-row-label-font-weight'),
    attrPinned:  el.getAttribute('data-legend-row-label-pinned'),
    attrHovered: el.getAttribute('data-legend-row-label-hovered'),
    fontWeight:  cs.fontWeight,
    transition:  cs.transition,
  };
}, sel);

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover the row label
await page.hover(sel);
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
  /fontWeight=\{\(hoveredStatus === row\.key \|\| isPinned\) \? '600' : '500'\}/.test(src);
const sourceAttrWired =
  /data-legend-row-label-font-weight=\{\(hoveredStatus === row\.key \|\| isPinned\) \? '600' : '500'\}/.test(src);
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
console.log(`${ok ? '✅' : '❌'} R531 legend-label hover-fw:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  leave:', JSON.stringify(leave));
process.exit(ok ? 0 : 1);
