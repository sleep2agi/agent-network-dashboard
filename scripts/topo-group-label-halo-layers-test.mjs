/* Round 648 — group-label drop-shadow gains a SECOND outer layer
 * on both pin + hover branches. 2nd panel-tier anchor in the
 * multi-layer halo family (after R647 freshness pip).
 *
 * Test phases:
 *   1. mock 2 prefix-group nodes (alpha · 1/2) in grid layout
 *      → group box + label render
 *   2. rest: group label halo-layers='0', no filter
 *   3. source: pin branch + hover branch both stack 2 drop-shadows
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1'), mk('alpha·2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-group-label-halo-layers]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    layers:   el.getAttribute('data-group-label-halo-layers'),
    pinned:   el.getAttribute('data-group-label-pinned'),
    filter:   cs.filter,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourcePinBranch   = /`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)`/.test(src);
const sourceHoverBranch = /`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}4d\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}26\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr  = /data-group-label-halo-layers=\{\(isPinned \|\| isHovered\) \? '2' : '0'\}/.test(src);

const results = {
  rest_present:        !!rest,
  rest_layers_0:       rest?.layers === '0',
  rest_pinned_false:   rest?.pinned === 'false',
  rest_filter_none:    rest?.filter === 'none' || !(/drop-shadow/.test(rest?.filter || '')),
  source_pin_branch:   sourcePinBranch,
  source_hover_branch: sourceHoverBranch,
  source_layers_attr:  sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R648 group-label multi-layer halo (panel-tier 2nd anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
