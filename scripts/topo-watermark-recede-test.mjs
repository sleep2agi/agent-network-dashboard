/* Round 525 verification: brand watermark gains focal-recede on
 * non-hub canvas hover — extends R507/R508 focal-recede pattern to
 * 3rd anchor.
 *
 * Test phases:
 *   1. rest:  wrapper opacity=1, recede attr='false'
 *   2. hover an alias (non-hub canvas surface): wrapper opacity=0.7,
 *      recede attr='true'
 *   3. mouseleave: wrapper opacity returns to 1
 *   4. SMIL <animate> still mounted on inner text (R519 preserved)
 *   5. source-side regex confirms wrapper opacity ternary + attr
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-brand-watermark-wrapper]', { timeout: 15000 });
await page.waitForTimeout(800);

// Phase 1: rest
const rest = await page.evaluate(() => {
  const w = document.querySelector('[data-topo-brand-watermark-wrapper]');
  const t = document.querySelector('[data-topo-brand-watermark]');
  const animate = t?.querySelector('animate');
  return {
    wOpacity:    w?.getAttribute('opacity'),
    wRecede:     w?.getAttribute('data-topo-brand-watermark-recede'),
    hasAnimate:  !!animate,
    textContent: t?.textContent?.trim() || null,
  };
});

// Phase 2: trigger focal-recede via hoveredStatus by hovering the
// legend `idle` row's label. setHoveredStatus is one of the recede
// gate vars; the label is a stable hover target (HTML+SVG safe per
// R518 test path).
await page.hover('[data-legend-row-label="idle"]');
await page.waitForTimeout(400);
const hover = await page.evaluate(() => {
  const w = document.querySelector('[data-topo-brand-watermark-wrapper]');
  return {
    wOpacity: w?.getAttribute('opacity'),
    wRecede:  w?.getAttribute('data-topo-brand-watermark-recede'),
  };
});

// Phase 3: physical mouse move far away from any hover target
await page.mouse.move(900, 50);
await page.waitForTimeout(400);
const leave = await page.evaluate(() => {
  const w = document.querySelector('[data-topo-brand-watermark-wrapper]');
  return {
    wOpacity: w?.getAttribute('opacity'),
    wRecede:  w?.getAttribute('data-topo-brand-watermark-recede'),
  };
});

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWiredOpacity =
  /opacity=\{\(hoveredAlias \|\| hoveredEdgeKey \|\| hoveredGroupLabel \|\|\s*hoveredStatus \|\| hoveredVendor\) && !hoveredHub \? 0\.7 : 1\}/.test(src);
const sourceWiredAttr =
  /data-topo-brand-watermark-recede=\{\s*\(hoveredAlias \|\| hoveredEdgeKey \|\| hoveredGroupLabel \|\|\s*hoveredStatus \|\| hoveredVendor\) && !hoveredHub \? 'true' : 'false'\s*\}/.test(src);

const results = {
  rest_wrapper_opacity_1:    rest?.wOpacity === '1',
  rest_recede_false:         rest?.wRecede === 'false',
  rest_has_animate:          rest?.hasAnimate === true,  // R519 SMIL preserved
  rest_text_content:         rest?.textContent === 'sleep2agi',
  hover_wrapper_opacity_07:  hover?.wOpacity === '0.7',
  hover_recede_true:         hover?.wRecede === 'true',
  leave_wrapper_opacity_1:   leave?.wOpacity === '1',
  leave_recede_false:        leave?.wRecede === 'false',
  source_opacity_wired:      sourceWiredOpacity,
  source_attr_wired:         sourceWiredAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R525 watermark focal-recede:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  leave:', JSON.stringify(leave));
process.exit(ok ? 0 : 1);
