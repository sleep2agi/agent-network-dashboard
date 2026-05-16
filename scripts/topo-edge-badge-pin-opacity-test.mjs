/* Round 396 verification: extend the R395 opacity → 1.0 lift to
 * the pinned state. Pin (sticky selection) was reading softer
 * than hover (transient preview) at rest 0.85 cyber / 0.95 light
 * despite being the stronger commitment. R396 unifies hover + pin
 * at opacity 1.0 so the data-edge-badge-lifted='true' surface
 * uniformly carries full alpha.
 *
 * Contract:
 *   - Source-file verification of the unified gate (the wire
 *     change is mechanical; SVG hover/pin dispatch in headless
 *     is fragile but the source is the canonical contract).
 *   - data-edge-badge-opacity-active='1' attr present on cold rest
 *   - data-edge-badge-opacity-rest === '0.85' (cyber) — R371 invariant
 *   - data-edge-badge-opacity-hover === '1' — R395 invariant
 *   - Cold rest opacity attr === '0.85' (cyber) — neither hover nor pin
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping', created_at: fresh, network_id: 'default' },
    { id: 'm2', from_alias: 'alpha', to_alias: 'beta', content: 'pong', created_at: fresh, network_id: 'default' },
    { id: 'm3', from_alias: 'alpha', to_alias: 'beta', content: 'ack',  created_at: fresh, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-badge-stroke-width-rest]', { timeout: 15000 });
await page.waitForTimeout(500);

const restProbe = await page.evaluate(() => {
  const badge = document.querySelector('[data-edge-badge-stroke-width-rest]');
  return badge ? {
    opacityAttr:    badge.getAttribute('opacity'),
    restData:       badge.getAttribute('data-edge-badge-opacity-rest'),
    hoverData:      badge.getAttribute('data-edge-badge-opacity-hover'),
    activeData:     badge.getAttribute('data-edge-badge-opacity-active'),
    lifted:         badge.getAttribute('data-edge-badge-lifted'),
  } : null;
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasUnifiedGate = fileText.includes('opacity={(isHoveredEdge || isPinned) ? 1 : (isLight ? 0.95 : 0.85)}');
const sourceHasActiveData  = fileText.includes('data-edge-badge-opacity-active="1"');

await browser.close();

const results = {
  // Cold rest (no hover, no pin) — pre-R396 path preserved
  rest_opacity_0_85:       restProbe?.opacityAttr === '0.85',
  rest_data_0_85:          restProbe?.restData === '0.85',
  rest_lifted_false:       restProbe?.lifted === 'false',
  // R395 attr preserved + R396 new attr
  hover_data_1:            restProbe?.hoverData === '1',
  active_data_1:           restProbe?.activeData === '1',
  // R396 source-file wire (mechanical change)
  source_unified_gate:     sourceHasUnifiedGate,
  source_active_attr:      sourceHasActiveData,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge opacity unifies hover + pin → 1.0:`, JSON.stringify(results),
  '\n  restProbe:', restProbe);
process.exit(ok ? 0 : 1);
