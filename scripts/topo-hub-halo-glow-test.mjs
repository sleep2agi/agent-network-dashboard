/* Round 536 verification: hub halo gains drop-shadow glow on hub-hover —
 * completes hub-cluster glow QUINTET (digit + disc + ring + halo + spokes).
 * preview.50 milestone round.
 *
 * Test phases:
 *   1. rest: glow attr='false', filter='none'
 *   2. hover hub (mouse.move to hub-highlight bbox center, banked R527):
 *      glow='true', filter has cyber emerald-400 drop-shadow at 0.3 alpha
 *   3. transition list includes 'filter 200ms ease-out'
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
await page.waitForSelector('[data-topo-hub-halo-glow]', { timeout: 15000 });
await page.waitForTimeout(800);

const restRead = async () => page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-halo-glow]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    glowAttr:  el.getAttribute('data-topo-hub-halo-glow'),
    hoveredAttr: el.getAttribute('data-topo-hub-halo-hovered'),
    filter:    cs.filter,
    transition: cs.transition,
  };
});

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover hub via hub-highlight bbox
const hubBbox = await page.locator('[data-topo-hub-highlight]').first().boundingBox();
if (hubBbox) {
  await page.mouse.move(hubBbox.x + hubBbox.width / 2, hubBbox.y + hubBbox.height / 2);
}
await page.waitForTimeout(400);
const hover = await restRead();

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterTernary =
  /filter: !reducedMotion && hoveredHub\s+\? \(isLight\s+\? 'drop-shadow\(0 0 2px rgba\(16, 185, 129, 0\.3\)\)'\s+: 'drop-shadow\(0 0 2px rgba\(52, 211, 153, 0\.3\)\)'\)\s+: undefined,/.test(src);
const sourceAttrWired =
  /data-topo-hub-halo-glow=\{!reducedMotion && hoveredHub \? 'true' : 'false'\}/.test(src);
const sourceTransitionExt =
  /transition: 'fill 200ms ease-out, r 200ms ease-out, filter 200ms ease-out',/.test(src);

const results = {
  rest_glow_false:           rest?.glowAttr === 'false',
  rest_hovered_false:        rest?.hoveredAttr === 'false',
  rest_filter_none:          rest?.filter === 'none' || rest?.filter === '',
  rest_transition_has_filter: /\bfilter\b/.test(rest?.transition || ''),
  hover_glow_true:           hover?.glowAttr === 'true',
  hover_hovered_true:        hover?.hoveredAttr === 'true',
  hover_filter_drop_shadow:  /drop-shadow\(.+52,?\s*211,?\s*153/.test(hover?.filter || ''),  // cyber emerald-400
  source_filter_ternary:     sourceFilterTernary,
  source_attr_wired:         sourceAttrWired,
  source_transition_ext:     sourceTransitionExt,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R536 hub-halo glow (QUINTET):`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
