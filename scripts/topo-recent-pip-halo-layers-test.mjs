/* Round 647 — recent-row freshness pip filter gains a SECOND
 * drop-shadow layer at 6px blur with halved alpha (R478 inner
 * 0x80 + R647 outer 0x40). Extends multi-layer halo to first
 * panel-tier anchor.
 *
 * Test phases:
 *   1. mock 1 fresh message → fresh pip alpha > 0.7
 *   2. pip has halo-layers='2', computed filter has 2 drop-shadow
 *      substrings with pal.legendAccent (cyber #67e8f9 cyan) tint
 *   3. source: filter expression stacks 2 drop-shadows fresh-gated
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 5 * 1000).toISOString(); // 5s old → very fresh

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
await page.waitForSelector('[data-recent-row-freshness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const fresh_state = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-freshness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    alpha:   el.getAttribute('data-recent-row-freshness-alpha'),
    layers:  el.getAttribute('data-recent-row-freshness-halo-layers'),
    glow:    el.getAttribute('data-recent-row-freshness-glow'),
    filter:  cs.filter,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) brightness\(1\.15\)`/.test(src);
const sourceLayersAttr = /data-recent-row-freshness-halo-layers=\{alpha > 0\.7 \? '2' : '0'\}/.test(src);

const dropShadowCount = (fresh_state?.filter?.match(/drop-shadow/g) || []).length;

const results = {
  fresh_present:           !!fresh_state,
  fresh_alpha_high:        parseFloat(fresh_state?.alpha || '0') > 0.7,
  fresh_layers_2:          fresh_state?.layers === '2',
  fresh_glow_true:         fresh_state?.glow === 'true',
  fresh_two_dropshadows:   dropShadowCount === 2,
  fresh_brightness:        /brightness/.test(fresh_state?.filter || ''),
  source_filter:           sourceFilter,
  source_layers_attr:      sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R647 recent-row freshness pip multi-layer halo (panel-tier chromatic identity):`,
  JSON.stringify(results, null, 2),
  `\n  fresh: ${JSON.stringify(fresh_state)}`);
process.exit(ok ? 0 : 1);
