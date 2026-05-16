/* Round 263 verification: wrapper box-shadow joins the theme-toggle
 * transition list — closes R254's holdover gap.
 *
 * Pre-R263 the wrapper's inline transition was:
 *   transition: 'background-color 200ms ease-out, border-color 200ms ease-out'
 *
 * The Tailwind class `shadow-2xl ${isLight ? 'shadow-zinc-900/5'
 * : 'shadow-cyan-950/30'}` is THEME-CONDITIONAL — on cyber→light
 * toggle the className swap changes box-shadow color (cyan-950 30%
 * ↔ zinc-900 5%) but the transition list didn't include box-shadow,
 * so the shadow SNAPPED while every other theme-driven element eased.
 *
 * R254 claimed "TopoGraph theme-toggle smoothness TRULY complete" but
 * missed this one surface. R263 closes it:
 *   transition: '... , box-shadow 200ms ease-out'
 *
 * CSS box-shadow transitions interpolate the shadow color smoothly
 * even when the value is set indirectly via a Tailwind class — the
 * `transition` property targets the box-shadow CSS property itself,
 * which is transition-eligible regardless of where the new value
 * comes from (class change vs inline style change).
 *
 * Test scope:
 *   1. Wrapper present.
 *   2. Wrapper inline transition includes box-shadow at 200ms (or 0.2s).
 *   3. R254 invariants intact: still has background-color + border-color
 *      transitions.
 *   4. Wrapper has a non-empty box-shadow at rest (regression — confirms
 *      the shadow class actually applies).
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-wrapper]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const w = document.querySelector('[data-topo-wrapper]');
  return {
    transition:  w?.style.transition ?? null,
    boxShadow:   w ? window.getComputedStyle(w).boxShadow : null,
  };
});
await browser.close();

const has = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  wrapper_present:                probe.transition !== null,
  transition_has_box_shadow_200:  has(probe.transition, 'box-shadow'),
  // R254 regressions
  transition_has_bg_color_200:    has(probe.transition, 'background-color'),
  transition_has_border_color_200: has(probe.transition, 'border-color'),
  // Wrapper actually carries a box-shadow at rest (else the transition
  // would have nothing to interpolate). 'none' = no shadow applied.
  wrapper_has_non_empty_shadow:   probe.boxShadow !== null && probe.boxShadow !== 'none' && probe.boxShadow.length > 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} wrapper shadow theme ease:`, JSON.stringify(results),
  '\n  transition:', probe.transition,
  '\n  boxShadow:', probe.boxShadow);
process.exit(ok ? 0 : 1);
