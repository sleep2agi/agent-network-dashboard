/* Round 424 verification: panel header count digit fontWeight 600 →
 * 700 on panel hover. Closes the 5-layer panel hover cue stack with
 * a typographic-weight axis at the panel-header data scope:
 *   R135 drop-shadow (depth)
 *   R348 fill opacity (solidity)
 *   R345 title letter-spacing (spacing)
 *   R423 stroke→legendAccent (color/edge)
 *   R424 count digit fw 600→700 (weight)
 *
 * Contract:
 *   - rest state: data-recent-panel-count + data-legend-panel-count
 *     tspans report computed font-weight matching rest branch (600)
 *   - geometry / R311 / R310 invariants preserved (digit text reads,
 *     R348 rest opacity '0.92' still applies to outer rect)
 *   - source-file probe verifies both panels are wired with
 *     `hoveredPanel === '<key>' ? '700' : '600'` conditional
 *   - panel hover dispatch on the panel <g> is unreliable
 *     (React's onMouseEnter non-bubbling synthetic — same R423
 *     finding); source-file verification is the canonical contract
 *     for the hover branch, same pattern R348/R394/R412/R423 used.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
    mk('alpha', 'working'),
    mk('beta',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-count], [data-legend-panel-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const rest = await page.evaluate(() => {
  const r = document.querySelector('[data-recent-panel-count]');
  const l = document.querySelector('[data-legend-panel-count]');
  return {
    recent: r ? {
      fw_attr: r.getAttribute('font-weight'),
      fw_computed: getComputedStyle(r).fontWeight,
      text: r.textContent,
    } : null,
    legend: l ? {
      fw_attr: l.getAttribute('font-weight'),
      fw_computed: getComputedStyle(l).fontWeight,
      text: l.textContent,
    } : null,
  };
});

// Source-file verification — runtime hover dispatch on the panel <g>
// is unreliable (R423 finding). Same source-file probe pattern.
const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const recentSourceWired = /fontWeight=\{hoveredPanel === 'recent' \? '700' : '600'\}/.test(fileText);
const legendSourceWired = /fontWeight=\{hoveredPanel === 'legend' \? '700' : '600'\}/.test(fileText);
// R247 transition list extended to include font-weight on both
const recentTransitionWired = /transition: 'fill 200ms ease-out, font-weight 200ms ease-out'/.test(fileText);

await browser.close();

const results = {
  // mount / textContent invariants
  recent_mounted:            !!rest.recent,
  legend_mounted:            !!rest.legend,
  recent_has_flows:          /flows/.test(rest.recent?.text || ''),
  legend_has_nodes:          /node/.test(rest.legend?.text  || ''),
  // rest font-weight resolves to base 600 (string '600' from attr or computed)
  recent_rest_fw_600:        rest.recent?.fw_attr === '600' || rest.recent?.fw_computed === '600',
  legend_rest_fw_600:        rest.legend?.fw_attr === '600' || rest.legend?.fw_computed === '600',
  // source-file: both panels wired with conditional fw branch
  source_recent_hover_wired: recentSourceWired,
  source_legend_hover_wired: legendSourceWired,
  // transition list extended to font-weight
  source_transition_wired:   recentTransitionWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel count digit fw hover:`, JSON.stringify(results),
  '\n  rest:', rest);
process.exit(ok ? 0 : 1);
