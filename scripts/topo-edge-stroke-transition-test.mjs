/* Round 166 verification: visible flow edge path picks up
 * stroke-width transition.
 *
 * R50 thickens hovered edges to 1.4× (renderWidth = width * 1.4)
 * but pre-R166 only opacity transitioned — width snapped. R166
 * adds stroke-width to the transition list so the edge thickens
 * smoothly on hover, pairing with R164 edge-badge r-lift for
 * coordinated 300ms ease-out across the edge surface.
 *
 * Test:
 *   1. Mock 4 sessions + 1 flow alpha→beta
 *   2. Probe visible path before hover → strokeWidth=base
 *   3. Probe transition string includes both opacity and
 *      stroke-width
 *   4. Hover edge hitbox → wait 350ms (past transition)
 *   5. Probe strokeWidth → should be ≈ base * 1.4
 *   6. mouse away → strokeWidth back to base
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
  // 4 sessions so alpha + beta are 90° apart (not 180° — that
  // would put their edge midpoint on the hub, where the hub
  // <g> intercepts pointer events). gamma + delta are filler.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

const now = Date.now();
// 4 msgs so:
//   - width = Math.min(2+4, 7) = 6
//   - hover renderWidth = Math.min(6*1.4, 10) = 8.4
// AND the edge midpoint count badge renders (R100 threshold
// count >= 3) so we can use it as the hover surface. The
// visible path has pointerEvents:none; the R48 hitbox is a
// thin stroke that Playwright's .hover() can't reliably land
// on. The badge is a r=9 circle with pointerEvents:all and
// propagates hover to hoveredEdgeKey (R122) — most reliable
// target for triggering the visible-path transition.
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
await page.waitForSelector('[data-edge-visible]', { timeout: 10000 });
await page.waitForTimeout(400);

const idle = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-visible]');
  if (!el) return null;
  return {
    strokeWidth: parseFloat(el.getAttribute('stroke-width')),
    inlineTransition: el.style.transition || '',
    computedTransition: getComputedStyle(el).transition || '',
  };
});

// Hover the edge midpoint badge (R164 r=9 circle, pointerEvents:all,
// propagates to hoveredEdgeKey via R122). The visible path has
// pointerEvents:none; the R48 hitbox is a thin stroke that
// Playwright .hover() can't reliably land on.
await page.locator('[data-edge-count-badge]').hover();
// Wait for transition to settle.
await page.waitForTimeout(400);
const hovered = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-visible]');
  if (!el) return null;
  return {
    strokeWidth: parseFloat(el.getAttribute('stroke-width')),
  };
});

// Move cursor away
await page.mouse.move(10, 10);
await page.waitForTimeout(400);
const idleAgain = await page.evaluate(() => {
  const el = document.querySelector('[data-edge-visible]');
  if (!el) return null;
  return {
    strokeWidth: parseFloat(el.getAttribute('stroke-width')),
  };
});

await browser.close();

const hasOpacity = (idle?.inlineTransition || '').includes('opacity 300ms') ||
                   /opacity\s+0\.3s|opacity\s+300ms/.test(idle?.computedTransition || '');
const hasStrokeWidth = (idle?.inlineTransition || '').includes('stroke-width 300ms') ||
                       /stroke-width\s+0\.3s|stroke-width\s+300ms/.test(idle?.computedTransition || '');

// Expected: width=Math.min(2+4, 7)=6. Hover renderWidth=Math.min(6*1.4, 10)=8.4.
const results = {
  edge_found:                idle !== null,
  has_opacity_transition:    hasOpacity,
  has_stroke_width_transition: hasStrokeWidth,
  idle_width_6:              idle && Math.abs(idle.strokeWidth - 6) < 0.05,
  hover_width_8p4:           hovered && Math.abs(hovered.strokeWidth - 8.4) < 0.1,
  hover_width_thicker:       hovered && idle && hovered.strokeWidth > idle.strokeWidth,
  idle_again_width_6:        idleAgain && Math.abs(idleAgain.strokeWidth - 6) < 0.05,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge stroke transition:`, JSON.stringify(results),
  `\n  idle =`, idle,
  `\n  hovered =`, hovered,
  `\n  idleAgain =`, idleAgain);
process.exit(ok ? 0 : 1);
