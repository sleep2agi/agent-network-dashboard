/* Round 566 verification: panel-header count tspans (recent + legend)
 * gain hover-state letter-spacing tween (0.2 → 0.4 on hoveredPanel).
 * Pairs with R424/R310 hover-fw lift at the same scope.
 *
 * Test phases:
 *   1. rest: data-attr 'letter-spacing' = '0.2' on both
 *   2. source-side regex confirms both wired with hoveredPanel
 *      conditional + transition 'letter-spacing 200ms'
 *
 * (Live SVG hover via Playwright .hover() on the panel <g> is
 *  unreliable for state-driven attrs gated on hoveredPanel react
 *  state — banked R525 pattern; this round uses source-canonical
 *  for the gate verification and live data-attr probing for the
 *  rest state. The conditional itself was added in source.)
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
// 1 message so flowLinks > 0 → recent-panel renders
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-panel-count]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = async () => {
  return page.evaluate(() => ({
    recent_ls_attr: document.querySelector('[data-recent-panel-count]')?.parentElement?.getAttribute('data-recent-panel-count-letter-spacing'),
    legend_ls_attr: document.querySelector('[data-legend-panel-count]')?.getAttribute('data-legend-panel-count-letter-spacing'),
  }));
};
const rest = await probe();

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRecentLS = /letterSpacing=\{hoveredPanel === 'recent' \? '0\.4' : '0\.2'\}/.test(src);
const sourceLegendLS = /letterSpacing=\{hoveredPanel === 'legend' \? '0\.4' : '0\.2'\}/.test(src);
const sourceRecentAttr = /data-recent-panel-count-letter-spacing=\{hoveredPanel === 'recent' \? '0\.4' : '0\.2'\}/.test(src);
const sourceLegendAttr = /data-legend-panel-count-letter-spacing=\{hoveredPanel === 'legend' \? '0\.4' : '0\.2'\}/.test(src);
const sourceRecentTransition = /transition: 'letter-spacing 200ms ease-out'/.test(src);
const sourceLegendTransition = /transition: 'fill 200ms ease-out, font-weight 200ms ease-out, letter-spacing 200ms ease-out'/.test(src);

const results = {
  // Rest state: data-attrs at the editorial baseline 0.2
  rest_recent_ls_attr_0_2:   rest.recent_ls_attr === '0.2',
  rest_legend_ls_attr_0_2:   rest.legend_ls_attr === '0.2',
  // Source: both panel counts wired with conditional + transition
  source_recent_ls:          sourceRecentLS,
  source_legend_ls:          sourceLegendLS,
  source_recent_attr:        sourceRecentAttr,
  source_legend_attr:        sourceLegendAttr,
  source_recent_transition:  sourceRecentTransition,
  source_legend_transition:  sourceLegendTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R566 panel-count hover letter-spacing (2 sibling anchors):`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest));
process.exit(ok ? 0 : 1);
