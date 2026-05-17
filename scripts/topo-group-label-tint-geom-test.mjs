/* Round 460 verification: group-label tint rect transition list
 * extends to include `x 200ms, width 200ms`. Pre-R460 the hitbox
 * snap-jumped when a cluster grew/shrunk (member joins or leaves
 * re-priced box.x / box.w); R460 tweens both geometry axes so
 * the rect slides into the new bounds matching codex preview.125
 * + R459 200ms motion vocabulary.
 *
 * Contract:
 *   - every <rect data-group-label-tint-geom-transition="x,width">
 *     renders inside the group cluster boundary
 *   - inline style includes 'x 200ms ease-out' AND 'width 200ms
 *     ease-out' alongside the R459 fill+opacity transitions
 *   - source-file conditional wired
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
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const tints = [...document.querySelectorAll('[data-group-label-tint-geom-transition]')];
  return {
    count: tints.length,
    nodes: tints.map(t => ({
      geom: t.getAttribute('data-group-label-tint-geom-transition'),
      style: t.getAttribute('style') || '',
    })),
  };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasGeom = /data-group-label-tint-geom-transition="x,width"/.test(src);
const sourceHasXTween = /x 200ms ease-out/.test(src);
const sourceHasWidthTween = /width 200ms ease-out/.test(src);

await browser.close();

const countGe2 = probe.count >= 2;
const allDataAttrXW = probe.nodes.every(n => n.geom === 'x,width');
const allStyleHasX = probe.nodes.every(n => /x 200ms ease-out/.test(n.style));
const allStyleHasW = probe.nodes.every(n => /width 200ms ease-out/.test(n.style));
const allStylePreservesFillOpacity = probe.nodes.every(n =>
  /fill 200ms ease-out/.test(n.style) && /opacity 200ms ease-out/.test(n.style));

const results = {
  tint_count_ge_2:         countGe2,
  all_data_attr_xw:        allDataAttrXW,
  all_style_has_x:         allStyleHasX,
  all_style_has_width:     allStyleHasW,
  all_style_preserves_fill_opacity: allStylePreservesFillOpacity,
  source_geom_attr_wired:  sourceHasGeom,
  source_x_tween_wired:    sourceHasXTween,
  source_w_tween_wired:    sourceHasWidthTween,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group label tint geom transition x+width:`, JSON.stringify(results),
  '\n  count:', probe.count,
  '\n  first style:', probe.nodes[0]?.style);
process.exit(ok ? 0 : 1);
