/* Round 254 verification: three remaining theme-toggle snaps closed:
 *
 *   1. Top-level TopoGraph wrapper <div> — biggest theme-driven
 *      surface (whole canvas bg + border). Probe via [data-topo-svg]
 *      ancestor chain; the wrapper has ref={containerRef} but no
 *      data attr, so we look up via a known descendant.
 *   2. Legend flow-arrow swatch <path> — added data-legend-flow-arrow.
 *   3. Minimap container (only mounts when view is zoomed/panned) —
 *      programmatically zoom in to render minimap, then probe.
 *
 * Test scope:
 *   - Container has background-color + border-color transition 200ms
 *   - Flow-arrow swatch has stroke 200ms in style.transition
 *   - Minimap container has background-color + border-color + color
 *     transition 200ms
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
await page.waitForSelector('[data-legend-flow-arrow]', { timeout: 10000 });
await page.waitForTimeout(300);

// Probe wrapper + flow arrow first
const baseline = await page.evaluate(() => {
  const flowArrow = document.querySelector('[data-legend-flow-arrow]');
  // Wrapper: the TopoGraph component's outer div sits as the
  // grandparent of <svg> with the topo-panel rect inside. Use a
  // robust climb from a known SVG element.
  const wrapper = document.querySelector('[data-topo-wrapper]');
  return {
    wrapper: wrapper ? { transition: wrapper.style.transition } : null,
    flowArrow: flowArrow ? { transition: flowArrow.style.transition } : null,
  };
});

// Trigger minimap render — programmatically pan/zoom view via the
// reset button toggle or just dispatch a wheel event. Simpler:
// click the zoom-in button several times.
for (let i = 0; i < 3; i++) {
  await page.locator('[data-topo-chrome-zoom-in]').click();
  await page.waitForTimeout(120);
}
await page.waitForSelector('[data-topo-minimap]', { timeout: 5000 });
await page.waitForTimeout(300);
const minimap = await page.evaluate(() => {
  const mm = document.querySelector('[data-topo-minimap]');
  return mm ? { transition: mm.style.transition } : null;
});
await browser.close();

const has = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  wrapper_present:                baseline.wrapper !== null,
  wrapper_has_bg_color_200:       has(baseline.wrapper?.transition, 'background-color'),
  wrapper_has_border_color_200:   has(baseline.wrapper?.transition, 'border-color'),

  flow_arrow_present:             baseline.flowArrow !== null,
  flow_arrow_has_stroke_200:      has(baseline.flowArrow?.transition, 'stroke'),

  minimap_present:                minimap !== null,
  minimap_has_bg_color_200:       has(minimap?.transition, 'background-color'),
  minimap_has_border_color_200:   has(minimap?.transition, 'border-color'),
  minimap_has_color_200:          has(minimap?.transition, '(?<!background-|border-)color'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} wrapper + flow-arrow + minimap theme ease:`, JSON.stringify(results),
  '\n  baseline:', baseline,
  '\n  minimap:', minimap);
process.exit(ok ? 0 : 1);
