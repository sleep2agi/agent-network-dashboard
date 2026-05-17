/* Round 559 verification: runtime badge outer <g> gains drop-shadow
 * glow using rt.color on node hover. 16th anchor in drop-shadow
 * family. Pairs with R208 (ring r+sw) + R443 (icon sw) for 3-axis
 * hover signature.
 *
 * runtimeIdentity('claude-code-cli').color is one of:
 *   '#a78bfa', '#38bdf8', '#34d399', '#fbbf24'
 *
 * Test phases:
 *   1. mock sessions with runtime → badge renders
 *   2. rest: outer <g> filter='none', glow attr='false'
 *   3. hover the parent node group → filter contains 'drop-shadow',
 *      glow attr='true', and the existing R208 ring r/sw still lift
 *   4. source: drop-shadow with rt.color hex+99 alpha + transition
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
// Use claude-code-cli runtime so the runtime badge renders.
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
await page.waitForSelector('[data-runtime-badge="a·1"]', { timeout: 15000 });
await page.waitForTimeout(500);

// The outer <g> wrapping the runtime badge carries the glow filter.
// We can locate it via the parent of the [data-runtime-badge] circle.
const probe = async (state) => {
  return page.evaluate(() => {
    const circle = document.querySelector('[data-runtime-badge="a·1"]');
    if (!circle) return null;
    const outerG = circle.parentElement;
    if (!outerG) return null;
    const cs = getComputedStyle(outerG);
    const ringCs = getComputedStyle(circle);
    return {
      outerFilter: cs.filter,
      outerTransitionProperty: cs.transitionProperty,
      outerTransitionDuration: cs.transitionDuration,
      glowAttr: outerG.getAttribute('data-runtime-badge-glow'),
      ringR: ringCs.r,
      ringSw: ringCs.strokeWidth,
      activeAttr: circle.getAttribute('data-runtime-badge-active'),
    };
  });
};

const rest = await probe();

await page.hover('g[data-node="a·1"]');
await page.waitForTimeout(400);
const hover = await probe();

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: isNodeActive\s*\?\s*`drop-shadow\(0 0 2px \$\{rt\.color\}99\)`\s*:\s*undefined,/.test(src);
const sourceTransition = /transition: 'filter 150ms ease-out',/.test(src);
const sourceGlowAttr = /data-runtime-badge-glow=\{isNodeActive \? 'true' : 'false'\}/.test(src);

const results = {
  rest_filter_none:        rest?.outerFilter === 'none',
  rest_glow_false:         rest?.glowAttr === 'false',
  rest_ring_r_7:           rest?.ringR === '7px',
  rest_ring_sw_1_5:        rest?.ringSw === '1.5px',
  rest_active_false:       rest?.activeAttr === 'false',
  hover_filter_dropshadow: /drop-shadow\(/.test(hover?.outerFilter || ''),
  hover_glow_true:         hover?.glowAttr === 'true',
  hover_ring_r_8:          hover?.ringR === '8px', // R208 still lifts
  hover_ring_sw_2:         hover?.ringSw === '2px', // R208 still lifts
  hover_active_true:       hover?.activeAttr === 'true',
  transition_has_filter:   /filter/.test(rest?.outerTransitionProperty || ''),
  transition_duration:     rest?.outerTransitionDuration === '0.15s',
  source_filter:           sourceFilter,
  source_transition:       sourceTransition,
  source_glow_attr:        sourceGlowAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R559 runtime badge drop-shadow glow (16th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`,
  `\n  hover: ${JSON.stringify(hover)}`);
process.exit(ok ? 0 : 1);
