/* Round 670 — "+N more flows" footer in recent-signal panel extends
 * its single-axis brightness(1.15) hover to the multi-layer drop-
 * shadow halo vocabulary. 29th anchor in the family. The footer is
 * the panel's primary nav into /messages — closing its hover signature
 * at 7 axes (densest on any topology surface).
 *
 * Source assertions:
 *   - filter chain uses pal.legendAccent at 0x80 + 0x40 with 2+4 stride,
 *     gated on hoveredRecentMore
 *   - data-recent-panel-more-halo-layers attr toggles '2' ↔ '0' on hover
 *
 * Runtime assertions:
 *   - footer present (≥6 recent messages so "+N more" shows)
 *   - rest: halo-layers='0', brightness='1', hovered='false'
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1'), mk('a·2'), mk('a·3'), mk('a·4'), mk('a·5'),
    mk('a·6'), mk('a·7'), mk('a·8'),
  ] } });
});
// 10 unique edges across 8 nodes — enough that "+N more flows" footer renders
// (recent panel caps visible rows; surplus surfaces the footer).
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: Array.from({ length: 10 }, (_, i) => ({
  id: `m${i}`,
  from_alias: `a·${(i % 8) + 1}`,
  to_alias:   `a·${((i + 3) % 8) + 1}`,
  kind: i % 2 ? 'task' : 'message',
  content: `ping ${i}`,
  network_id: 'default',
  created_at: fresh,
})) } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-panel-more-hovered]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-panel-more-hovered]');
  return el ? {
    layers:     el.getAttribute('data-recent-panel-more-halo-layers'),
    hovered:    el.getAttribute('data-recent-panel-more-hovered'),
    brightness: el.getAttribute('data-recent-panel-more-brightness'),
  } : null;
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /hoveredRecentMore \? `drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceLayersAttr = /data-recent-panel-more-halo-layers=\{hoveredRecentMore \? '2' : '0'\}/.test(src);

const results = {
  footer_present:     !!restState,
  rest_layers_zero:   restState?.layers === '0',
  rest_hovered_false: restState?.hovered === 'false',
  rest_brightness_1:  restState?.brightness === '1',
  source_filter:      sourceFilter,
  source_layers_attr: sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R670 +N more footer multi-layer halo (7-axis hover closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
