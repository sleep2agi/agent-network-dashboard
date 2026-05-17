/* Round 561 verification: group-label opacity lifts to 1.0 when
 * operator hovers a NODE ALIAS that's a member of this group.
 * 4th anchor in the inspection-overrides-encoding family.
 *
 * Mock: 3 'alpha-' prefix sessions (1 group) + 3 standalone
 * (orphan band). Hover the alpha-1 node → group 'alpha·' label
 * should lift opacity 0.55 → 1.0.
 *
 * Test phases:
 *   1. confirm grid layout active
 *   2. rest: group 'alpha·' opacity = 0.55
 *   3. hover a node from alpha group → 'alpha·' opacity = 1.0,
 *      member-alias-hovered attr = 'true'
 *   4. orphan group should NOT lift (its members aren't hovered)
 *   5. source-side regex confirms wiring
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
  const mk = (alias, status = 'idle') => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // alpha-group has WORKING members → ants run at rest. Hovering a
  // member alias should keep ants running (R561 refined gate).
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'), mk('alpha·2', 'working'), mk('alpha·3'),
    mk('foo'), mk('bar'), mk('baz'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(500);

const probeGroups = async () => {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-group-label]'));
    return els.map(el => {
      // Find the matching outer <g> with data-group-box-live to read the
      // ants-gate refinement. The box rect sits within the same parent
      // group as the label — both nest under the per-band <g> in the
      // groupBoxes.map() loop.
      const parent = el.closest('g')?.parentElement || null;
      const boxRect = parent?.querySelector('[data-group-box-live]') || null;
      return {
        key: el.getAttribute('data-group-label'),
        orphan: el.getAttribute('data-group-label-orphan') === 'true',
        opacityAttr: el.getAttribute('data-group-label-opacity'),
        computedOpacity: getComputedStyle(el).opacity,
        memberAliasHovered: el.getAttribute('data-group-label-member-alias-hovered') === 'true',
        boxLive: boxRect?.getAttribute('data-group-box-live'),
      };
    });
  });
};

const restGroups = await probeGroups();

// Hover a node from the alpha group.
await page.hover('g[data-node="alpha·1"]');
await page.waitForTimeout(400);
const hoverGroups = await probeGroups();

await browser.close();

const restAlpha  = restGroups.find(g => g.key === 'alpha·');
const restOrphan = restGroups.find(g => g.orphan);
const hoverAlpha  = hoverGroups.find(g => g.key === 'alpha·');
const hoverOrphan = hoverGroups.find(g => g.orphan);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFlag = /const isMemberAliasHovered = !!hoveredAlias && groupKeys\[hoveredAlias\] === box\.key;/.test(src);
const sourceOpacity = /opacity=\{isPinned \|\| isHovered \|\| isMemberAliasHovered \? 1 : box\.isOrphan \? 0\.4 : 0\.55\}/.test(src);
const sourceAttr = /data-group-label-member-alias-hovered=/.test(src);

const results = {
  alpha_present:                 !!restAlpha,
  orphan_present:                !!restOrphan,
  rest_alpha_opacity_0_55:       restAlpha?.computedOpacity === '0.55',
  rest_alpha_attr_not_hovered:   restAlpha?.memberAliasHovered === false,
  rest_orphan_opacity_0_4:       restOrphan?.computedOpacity === '0.4',
  hover_alpha_opacity_1:         hoverAlpha?.computedOpacity === '1',
  hover_alpha_attr_hovered:      hoverAlpha?.memberAliasHovered === true,
  hover_orphan_opacity_unchanged: hoverOrphan?.computedOpacity === '0.4',
  hover_orphan_attr_not_hovered:  hoverOrphan?.memberAliasHovered === false,
  // R561 ants-gate refinement: alpha group has working members.
  // Rest: ants run ('true'). Pre-R561 hovering a member alias
  // halted ants ('false'); R561 keeps them running on member-alias
  // hover ('true'). Direct label hover would still halt — not
  // exercised here.
  rest_alpha_ants_running:       restAlpha?.boxLive === 'true',
  hover_alpha_ants_keep_running: hoverAlpha?.boxLive === 'true',
  source_flag:                   sourceFlag,
  source_opacity:                sourceOpacity,
  source_attr:                   sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R561 group-label member-alias-hover opacity lift (4th anchor in inspection-overrides-encoding):`,
  JSON.stringify(results, null, 2),
  '\n  rest alpha:', JSON.stringify(restAlpha),
  '\n  rest orphan:', JSON.stringify(restOrphan),
  '\n  hover alpha:', JSON.stringify(hoverAlpha),
  '\n  hover orphan:', JSON.stringify(hoverOrphan));
process.exit(ok ? 0 : 1);
