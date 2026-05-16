/* Round 349 verification: panel header counts pick up editorial
 * letter-spacing 0.2, one tier below the R301 panel title 0.3.
 * Closes the panel-pair editorial symmetry — both top-corner panels
 * now have a 2-step header hierarchy:
 *   title fontSize=12 fontWeight=700 letterSpacing=0.3 (R301)
 *   count fontSize=10 fontWeight=600 letterSpacing=0.2 (R349, this round)
 * Joins the R285 / R289 / R301 / R302 / R304 / R325 editorial-
 * letterspacing tier at the panel-summary scope. The R162 freshness
 * fill, R225 tabular-nums, R311 fontWeight, R336 unit-tspan opacity-0.7
 * split all preserved (SVG inheritance propagates the tier to descendant
 * tspans).
 *
 * Contract:
 *   - Recent-signal panel header count <text> letter-spacing="0.2".
 *   - Legend panel header count <text> letter-spacing="0.2".
 *   - data-{recent,legend}-panel-count-letter-spacing="0.2" attrs present.
 *   - Pre-R349 invariants: R311 fontWeight=600, R225 tabular-nums,
 *     R336 unit-tspan opacity=0.7 all preserved.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
// One message → recent panel mounts.
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-count]', { timeout: 15000 });
await page.waitForSelector('[data-legend-panel-count]', { timeout: 5000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const rTspan  = document.querySelector('[data-recent-panel-count]');
  const rText   = rTspan?.closest('text');
  const rUnit   = document.querySelector('[data-recent-panel-count-unit]');
  const lText   = document.querySelector('[data-legend-panel-count]');
  const lUnit   = document.querySelector('[data-legend-panel-count-unit]');
  return {
    recentTextLs:  rText?.getAttribute('letter-spacing') ?? null,
    recentLsAttr:  rText?.getAttribute('data-recent-panel-count-letter-spacing') ?? null,
    recentFw:      rTspan?.getAttribute('font-weight') ?? null,
    recentUnitOp:  rUnit?.getAttribute('opacity') ?? null,
    legendTextLs:  lText?.getAttribute('letter-spacing') ?? null,
    legendLsAttr:  lText?.getAttribute('data-legend-panel-count-letter-spacing') ?? null,
    legendFw:      lText?.getAttribute('font-weight') ?? null,
    legendUnitOp:  lUnit?.getAttribute('opacity') ?? null,
  };
});

await browser.close();

const results = {
  recent_text_ls_0_2:  probe.recentTextLs === '0.2',
  recent_attr_0_2:     probe.recentLsAttr === '0.2',
  recent_fw_600:       probe.recentFw === '600',           // R311
  recent_unit_op_0_7:  probe.recentUnitOp === '0.7',       // R336
  legend_text_ls_0_2:  probe.legendTextLs === '0.2',
  legend_attr_0_2:     probe.legendLsAttr === '0.2',
  legend_fw_600:       probe.legendFw === '600',           // R310
  legend_unit_op_0_7:  probe.legendUnitOp === '0.7',       // R336
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel count letter-spacing 0.2:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
