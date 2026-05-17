/* Round 526 verification: brand crescent at canvas top-left gains
 * focal-recede (4th anchor in family). Multiplies visible opacity by
 * 0.7 when non-hub canvas surface is hovered.
 *
 * Test phases (flowLinks=0 state — crescent visible):
 *   1. rest:  opacity=0.35, recede attr='false', visible='true'
 *   2. hover legend `idle` row: opacity=0.245 (0.35 × 0.7),
 *      recede attr='true'
 *   3. mouseleave: opacity returns to 0.35, recede='false'
 *   4. source-side regex confirms multiplicative opacity + attr wired
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1'), mk('alpha·2'), mk('alpha·3'),
  ] } });
});
// NO messages → flowLinks.length === 0 → crescent visible at opacity 0.35
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-brand-canvas-mark]', { timeout: 15000 });
await page.waitForTimeout(800);

// Phase 1: rest
const rest = await page.evaluate(() => {
  const m = document.querySelector('[data-topo-brand-canvas-mark]');
  return {
    opacity:  parseFloat(m?.getAttribute('opacity') || '0'),
    visible:  m?.getAttribute('data-topo-brand-canvas-mark-visible'),
    recede:   m?.getAttribute('data-topo-brand-canvas-mark-recede'),
  };
});

// Phase 2: hover legend `idle` row (sets hoveredStatus → recede)
await page.hover('[data-legend-row-label="idle"]');
await page.waitForTimeout(400);
const hover = await page.evaluate(() => {
  const m = document.querySelector('[data-topo-brand-canvas-mark]');
  return {
    opacity:  parseFloat(m?.getAttribute('opacity') || '0'),
    visible:  m?.getAttribute('data-topo-brand-canvas-mark-visible'),
    recede:   m?.getAttribute('data-topo-brand-canvas-mark-recede'),
  };
});

// Phase 3: mouseleave
await page.mouse.move(900, 50);
await page.waitForTimeout(400);
const leave = await page.evaluate(() => {
  const m = document.querySelector('[data-topo-brand-canvas-mark]');
  return {
    opacity:  parseFloat(m?.getAttribute('opacity') || '0'),
    recede:   m?.getAttribute('data-topo-brand-canvas-mark-recede'),
  };
});

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceOpacityWired =
  /opacity=\{\(flowLinks\.length === 0 \? 0\.35 : 0\) \* \(\s*\(hoveredAlias \|\| hoveredEdgeKey \|\| hoveredGroupLabel \|\|\s*hoveredStatus \|\| hoveredVendor\) && !hoveredHub \? 0\.7 : 1\s*\)\}/.test(src);
const sourceAttrWired =
  /data-topo-brand-canvas-mark-recede=\{\s*\(hoveredAlias \|\| hoveredEdgeKey \|\| hoveredGroupLabel \|\|\s*hoveredStatus \|\| hoveredVendor\) && !hoveredHub \? 'true' : 'false'\s*\}/.test(src);

const approxEq = (a, b, tol = 0.001) => Math.abs(a - b) < tol;

const results = {
  rest_opacity_035:     approxEq(rest?.opacity, 0.35),
  rest_visible_true:    rest?.visible === 'true',
  rest_recede_false:    rest?.recede === 'false',
  hover_opacity_0245:   approxEq(hover?.opacity, 0.245),
  hover_recede_true:    hover?.recede === 'true',
  hover_visible_still:  hover?.visible === 'true',  // crescent should still be visible
  leave_opacity_035:    approxEq(leave?.opacity, 0.35),
  leave_recede_false:   leave?.recede === 'false',
  source_opacity_wired: sourceOpacityWired,
  source_attr_wired:    sourceAttrWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R526 crescent focal-recede:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  leave:', JSON.stringify(leave));
process.exit(ok ? 0 : 1);
