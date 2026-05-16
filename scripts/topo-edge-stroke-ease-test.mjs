/* Round 245 verification: edge surface (visible flow path + flow
 * rail dashed underline) picks up stroke-color transitions so
 * theme toggle eases instead of snapping.
 *
 * Pre-R245:
 *   - [data-edge-visible]: transition = 'opacity 300ms ease-out,
 *     stroke-width 300ms ease-out' (R166)
 *   - [data-edge-flow-rail]: Tailwind className 'transition-opacity
 *     duration-300' (opacity only, no stroke)
 *
 * Post-R245:
 *   - [data-edge-visible]: transition list adds 'stroke 300ms ease-
 *     out' alongside the existing two
 *   - [data-edge-flow-rail]: inline style with both 'opacity' and
 *     'stroke' at 300ms ease-out; Tailwind className dropped
 *
 * Scenario: 4 working agents + 5-msg alpha→beta flow → at least
 * one visible flow + flow-rail pair.
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
const now = Date.now();
const msgs = [];
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-visible]', { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-edge-flow-rail]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const out = await page.evaluate(() => {
  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      transition: getComputedStyle(el).transition,
      className:  el.getAttribute('class') || '',
      stroke:     el.getAttribute('stroke'),
    };
  };
  return {
    visible: probe('[data-edge-visible]'),
    rail:    probe('[data-edge-flow-rail]'),
  };
});
await browser.close();

const hasProp = (s, prop) => new RegExp(`${prop}\\s+(?:300ms|0\\.3s)`).test(s || '');

const results = {
  visible_present:                  out.visible !== null,
  visible_has_opacity_300ms:        hasProp(out.visible?.transition, 'opacity'),
  visible_has_stroke_width_300ms:   hasProp(out.visible?.transition, 'stroke-width'),
  visible_has_stroke_300ms:         hasProp(out.visible?.transition, 'stroke'),

  rail_present:                     out.rail !== null,
  rail_has_opacity_300ms:           hasProp(out.rail?.transition, 'opacity'),
  rail_has_stroke_300ms:            hasProp(out.rail?.transition, 'stroke'),
  // Tailwind 'transition-opacity duration-300' className dropped
  // (the inline transition list replaces it; Tailwind would
  // otherwise OVERRIDE the inline stroke transition with its
  // opacity-only declaration)
  rail_no_tailwind_class:           !/transition-opacity/.test(out.rail?.className || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge stroke ease:`, JSON.stringify(results),
  '\n  visible:', out.visible,
  '\n  rail:   ', out.rail);
process.exit(ok ? 0 : 1);
