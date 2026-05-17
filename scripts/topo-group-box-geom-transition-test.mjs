/* Round 461 verification: parent group-box rect transition list
 * extends to include x + y + width + height (200ms ease-out each).
 * Pre-R461 the outer 200×140 px container snap-jumped on cluster
 * resize while the inner R460 hitbox tint rect (160×18) slid —
 * jarring two-rate motion at the same surface. R461 unifies the
 * pair so the whole cluster boundary slides as one Hero D-coherent
 * motion envelope at 200ms.
 *
 * Contract:
 *   - every <rect data-group-box-geom-transition="x,y,width,height">
 *     renders (one per cluster)
 *   - inline style contains all 4 geometry tweens at 200ms
 *   - existing R66 / R248 transition axes (stroke, stroke-width,
 *     fill-opacity, filter, fill) all preserved
 *   - source-file wired
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
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
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
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('beta·1',  'working'),
    mk('beta·2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-group-box-geom-transition]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('[data-group-box-geom-transition]')];
  return {
    count: boxes.length,
    nodes: boxes.map(b => ({
      geom:  b.getAttribute('data-group-box-geom-transition'),
      style: b.getAttribute('style') || '',
    })),
  };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const parentBoxBlockMatch = src.match(/data-group-box-pinned[\s\S]{0,5500}?\/>/);
const parentBoxBlock = parentBoxBlockMatch ? parentBoxBlockMatch[0] : '';
const sourceHasGeomAttr   = /data-group-box-geom-transition="x,y,width,height"/.test(parentBoxBlock);
const sourceHasAll4Tweens = /x 200ms ease-out/.test(parentBoxBlock)
                         && /y 200ms ease-out/.test(parentBoxBlock)
                         && /width 200ms ease-out/.test(parentBoxBlock)
                         && /height 200ms ease-out/.test(parentBoxBlock);
const sourcePreservesR66  = /stroke 200ms ease-out/.test(parentBoxBlock)
                         && /stroke-width 200ms ease-out/.test(parentBoxBlock)
                         && /fill-opacity 200ms ease-out/.test(parentBoxBlock)
                         && /filter 200ms ease-out/.test(parentBoxBlock)
                         && /fill 200ms ease-out/.test(parentBoxBlock);

await browser.close();

const countGe2     = probe.count >= 2;
const allDataAttr  = probe.nodes.every(n => n.geom === 'x,y,width,height');
const allStyle4xy  = probe.nodes.every(n =>
  /x 200ms ease-out/.test(n.style) &&
  /y 200ms ease-out/.test(n.style) &&
  /width 200ms ease-out/.test(n.style) &&
  /height 200ms ease-out/.test(n.style));
const allStyleR66  = probe.nodes.every(n =>
  /stroke 200ms ease-out/.test(n.style) &&
  /fill-opacity 200ms ease-out/.test(n.style) &&
  /filter 200ms ease-out/.test(n.style) &&
  /fill 200ms ease-out/.test(n.style));

const results = {
  box_count_ge_2:           countGe2,
  all_data_attr_xywh:       allDataAttr,
  all_style_has_4_geom:     allStyle4xy,
  all_style_preserves_r66:  allStyleR66,
  source_geom_attr_wired:   sourceHasGeomAttr,
  source_all_4_tweens:      sourceHasAll4Tweens,
  source_preserves_r66:     sourcePreservesR66,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group box geom transition x+y+width+height:`, JSON.stringify(results),
  '\n  count:', probe.count,
  '\n  first style (truncated):', (probe.nodes[0]?.style || '').slice(0, 220));
process.exit(ok ? 0 : 1);
