/* Round 522 verification: chrome Ring/Grid layout toggle's inactive
 * variant gains `hover:font-medium` typography preview. Closes chrome
 * toggle group typography hover-fw family at the last remaining toggle.
 *
 * Test phases:
 *   1. default (layout=ring): Ring active fw=500, Grid inactive fw=400
 *      + Grid data-attr = '500' (preview target)
 *      + Ring data-attr = null
 *   2. hover Grid (inactive): fontWeight → 500 (preview lands)
 *   3. source-side regex confirms hover:font-medium + transition wired
 *      for both buttons
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
await page.waitForSelector('[data-topo-chrome-layout]', { timeout: 15000 });
await page.waitForTimeout(800);

const buttons = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-topo-chrome-layout]'));
  return els.map((el) => ({
    label:       el.getAttribute('data-topo-chrome-layout'),
    active:      el.getAttribute('data-topo-chrome-layout-active'),
    previewAttr: el.getAttribute('data-topo-chrome-layout-hover-preview-fw'),
    fw:          getComputedStyle(el).fontWeight,
  }));
});

// Phase 2: hover the inactive (Grid since layout=ring default)
await page.hover('[data-topo-chrome-layout="grid"]');
await page.waitForTimeout(350);
const gridHoverFw = await page.evaluate(() =>
  getComputedStyle(document.querySelector('[data-topo-chrome-layout="grid"]')).fontWeight
);

await browser.close();

// Source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWiredClassRing = /'ring' \? '.*font-medium.*' : '.*hover:font-medium'.*\$\{chromePopping === 'layout-ring'/.test(src);
const sourceWiredClassGrid = /'grid' \? '.*font-medium.*' : '.*hover:font-medium'.*\$\{chromePopping === 'layout-grid'/.test(src);
const sourceWiredAttrRing  = /data-topo-chrome-layout-hover-preview-fw=\{layout === 'ring' \? null : '500'\}/.test(src);
const sourceWiredAttrGrid  = /data-topo-chrome-layout-hover-preview-fw=\{layout === 'grid' \? null : '500'\}/.test(src);
const sourceWiredTransRing = /transition: '.*font-weight 150ms ease'.*\n.*Ring/.test(src) ||
                             /font-weight 150ms ease'\s*\}\}\s*>\s*\n\s*Ring/.test(src);
const sourceWiredTransGrid = /borderColor:.*containerBorder.*font-weight 150ms ease/.test(src);

const ring = buttons.find(b => b.label === 'ring');
const grid = buttons.find(b => b.label === 'grid');

const results = {
  ring_active_true:        ring?.active === 'true',
  ring_active_fw_500:      ring?.fw === '500',
  ring_no_preview_attr:    ring?.previewAttr === null,
  grid_active_false:       grid?.active === 'false',
  grid_inactive_fw_400:    grid?.fw === '400',
  grid_preview_attr_500:   grid?.previewAttr === '500',
  grid_hover_fw_500:       gridHoverFw === '500',
  source_class_ring:       sourceWiredClassRing,
  source_class_grid:       sourceWiredClassGrid,
  source_attr_ring:        sourceWiredAttrRing,
  source_attr_grid:        sourceWiredAttrGrid,
  source_trans_grid:       sourceWiredTransGrid,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R522 layout hover-fw preview:`,
  JSON.stringify(results, null, 2),
  '\n  buttons:', JSON.stringify(buttons),
  '\n  grid hover fw:', gridHoverFw);
process.exit(ok ? 0 : 1);
