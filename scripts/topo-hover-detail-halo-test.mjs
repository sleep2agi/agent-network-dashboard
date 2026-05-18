/* Round 693 — hover-detail card backdrop rect joins the multi-layer
 * halo family. Pre-R693 only vertical elevation shadow (drop-shadow
 * 0 4px 12px). R693 prepends 2-layer radial drop-shadow at pal.
 * legendAccent (3+6 stride, alpha 80/40) — radial halo echoes the
 * existing cyan stroke outward in soft glow. The card only renders
 * when hovered (gated on hoveredAlias === session.alias). 49th anchor.
 *
 * Source assertions:
 *   - light filter: drop-shadow(3px pal.legendAccent 80) + (6px 40)
 *     + vertical elevation
 *   - cyber filter: same structure with cyber elevation alpha
 *   - data-topo-hover-detail-halo-layers="2"
 *
 * Runtime assertions: card not visible at rest (gated on hover) —
 * source-level verification is sufficient. Just confirm canvas renders.
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
    mk('a·1'), mk('a·2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-section-title]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  // Card not visible at rest. Just verify the page rendered.
  return {
    canvas_rendered: !!document.querySelector('[data-topo-section-title]'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLightFilter = /isLight\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 4px 12px rgba\(15,23,42,0\.16\)\)`/.test(src);
const sourceCyberFilter = /:\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) drop-shadow\(0 0 6px \$\{pal\.legendAccent\}40\) drop-shadow\(0 4px 12px rgba\(0,0,0,0\.6\)\)`/.test(src);
const sourceHaloAttr    = /data-topo-hover-detail-halo-layers="2"/.test(src);

const results = {
  canvas_rendered:     runtimeState.canvas_rendered,
  source_light_filter: sourceLightFilter,
  source_cyber_filter: sourceCyberFilter,
  source_halo_attr:    sourceHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R693 hover-detail card multi-layer halo (panel-tier 4-layer filter chain):`,
  JSON.stringify(results, null, 2));
process.exit(ok ? 0 : 1);
