/* Round 684 — H2 title "Command mesh" extends from 2 typographic hover
 * axes (R554 tracking-tighter + R556 font-bold via group-hover) to
 * also include a multi-layer halo paint axis. Sibling to R683 brand
 * logo (both lift together when ANY surface in the title-block cluster
 * is hovered).
 *
 * Implemented via CSS rule targeting `[data-topo-section-titleblock-
 * group]:hover [data-topo-section-title]` — 2-layer drop-shadow at
 * currentColor (inherits H2 fill), 4+8px stride.
 *
 * Source assertions:
 *   - globals.css has the cluster-hover descendant rule with 2 drop-
 *     shadow layers
 *   - globals.css has transition on the H2 including 'filter 200ms'
 *   - TopoGraph.tsx H2 has data-topo-section-title-halo-layers="2"
 *
 * Runtime assertions:
 *   - H2 element present with data-topo-section-title-halo-layers="2"
 *   - title-block wrapper present (group hover target)
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-section-title]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const title = document.querySelector('[data-topo-section-title]');
  const wrap  = document.querySelector('[data-topo-section-titleblock-group]');
  return {
    title_present: !!title,
    wrap_present:  !!wrap,
    halo_layers:   title?.getAttribute('data-topo-section-title-halo-layers'),
    text:          title?.textContent,
  };
});

await browser.close();

const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');

const cssHoverRule = /\[data-topo-section-titleblock-group\]:hover \[data-topo-section-title\]\s*\{[\s\S]*?drop-shadow\(0 0 4px currentColor\)[\s\S]*?drop-shadow\(0 0 8px currentColor\)/.test(cssSrc);
const cssTransition = /\[data-topo-section-title\]\s*\{[\s\S]*?transition:[\s\S]*?filter 200ms/.test(cssSrc);
const tsxHaloAttr   = /data-topo-section-title-halo-layers="2"/.test(tsxSrc);

const results = {
  title_present:       runtimeState.title_present,
  wrap_present:        runtimeState.wrap_present,
  runtime_halo_layers: runtimeState.halo_layers === '2',
  runtime_text:        runtimeState.text === 'Command mesh',
  css_hover_rule:      cssHoverRule,
  css_transition:      cssTransition,
  tsx_halo_attr:       tsxHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R684 H2 title multi-layer halo (sibling to R683 brand logo):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
