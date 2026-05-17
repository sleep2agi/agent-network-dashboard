/* Round 537 verification: legend swatch gains drop-shadow glow on
 * hover/pin using its own row.fill color — drop-shadow family 13th
 * anchor.
 *
 * Test phases:
 *   1. rest: data-legend-swatch-glow='false', filter='none'
 *   2. hover legend 'idle' row label (banked R518 path): swatch's glow
 *      attr='true', filter matches drop-shadow with the idle row fill
 *      (cyber #2dd4bf teal-400)
 *   3. mouseleave: returns to 'false'/'none'
 *   4. source-side regex confirms filter ternary + transition wiring
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'idle'), mk('a·2', 'idle'), mk('a·3', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-swatch="idle"]', { timeout: 15000 });
await page.waitForTimeout(800);

const sel = '[data-legend-swatch="idle"]';

const restRead = async () => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    glowAttr:    el.getAttribute('data-legend-swatch-glow'),
    state:       el.getAttribute('data-legend-swatch-state'),
    filter:      cs.filter,
    transition:  cs.transition,
  };
}, sel);

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover the legend 'idle' row label — sibling row hover sets
// hoveredStatus='idle' which is the same gate as the swatch's hover.
await page.hover('[data-legend-row-label="idle"]');
await page.waitForTimeout(400);
const hover = await restRead();

// Phase 3: mouseleave
await page.mouse.move(50, 50);
await page.waitForTimeout(400);
const leave = await restRead();

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterTernary =
  /filter: \(isRowHovered \|\| isPinned\)\s+\? `drop-shadow\(0 0 3px \$\{row\.fill\}99\)`\s+: undefined,/.test(src);
const sourceAttrWired =
  /data-legend-swatch-glow=\{\(isRowHovered \|\| isPinned\) \? 'true' : 'false'\}/.test(src);
const sourceTransitionExt =
  /transition: 'r 150ms ease-out, filter 150ms ease-out',/.test(src);

const results = {
  rest_glow_false:           rest?.glowAttr === 'false',
  rest_state_idle:           rest?.state === 'idle',
  rest_filter_none:          rest?.filter === 'none' || rest?.filter === '',
  rest_transition_has_filter: /\bfilter\b/.test(rest?.transition || ''),
  hover_glow_true:           hover?.glowAttr === 'true',
  hover_state_hover:         hover?.state === 'hover',
  hover_filter_drop_shadow:  /drop-shadow/.test(hover?.filter || ''),
  hover_filter_has_teal:     /rgba?\(45,?\s*212,?\s*191/.test(hover?.filter || ''),  // cyber idle teal-400 #2dd4bf (computed as rgba(...))
  leave_glow_false:          leave?.glowAttr === 'false',
  leave_filter_none:         leave?.filter === 'none' || leave?.filter === '',
  source_filter_ternary:     sourceFilterTernary,
  source_attr_wired:         sourceAttrWired,
  source_transition_ext:     sourceTransitionExt,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R537 legend-swatch glow:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  leave:', JSON.stringify(leave));
process.exit(ok ? 0 : 1);
