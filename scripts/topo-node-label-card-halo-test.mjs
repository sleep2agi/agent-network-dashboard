/* Round 694 — per-node label card backdrop joins the multi-layer halo
 * family on hover/chat branch. Pre-R694 hover/chat filter chain was
 * elevation + brightness only. R694 prepends 2-layer radial drop-
 * shadow at pal.legendAccent (3+6 stride, alpha 80/40) — echoes the
 * R217 hover-stroke outward in soft glow. Sibling to R693 hover-
 * detail card. Rest branch unchanged.
 *
 * Source assertions:
 *   - light hover branch: drop-shadow×2 pal.legendAccent + elevation
 *     + brightness(1.15)
 *   - cyber hover branch: same pattern with cyber elevation alpha
 *   - data-node-label-card-halo-layers attr toggles '2' ↔ '0'
 *
 * Runtime assertions: cards present, halo-layers='0' at rest
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-label-card]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const restState = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[data-node-label-card]'));
  return {
    count: cards.length,
    all_rest_zero: cards.every(el => el.getAttribute('data-node-label-card-halo-layers') === '0'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLightHover = /isLight\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 3px 8px rgba\(15,23,42,0\.20\)\) brightness\(1\.15\)`/.test(src);
const sourceCyberHover = /:\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 4px 12px rgba\(0,0,0,0\.60\)\) brightness\(1\.15\)`/.test(src);
const sourceHaloAttr   = /data-node-label-card-halo-layers=\{!reducedMotion && \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\) \? '2' : '0'\}/.test(src);

const results = {
  cards_present:       restState.count >= 2,
  rest_all_zero:       restState.all_rest_zero,
  source_light_hover:  sourceLightHover,
  source_cyber_hover:  sourceCyberHover,
  source_halo_attr:    sourceHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R694 per-node label card multi-layer halo (50th anchor — sibling to R693 hover-detail card):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${restState.count} cards rendered`);
process.exit(ok ? 0 : 1);
