/* Round 521 verification: chrome nodeSize S/M/L inactive variant gains
 * hover-fw preview — fw 400 (default) → 500 (font-medium, matches active
 * variant). Extends R270 hover-preview idiom to the typography axis.
 *
 * Test phases:
 *   1. inactive rest:  fontWeight = 400, data-attr = '500' (preview target)
 *   2. inactive hover: fontWeight = 500 (preview lands at active fw)
 *   3. active rest:    fontWeight = 500 (existing font-medium class)
 *   4. source-side regex confirms hover:font-medium class + attr wiring
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
await page.waitForSelector('[data-topo-chrome-nodesize]', { timeout: 15000 });
await page.waitForTimeout(800);

// Find the inactive + active buttons via attrs
const buttons = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-topo-chrome-nodesize]'));
  return els.map((el) => ({
    label:        el.getAttribute('data-topo-chrome-nodesize'),
    active:       el.getAttribute('data-topo-chrome-nodesize-active'),
    previewAttr:  el.getAttribute('data-topo-chrome-nodesize-hover-preview-fw'),
    fw:           getComputedStyle(el).fontWeight,
  }));
});

// Find an inactive one. Default nodeScale is M (1) so S + L should be inactive.
const inactiveLabel = buttons.find(b => b.active === 'false')?.label;
if (!inactiveLabel) {
  console.log('❌ R521 — no inactive nodeSize button found');
  process.exit(1);
}
const inactiveSel = `[data-topo-chrome-nodesize="${inactiveLabel}"]`;

// Phase 2: hover the inactive button
await page.hover(inactiveSel);
await page.waitForTimeout(350);
const hoverFw = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).fontWeight, inactiveSel);

// Phase 3: find active button
const active = buttons.find(b => b.active === 'true');

await browser.close();

// Phase 4: source regex
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWiredClass = /hover:bg-cyan-500\/5 active:bg-cyan-500\/15 hover:font-medium/.test(src);
const sourceWiredAttr =
  /data-topo-chrome-nodesize-hover-preview-fw=\{nodeScale === v \? null : '500'\}/.test(src);
const sourceWiredTransition = /transition-\[font-weight\]/.test(src);

const inactiveRest = buttons.find(b => b.label === inactiveLabel);

const results = {
  inactive_rest_fw_400:        inactiveRest?.fw === '400',
  inactive_rest_attr_500:      inactiveRest?.previewAttr === '500',
  inactive_active_attr_false:  inactiveRest?.active === 'false',
  inactive_hover_fw_500:       hoverFw === '500',
  active_rest_fw_500:          active?.fw === '500',
  active_no_preview_attr:      active?.previewAttr === null || active?.previewAttr === undefined,
  source_class_wired:          sourceWiredClass,
  source_attr_wired:           sourceWiredAttr,
  source_transition_wired:     sourceWiredTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R521 nodeSize hover-fw preview:`,
  JSON.stringify(results, null, 2),
  '\n  buttons:', JSON.stringify(buttons),
  '\n  inactive(', inactiveLabel, ')hover fw:', hoverFw);
process.exit(ok ? 0 : 1);
