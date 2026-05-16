/* Round 395 verification: edge-badge gains a third hover axis —
 * opacity 0.85 (cyber) / 0.95 (light) → 1.0 on isHoveredEdge.
 * Pre-R395 hovering thickened the stroke (R394 1.25 → 1.5) and
 * grew the radius (R164 9 → 10.5) but the badge's translucency
 * stayed at R371's rest alpha. R395 makes the hovered badge fully
 * opaque so it reads as "in focus" against dim siblings.
 *
 * Contract:
 *   - Cold rest badge (no hover): opacity attr === '0.85' (cyber)
 *   - data-edge-badge-opacity-rest === '0.85' (cyber)
 *   - data-edge-badge-opacity-hover === '1'
 *   - Source-file verification of the hover branch
 *     (`isHoveredEdge ? 1 : (isLight ? 0.95 : 0.85)`) — SVG
 *     hover dispatch is fragile in headless; source-grep is the
 *     reliable probe for the wire change.
 *   - Pre-R395 invariants on cold rest:
 *     * R164 r='9'
 *     * R367 strokeWidth='1.25'
 *     * lifted='false'
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
// Seed a cold flow (count=3 < 10) so badge stays in cold rest mode
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
    opacityAttr:   badge.getAttribute('opacity'),
    restOpacity:   badge.getAttribute('data-edge-badge-opacity-rest'),
    hoverOpacity:  badge.getAttribute('data-edge-badge-opacity-hover'),
    strokeWidth:   badge.getAttribute('stroke-width'),
    rAttr:         badge.getAttribute('r'),
    lifted:        badge.getAttribute('data-edge-badge-lifted'),
  } : null;
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasHover1   = fileText.includes('opacity={isHoveredEdge ? 1 : (isLight ? 0.95 : 0.85)}');
const sourceHasDataHover = fileText.includes('data-edge-badge-opacity-hover="1"');

await browser.close();

const results = {
  // Cold rest (cyber): R371 opacity 0.85
  rest_opacity_0_85:        restProbe?.opacityAttr === '0.85',
  rest_data_0_85:           restProbe?.restOpacity === '0.85',
  // R395: new hover-data attr
  hover_data_1:             restProbe?.hoverOpacity === '1',
  // Pre-R395 invariants
  rest_strokeWidth_1_25:    restProbe?.strokeWidth === '1.25',     // R367 invariant
  rest_r_9:                 restProbe?.rAttr === '9',              // R164 invariant
  rest_lifted_false:        restProbe?.lifted === 'false',
  // Source-file verification of the hover branch
  source_hover_branch:      sourceHasHover1,
  source_data_attr:         sourceHasDataHover,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge hover opacity 0.85 → 1.0:`, JSON.stringify(results),
  '\n  restProbe:', restProbe);
process.exit(ok ? 0 : 1);
