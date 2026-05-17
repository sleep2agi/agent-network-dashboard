/* Round 517 verification: chrome zoom-level readout gains a 3rd hover
 * axis — color brighten from pal.legendText → pal.legendHeadline.
 *
 * Test phases:
 *   1. rest:  data-topo-chrome-zoom-level-color = 'text'
 *             + computed color matches pal.legendText (cyber: #94a3b8)
 *   2. hover: data-topo-chrome-zoom-level-color = 'headline'
 *             + computed color matches pal.legendHeadline (cyber: #e5e7eb)
 *             + R347 letterSpacing still spreads (0.5px)
 *             + R420 fontWeight still lifts (600)
 *   3. source-side regex confirms the color ternary wiring
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 15000 });
await page.waitForTimeout(800);

// Phase 1: rest
const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrColor:     el.getAttribute('data-topo-chrome-zoom-level-color'),
    attrHover:     el.getAttribute('data-topo-chrome-zoom-level-hover'),
    color:         cs.color,
    letterSpacing: cs.letterSpacing,
    fontWeight:    cs.fontWeight,
  };
});

// Phase 2: hover
await page.hover('[data-topo-chrome-zoom-level]');
await page.waitForTimeout(350);  // 200ms transition + slack
const hover = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrColor:     el.getAttribute('data-topo-chrome-zoom-level-color'),
    attrHover:     el.getAttribute('data-topo-chrome-zoom-level-hover'),
    color:         cs.color,
    letterSpacing: cs.letterSpacing,
    fontWeight:    cs.fontWeight,
  };
});

// Phase 3: source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired =
  /color: hoveredZoomLevel \? pal\.legendHeadline : pal\.legendText,/.test(src) &&
  /data-topo-chrome-zoom-level-color=\{hoveredZoomLevel \? 'headline' : 'text'\}/.test(src);

await browser.close();

// pal.legendText cyber = #94a3b8 → rgb(148, 163, 184)
// pal.legendHeadline cyber = #e5e7eb → rgb(229, 231, 235)
const restColor  = 'rgb(148, 163, 184)';
const hoverColor = 'rgb(229, 231, 235)';

const results = {
  rest_attr_text:           rest?.attrColor === 'text',
  rest_attr_hover_false:    rest?.attrHover === 'false',
  rest_color_legendText:    rest?.color === restColor,
  rest_letter_spacing_0:    rest?.letterSpacing === '0px' || rest?.letterSpacing === 'normal',
  hover_attr_headline:      hover?.attrColor === 'headline',
  hover_attr_hover_true:    hover?.attrHover === 'true',
  hover_color_legendHead:   hover?.color === hoverColor,
  hover_letter_spacing_5:   hover?.letterSpacing === '0.5px',
  hover_font_weight_600:    hover?.fontWeight === '600',
  source_wired:             sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R517 zoom-level 3-axis hover:`, JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest), '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
