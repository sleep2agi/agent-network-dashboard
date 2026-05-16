/* Round 266 verification: corner panel titles + legend count text
 * pick up theme-toggle fill transitions.
 *
 * Pre-R266 three texts in the corner panel headers snapped fill on
 * theme toggle:
 *   "recent signal"  fill=pal.legendHeadline (cyber #e5e7eb ↔ light #0f172a)
 *   "legend"         fill=pal.legendHeadline (same)
 *   "{N} nodes"      fill=pal.legendAccent   (cyber #67e8f9 ↔ light #10b981)
 *
 * The panel rect chrome eased (R247), the rows eased (various), but
 * the BIGGEST text in each panel header hard-flipped color on theme
 * toggle. R266 adds `transition: fill 200ms ease-out` to all three.
 *
 * Test scope:
 *   1. Recent-signal title element present at [data-recent-panel-title].
 *   2. Legend title element present at [data-legend-panel-title].
 *   3. Legend count element present at [data-legend-panel-count].
 *   4. Each inline transition contains `fill 200ms` (or 0.2s).
 *   5. R265 top-rail still has its background-image transition (regression).
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
await page.waitForSelector('[data-recent-panel-title]', { timeout: 10000 });
await page.waitForSelector('[data-legend-panel-title]', { timeout: 10000 });
await page.waitForSelector('[data-legend-panel-count]', { timeout: 10000 });
await page.waitForSelector('[data-topo-top-rail]',      { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const recentTitle = document.querySelector('[data-recent-panel-title]');
  const legendTitle = document.querySelector('[data-legend-panel-title]');
  const legendCount = document.querySelector('[data-legend-panel-count]');
  const topRail     = document.querySelector('[data-topo-top-rail]');
  return {
    recentTitleTransition: recentTitle ? recentTitle.style.transition : null,
    legendTitleTransition: legendTitle ? legendTitle.style.transition : null,
    legendCountTransition: legendCount ? legendCount.style.transition : null,
    topRailTransition:     topRail     ? topRail.style.transition     : null,
  };
});
await browser.close();

const has = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  recent_title_present:               probe.recentTitleTransition !== null,
  recent_title_has_fill_200:          has(probe.recentTitleTransition, 'fill'),

  legend_title_present:               probe.legendTitleTransition !== null,
  legend_title_has_fill_200:          has(probe.legendTitleTransition, 'fill'),

  legend_count_present:               probe.legendCountTransition !== null,
  legend_count_has_fill_200:          has(probe.legendCountTransition, 'fill'),

  r265_top_rail_bg_image_200:         has(probe.topRailTransition, 'background-image'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel title fill ease:`, JSON.stringify(results),
  '\n  recent title:', probe.recentTitleTransition,
  '\n  legend title:', probe.legendTitleTransition,
  '\n  legend count:', probe.legendCountTransition,
  '\n  top rail:    ', probe.topRailTransition);
process.exit(ok ? 0 : 1);
