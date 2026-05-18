/* Round 686 — active-links chip extends from 4+ hover axes (bg/text/
 * border swap + translate-y) to add multi-layer halo paint axis.
 * Inline filter conditional on hoveredActiveLinks state (existing,
 * line 1098) gates 2-layer drop-shadow at pal.legendAccent tint with
 * 2+4 stride, alpha 80/40. 45th anchor — first active-links anchor.
 *
 * Source assertions:
 *   - filter chain uses pal.legendAccent at 80/40 with 2+4 stride,
 *     gated on hoveredActiveLinks && isInteractive
 *   - data-active-links-chip-halo-layers attr toggles '2' ↔ '0'
 *
 * Runtime assertions:
 *   - active-links chip present (renders when sessions exist)
 *   - rest halo-layers='0'
 *   - chip is interactive when flowLinks > 0 (mock messages create flows)
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2'), mk('a·3')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', kind: 'message', content: 'p', network_id: 'default', created_at: fresh },
  { id: 'm2', from_alias: 'a·2', to_alias: 'a·3', kind: 'task',    content: 'p2', network_id: 'default', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-active-links-chip]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const chip = document.querySelector('[data-active-links-chip]');
  return chip ? {
    halo_layers: chip.getAttribute('data-active-links-chip-halo-layers'),
    interactive: chip.getAttribute('data-active-links-clickable'),
    flow_count:  chip.getAttribute('data-active-links-flow-count'),
  } : null;
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: hoveredActiveLinks && isInteractive\s*\?\s*`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\)`\s*: undefined/.test(src);
const sourceAttr   = /data-active-links-chip-halo-layers=\{hoveredActiveLinks && isInteractive \? '2' : '0'\}/.test(src);

const results = {
  chip_present:        !!runtimeState,
  rest_layers_zero:    runtimeState?.halo_layers === '0',
  is_interactive:      runtimeState?.interactive === 'true',
  has_flows:           runtimeState && parseInt(runtimeState.flow_count, 10) >= 1,
  source_filter:       sourceFilter,
  source_layers_attr:  sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R686 active-links chip multi-layer halo (first active-links anchor):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
