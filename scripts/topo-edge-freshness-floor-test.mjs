/* Round 406 verification: edge freshness fade floor 0.35 → 0.40.
 * Stale-state legibility lift family (6th anchor) — stale edges
 * (>5min) now sit at 40% intensity instead of 35%. The decay
 * curve shape (linear 1 - ageMs/300s) unchanged.
 *
 * Contract:
 *   - Source-file verification of `Math.max(0.40, 1 - ageMs / (5 * 60 * 1000))`
 *   - DOM probe: seed a STALE edge (ageMs > 5min) so fresh hits the
 *     floor; assert the visible flow path's opacity reflects the
 *     lifted floor (computed as 0.40 × edge_opacity_mul × base).
 *   - Compare against pre-R406 expectation (0.35 floor): the lifted
 *     floor produces ~14.3 % higher edge opacity on stale edges.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
// 10 minutes ago — well past the 5-min decay window; freshness hits floor.
const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
// Seed a stale flow link 10 minutes ago — past the 5-min decay so floor binds.
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({
  json: { messages: [
    { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'old', created_at: stale, network_id: 'default' },
  ] },
}));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-visible]', { timeout: 15000 });
await page.waitForTimeout(600);

const probe = await page.evaluate(() => {
  const edge = document.querySelector('[data-edge-visible]');
  if (!edge) return null;
  return {
    opacityAttr: edge.getAttribute('opacity'),
    edgeKey:     edge.getAttribute('data-edge-visible'),
  };
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasFloor040 = /Math\.max\(0\.40, 1 - ageMs/.test(fileText);
const sourceLacksFloor035 = !/Math\.max\(0\.35, 1 - ageMs/.test(fileText);

await browser.close();

// Pre-R406 expected: (0.28 cyber base) × 0.35 floor × 1 mul = 0.098
// Post-R406 expected: (0.28 cyber base) × 0.40 floor × 1 mul = 0.112
// On the visible flow path the wire is:
//   opacity = Math.min(1, (isLight ? 0.22 : 0.28) * fresh * edgeOpacityMul)
// For an unhovered edge in a fresh sessions context (no other hover/active):
//   edgeOpacityMul = !hoveredAlias && !activeGroup ? (hoveredActiveLinks ? 1.5 : 1) : 0.35
// = 1 in this probe → opacity ≈ 0.112 post-R406
// Browser may serialize this as "0.112" or "0.11" — accept either with
// a tolerance probe.
const opacityNum = probe ? parseFloat(probe.opacityAttr || '0') : 0;
const expectedPost = 0.28 * 0.40 * 1;       // 0.112
const expectedPre  = 0.28 * 0.35 * 1;       // 0.098
const distToPost = Math.abs(opacityNum - expectedPost);
const distToPre  = Math.abs(opacityNum - expectedPre);

const results = {
  // Edge mounted from seeded stale flow
  edge_mounted:                 !!probe,
  edge_key_present:             !!probe?.edgeKey,
  // Post-R406 opacity is CLOSER to 0.112 than 0.098
  opacity_close_to_post_r406:   distToPost < 0.01,
  // Opacity is FURTHER from the pre-R406 0.098 baseline
  opacity_not_pre_r406:         distToPre > distToPost,
  // Source-file canonical wire
  source_floor_040:             sourceHasFloor040,
  source_no_floor_035:          sourceLacksFloor035,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge freshness floor 0.35 → 0.40:`, JSON.stringify(results),
  '\n  probe:', probe,
  '\n  opacityNum:', opacityNum, '/ expectedPost:', expectedPost, '/ distToPost:', distToPost.toFixed(4),
  '\n  expectedPre:', expectedPre, '/ distToPre:', distToPre.toFixed(4));
process.exit(ok ? 0 : 1);
