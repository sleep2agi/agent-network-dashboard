/* Round 247 verification: recent-signal + legend panel chrome
 * <rect>s pick up fill + stroke + opacity in their transition
 * lists, completing the per-panel theme-toggle smoothing.
 *
 * Pre-R247 each panel rect transition was 'filter 200ms ease-out'
 * (R135 hover-elevation drop-shadow). Three theme-driven properties
 * snapped on theme toggle:
 *   - fill: pal.legendBox.fill (cyber #020617 ↔ light #ffffff)
 *   - stroke: pal.legendBox.stroke (cyber #1f2937 ↔ light #e2e8f0)
 *   - opacity: 0.92 cyber ↔ 0.97 light
 *
 * R247 adds all three to the transition list at 200ms ease-out.
 * Mirrors R246's per-node label-card treatment at the panel scope.
 *
 * Test scope per panel:
 *   - element present at [data-topo-panel-elevation]
 *   - style.transition contains filter, fill, stroke, AND opacity
 *     each at 200ms (or 0.2s browser-normalised)
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
await page.waitForSelector('[data-topo-panel-elevation="recent"]', { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-topo-panel-elevation="legend"]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const grab = (panel) => {
    const r = document.querySelector(`[data-topo-panel-elevation="${panel}"]`);
    if (!r) return null;
    return { transition: r.style.transition };
  };
  return {
    recent: grab('recent'),
    legend: grab('legend'),
  };
});
await browser.close();

const hasProp = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  recent_present:           probe.recent !== null,
  recent_has_filter_200:    hasProp(probe.recent?.transition, 'filter'),
  recent_has_fill_200:      hasProp(probe.recent?.transition, 'fill'),
  recent_has_stroke_200:    hasProp(probe.recent?.transition, 'stroke'),
  recent_has_opacity_200:   hasProp(probe.recent?.transition, 'opacity'),
  legend_present:           probe.legend !== null,
  legend_has_filter_200:    hasProp(probe.legend?.transition, 'filter'),
  legend_has_fill_200:      hasProp(probe.legend?.transition, 'fill'),
  legend_has_stroke_200:    hasProp(probe.legend?.transition, 'stroke'),
  legend_has_opacity_200:   hasProp(probe.legend?.transition, 'opacity'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel theme ease:`, JSON.stringify(results),
  '\n  recent:', probe.recent,
  '\n  legend:', probe.legend);
process.exit(ok ? 0 : 1);
