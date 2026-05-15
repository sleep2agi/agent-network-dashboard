/* Round 53 verification: edges between two members of the hovered prefix
 * group brighten to 1.3× even if neither endpoint is the exact hovered
 * alias. Edges leaving the team still dim per R40.
 *
 * Sessions:
 *   alpha1, alpha2, alpha3   — share prefix "alpha" → same group
 *   beta                     — singleton
 * Messages:
 *   alpha1 → alpha2  (touches alpha1 directly → 1.7× per R40)
 *   alpha2 → alpha3  (BOTH in alpha group but neither is hovered → 1.3× per R53)
 *   alpha1 → beta    (touches alpha1, beta is outside → 1.7× per R40)
 *   alpha2 → beta    (in-group endpoint, but beta is outside → 0.35× per R40)
 *
 * Hover alpha1 and read the visible flow paths' opacity to validate the
 * 4-tier ladder.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['alpha1', 'alpha2', 'alpha3', 'beta'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
const now = new Date().toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { from_alias: 'alpha1', to_alias: 'alpha2', content: 'm', created_at: now },
  { from_alias: 'alpha2', to_alias: 'alpha3', content: 'm', created_at: now },
  { from_alias: 'alpha1', to_alias: 'beta',   content: 'm', created_at: now },
  { from_alias: 'alpha2', to_alias: 'beta',   content: 'm', created_at: now },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(600);

const readEdgeOpacities = () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const out = {};
  for (const g of svg.querySelectorAll(':scope > g > g')) {
    const t = g.querySelector('path[data-edge-hitbox] title');
    if (!t) continue;
    const route = (t.textContent || '').split('\n')[0];
    const base = [...g.querySelectorAll(':scope > path')].find(
      p => !p.hasAttribute('data-edge-hitbox') && p.hasAttribute('marker-end')
    );
    if (base) out[route] = +base.getAttribute('opacity');
  }
  return out;
});

const before = await readEdgeOpacities();

// Hover alpha1.
await page.locator('g[data-node="alpha1"]').hover();
await page.waitForTimeout(300);
const after = await readEdgeOpacities();

await browser.close();

const get = (m, r) => m[r];
const baseRef = get(before, 'alpha1 → alpha2');  // pick any
const exactTouch = get(after, 'alpha1 → alpha2');    // R40 1.7×
const inGroupOnly = get(after, 'alpha2 → alpha3');   // R53 1.3×
const externalTouch = get(after, 'alpha1 → beta');   // R40 1.7×
const externalAway = get(after, 'alpha2 → beta');    // R40 0.35×

const results = {
  baselineAllEqual: Object.values(before).every(o => Math.abs(o - baseRef) < 0.001),
  exactTouchBrightest: exactTouch > baseRef * 1.5,
  inGroupBoosted: inGroupOnly > baseRef * 1.15 && inGroupOnly < exactTouch,
  externalEndpointStillBright: externalTouch > baseRef * 1.5,
  externalDims: externalAway < baseRef * 0.5,
  hierarchyOrdered: exactTouch > inGroupOnly && inGroupOnly > externalAway,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} in-group edge boost:`, JSON.stringify(results),
  `\n  baseline=${baseRef}`,
  `\n  α1→α2 (exact)=${exactTouch}`,
  `\n  α2→α3 (in-group)=${inGroupOnly}`,
  `\n  α1→β (exact, out)=${externalTouch}`,
  `\n  α2→β (leaving)=${externalAway}`);
process.exit(ok ? 0 : 1);
