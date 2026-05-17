/* Round 659 — recent-row text drop-shadow gains a SECOND outer
 * drop-shadow at 4px + 0x40 alpha (half R568 inner 0x80). 18th
 * anchor in multi-layer halo family (1st recent-row-text anchor).
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hello', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-text-halo-layers]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-text-halo-layers]');
  if (!el) return null;
  return {
    layers: el.getAttribute('data-recent-row-text-halo-layers'),
    glow:   el.getAttribute('data-recent-row-text-glow'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 4px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-recent-row-text-halo-layers=\{\(isRowHovered \|\| isRowPinned\) \? '2' : '0'\}/.test(src);

const results = {
  rest_present:       !!rest,
  rest_layers_0:      rest?.layers === '0',
  rest_glow_false:    rest?.glow === 'false',
  source_filter:      sourceFilter,
  source_layers_attr: sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R659 recent-row text multi-layer halo (1st recent-row-text anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
