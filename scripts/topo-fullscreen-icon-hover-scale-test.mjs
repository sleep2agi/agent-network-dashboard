/* Round 353 verification: fullscreen icon (enter + exit variants)
 * picks up group-hover:scale-110 — sibling to R352 zoom icons + R350
 * reset hover-rotate. Closes the chrome-strip per-icon hover-
 * affordance arc:
 *   zoom-out  R352  scale 1 → 1.1
 *   zoom-in   R352  scale 1 → 1.1
 *   reset     R350  rotate 0 → -8°
 *   fullscreen R353 scale 1 → 1.1  (this round, both enter+exit svgs)
 *
 * Tailwind 4 compiles scale-110 to the modern CSS `scale` property
 * (verified during R352 — getComputedStyle(el).scale carries the
 * value, not transform).
 *
 * Contract (cyber, non-fullscreen):
 *   - Rest: enter-icon computed scale 'none' (no scale applied).
 *   - Hover button: enter-icon scale='1.1'.
 *   - Inline transition contains scale (or transform — Tailwind 4
 *     emits both transition-property entries on transition-transform).
 *   - Pre-R353 invariants: R288 strokeWidth=2.5 preserved, anet-
 *     chrome-pop class absent at rest, data-topo-chrome-fullscreen-
 *     icon="enter" attr intact.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-fullscreen-icon="enter"]', { timeout: 15000 });
await page.waitForTimeout(300);

const restProbe = await page.evaluate(() => {
  const ico = document.querySelector('[data-topo-chrome-fullscreen-icon="enter"]');
  const cs  = ico ? getComputedStyle(ico) : null;
  return {
    scale:      cs?.scale ?? null,
    transition: cs?.transition ?? null,
    strokeW:    ico?.getAttribute('stroke-width') ?? null,
    className:  ico?.getAttribute('class') ?? null,
  };
});

// Hover the fullscreen button.
await page.hover('[data-topo-chrome-fullscreen]');
await page.waitForTimeout(300);
const hoverProbe = await page.evaluate(() => {
  const ico = document.querySelector('[data-topo-chrome-fullscreen-icon="enter"]');
  return { scale: ico ? getComputedStyle(ico).scale : null };
});

await browser.close();

const isRestScale = (s) => s === 'none' || s === '1' || s === '1 1' || s === null;
const isHoverScale110 = (s) => s === '1.1' || s === '1.1 1.1';
const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  rest_scale_1:         isRestScale(restProbe.scale),
  trans_has_scale:      hasTrans(restProbe.transition, 'scale') || hasTrans(restProbe.transition, 'transform'),
  strokew_2_5:          restProbe.strokeW === '2.5',           // R288
  no_chrome_pop_rest:   !/anet-chrome-pop/.test(restProbe.className || ''),
  has_group_hover_cls:  /group-hover:scale-110/.test(restProbe.className || ''),
  hover_scale_110:      isHoverScale110(hoverProbe.scale),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} fullscreen icon hover-scale:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
