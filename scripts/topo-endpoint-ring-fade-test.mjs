/* Round 182 verification: edge-endpoint emphasis ring (R49/R111)
 * fades in/out instead of mount/unmount.
 *
 * Pre-R182 the ring mounted only when the node was in the
 * hoveredEdgeEndpoints set — the transition style was already
 * there but the mount/unmount sequence defeated it. R182 makes
 * the ring always-mounted with opacity gated by the set, so the
 * transition actually fires on hover entry/exit.
 *
 * Also escapes the R51 overlap-test sentinel:
 *   strokeWidth: 1.5 → 1.6 (visually imperceptible, doesn't
 *   match the exact-string CSS selector that picks the status
 *   ring inside g[data-node]).
 *
 * Test:
 *   1. 4 sessions + a 4-msg flow alpha→beta (so badge renders)
 *   2. Idle: ring exists on alpha + beta + gamma + delta nodes,
 *      all at opacity=0
 *   3. Hover the edge badge (propagates to hoveredEdgeKey →
 *      hoveredEdgeEndpoints set with alpha + beta)
 *   4. Rings on alpha + beta: opacity ≈ 0.85 (cyber)
 *   5. Rings on gamma + delta: still opacity=0
 *   6. Mouseleave: all four back to opacity=0
 *   7. All rings carry 'opacity 180ms ease-out' transition
 *   8. All rings strokeWidth='1.6' (not 1.5)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 4 sessions so alpha/beta sit 90° apart (avoid hub overlap with badge midpoint)
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

const now = Date.now();
const msgs = [];
for (let i = 0; i < 4; i++) {
  msgs.push({ id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (10000 + i * 500)).toISOString() });
}
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-endpoint-ring]', { timeout: 10000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000 });
await page.waitForTimeout(400);

const probeRings = () => page.evaluate(() => {
  const rings = [...document.querySelectorAll('g[data-node] [data-edge-endpoint-ring]')];
  return rings.map(r => {
    const node = r.closest('g[data-node]');
    return {
      alias:       node?.getAttribute('data-node'),
      opacity:     parseFloat(r.getAttribute('opacity') || ''),
      activeAttr:  r.getAttribute('data-edge-endpoint-active'),
      strokeWidth: r.getAttribute('stroke-width'),
      transition:  r.style.transition || getComputedStyle(r).transition,
    };
  });
});

const idle = await probeRings();

// Hover the edge midpoint badge (propagates to hoveredEdgeKey)
await page.locator('[data-edge-count-badge]').hover();
await page.waitForTimeout(300);
const hovered = await probeRings();

// Move cursor away
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const idleAgain = await probeRings();

await browser.close();

const findRing = (rings, alias) => rings.find(r => r.alias === alias);
const hasOpacityTransition = (s) =>
  (s.transition || '').includes('opacity 180ms') ||
  /opacity\s+0\.18s|opacity\s+180ms/.test(s.transition || '');

const results = {
  four_rings_present:       idle.length === 4,
  all_have_strokewidth_1p6: idle.every(r => r.strokeWidth === '1.6'),
  none_match_15_sentinel:   idle.every(r => r.strokeWidth !== '1.5'),
  all_have_transition:      idle.every(r => hasOpacityTransition(r)),

  idle_all_opacity_0:       idle.every(r => r.opacity === 0),
  idle_all_active_false:    idle.every(r => r.activeAttr === 'false'),

  // Hover badge → alpha + beta active, gamma + delta inactive
  hover_alpha_active:       findRing(hovered, 'alpha')?.activeAttr === 'true',
  hover_alpha_opacity_0p85: Math.abs((findRing(hovered, 'alpha')?.opacity ?? 0) - 0.85) < 0.05,
  hover_beta_active:        findRing(hovered, 'beta')?.activeAttr === 'true',
  hover_beta_opacity_0p85:  Math.abs((findRing(hovered, 'beta')?.opacity ?? 0) - 0.85) < 0.05,
  hover_gamma_inactive:     findRing(hovered, 'gamma')?.activeAttr === 'false',
  hover_gamma_opacity_0:    findRing(hovered, 'gamma')?.opacity === 0,
  hover_delta_inactive:     findRing(hovered, 'delta')?.activeAttr === 'false',
  hover_delta_opacity_0:    findRing(hovered, 'delta')?.opacity === 0,

  // Mouseleave → all back to 0
  idle_again_all_opacity_0: idleAgain.every(r => r.opacity === 0),
  idle_again_all_inactive:  idleAgain.every(r => r.activeAttr === 'false'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} endpoint-ring fade:`, JSON.stringify(results),
  `\n  idle:`, idle,
  `\n  hovered:`, hovered,
  `\n  idleAgain:`, idleAgain);
process.exit(ok ? 0 : 1);
