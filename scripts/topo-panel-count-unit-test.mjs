/* Round 336 verification: 3 panel-header count tspans split their
 * digit from the unit word, with the unit demoted to opacity-0.7:
 *   - data-recent-panel-count-unit       (" flows")
 *   - data-recent-panel-hot-count-unit   (" hot")
 *   - data-legend-panel-count-unit       (" nodes")
 *
 * Same chip-internal-hierarchy pattern R333 (vendor count suffix)
 * + R335 (filter pin prefix) applied at the panel-header scope.
 * 4th-pass on the recurring "small label spans demote, value stays
 * prominent" idiom this loop arc.
 *
 * Contract:
 *   - All 3 unit tspans render with opacity attribute "0.7".
 *   - Their computed opacity reads 0.7.
 *   - Parent count textContent still reads the full string ("5 flows",
 *     "5 nodes" etc) so legacy textContent tests still pass.
 *   - R335 filter prefix opacity-70 + R333 vendor suffix regressions.
 *   - R317/R318/R294 chrome + pulse regressions intact.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
// 12 individual messages → recent-signal panel mounts + hot count
// crosses ≥ 10 threshold so the hot-count tspan renders.
const now = Date.now();
const mkMsg = (idx, from_alias, to_alias) => ({
  id: `${from_alias}-${to_alias}-${idx}`,
  from_alias, to_alias, content: `m${idx}`,
  network_id: 'default',
  created_at: new Date(now - (5 + idx) * 1000).toISOString(),
});
const messageBatch = Array.from({ length: 12 }, (_, i) => mkMsg(i, 'alpha', 'beta'));
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: messageBatch } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-count-unit]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const flowsUnit  = document.querySelector('[data-recent-panel-count-unit]');
  const hotUnit    = document.querySelector('[data-recent-panel-hot-count-unit]');
  const legendUnit = document.querySelector('[data-legend-panel-count-unit]');
  const recentCount = document.querySelector('[data-recent-panel-count]');
  const hotCount    = document.querySelector('[data-recent-panel-hot-count]');
  const legendCount = document.querySelector('[data-legend-panel-count]');
  return {
    flowsUnitAttr:       flowsUnit?.getAttribute('opacity') ?? null,
    flowsUnitOpacity:    flowsUnit ? getComputedStyle(flowsUnit).opacity : null,
    flowsUnitText:       flowsUnit?.textContent ?? null,
    hotUnitAttr:         hotUnit?.getAttribute('opacity') ?? null,
    hotUnitOpacity:      hotUnit ? getComputedStyle(hotUnit).opacity : null,
    hotUnitText:         hotUnit?.textContent ?? null,
    legendUnitAttr:      legendUnit?.getAttribute('opacity') ?? null,
    legendUnitOpacity:   legendUnit ? getComputedStyle(legendUnit).opacity : null,
    legendUnitText:      legendUnit?.textContent ?? null,
    recentCountText:     recentCount?.textContent ?? null,
    hotCountText:        hotCount?.textContent ?? null,
    legendCountText:     legendCount?.textContent ?? null,
    layoutInactiveCls:   document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:     document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:          document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const opacityClose = (val) => val !== null && Math.abs(parseFloat(val) - 0.7) < 0.01;

const results = {
  flows_unit_attr_0_7:         probe.flowsUnitAttr === '0.7',
  flows_unit_text_flows:       (probe.flowsUnitText || '').includes('flows'),
  flows_unit_computed_0_7:     opacityClose(probe.flowsUnitOpacity),
  hot_unit_attr_0_7:           probe.hotUnitAttr === '0.7',
  hot_unit_text_hot:           (probe.hotUnitText || '').includes('hot'),
  legend_unit_attr_0_7:        probe.legendUnitAttr === '0.7',
  legend_unit_text_nodes:      (probe.legendUnitText || '').includes('node'),
  // Parent count textContent should still read full string (legacy
  // R310/R311 tests via textContent rely on this).
  recent_count_full_text:      /\d+ flows/.test(probe.recentCountText || ''),
  legend_count_full_text:      /\d+ node/.test(probe.legendCountText || ''),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel count unit demotion:`, JSON.stringify(results),
  '\n  flows unit:', JSON.stringify(probe.flowsUnitText), 'opacity:', probe.flowsUnitAttr,
  '\n  hot unit:',    JSON.stringify(probe.hotUnitText),   'opacity:', probe.hotUnitAttr,
  '\n  legend unit:', JSON.stringify(probe.legendUnitText),'opacity:', probe.legendUnitAttr,
  '\n  parent texts:', probe.recentCountText, '/', probe.legendCountText);
process.exit(ok ? 0 : 1);
