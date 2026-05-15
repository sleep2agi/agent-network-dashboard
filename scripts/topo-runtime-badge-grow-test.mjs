/* Round 208 verification: runtime badge (CLI/SDK/HTTP icon at the
 * bottom-right of each node avatar) grows r + thickens stroke on
 * parent-node hover. Completes the micro-lift radius-axis family:
 *   R177 hub ring        r 14  → 17  on hub-hover
 *   R197 legend swatch   r 5.5 → 7   on row-hover/pin
 *   R208 runtime badge   r 7   → 8   on node-hover (online)
 *                       (r 5.5 → 6.5 offline)
 *
 * Test (cyber dark, 4 working sessions with runtime='cli-claude-code'
 * which maps to a runtime identity → badge renders):
 *   1. 4 [data-runtime-badge] badges present (one per node).
 *   2. Idle: all data-runtime-badge-active='false', computed r ≈ 7,
 *      strokeWidth ≈ 1.5.
 *   3. Transition includes 'r 150ms' AND 'stroke-width 150ms'.
 *   4. Hover g[data-node="alpha"] → wait past 180ms.
 *   5. alpha badge: active='true', r ≈ 8, strokeWidth ≈ 2.
 *   6. Other (non-hovered) badges stay active='false', r ≈ 7,
 *      strokeWidth ≈ 1.5.
 *   7. Move away — alpha badge back to 'false', r ≈ 7.
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
// SVG <circle> doesn't pass Playwright's default visibility check the
// same way HTML elements do — wait for DOM attachment instead.
await page.waitForSelector('[data-runtime-badge]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probeAll = async () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-runtime-badge]')].map(el => {
    const cs = getComputedStyle(el);
    return {
      alias:       el.getAttribute('data-runtime-badge'),
      active:      el.getAttribute('data-runtime-badge-active'),
      r:           parseFloat(cs.r),
      strokeWidth: parseFloat(cs.strokeWidth),
      transition:  el.style.transition,
    };
  });
});

const idle = await probeAll();

await page.hover('g[data-node="alpha"]');
await page.waitForTimeout(200);
const hovered = await probeAll();

await page.mouse.move(0, 0);
await page.waitForTimeout(200);
const settled = await probeAll();

await browser.close();

const idleAlpha    = idle.find(b => b.alias === 'alpha');
const idleBeta     = idle.find(b => b.alias === 'beta');
const hoverAlpha   = hovered.find(b => b.alias === 'alpha');
const hoverBeta    = hovered.find(b => b.alias === 'beta');
const settledAlpha = settled.find(b => b.alias === 'alpha');

const near = (got, want, tol = 0.4) => Math.abs(got - want) < tol;

const results = {
  four_badges_present:           idle.length === 4,
  idle_all_inactive:             idle.every(b => b.active === 'false'),
  idle_all_r_7:                  idle.every(b => near(b.r, 7)),
  idle_all_stroke_1p5:           idle.every(b => near(b.strokeWidth, 1.5)),
  transition_has_r:              idle.every(b => /\br\s+(?:150ms|0\.15s)/.test(b.transition || '')),
  transition_has_stroke_width:   idle.every(b => /stroke-width\s+(?:150ms|0\.15s)/.test(b.transition || '')),

  hover_alpha_active:            hoverAlpha?.active === 'true',
  hover_alpha_r_grown:           near(hoverAlpha?.r ?? 0, 8),
  hover_alpha_stroke_thicker:    near(hoverAlpha?.strokeWidth ?? 0, 2),
  hover_beta_stays_inactive:     hoverBeta?.active === 'false',
  hover_beta_r_unchanged:        near(hoverBeta?.r ?? 0, 7),
  hover_beta_stroke_unchanged:   near(hoverBeta?.strokeWidth ?? 0, 1.5),

  settled_alpha_inactive:        settledAlpha?.active === 'false',
  settled_alpha_r_back:          near(settledAlpha?.r ?? 0, 7),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} runtime badge grow:`, JSON.stringify(results),
  `\n  idle:`,     idle,
  `\n  hovered:`,  hovered,
  `\n  settled:`,  settled);
process.exit(ok ? 0 : 1);
