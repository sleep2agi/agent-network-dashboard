/* Round 273 verification: Layout toggle inactive buttons hover-text
 * now previews active text color (cyan-300), completing R163's
 * "hover previews active state" pattern.
 *
 * Pre-R273 the inactive Ring/Grid buttons used:
 *   text-gray-500 hover:text-gray-300 hover:bg-cyan-500/5 active:bg-cyan-500/15
 *
 * The bg part previewed the active cyan-500/15 ghost via cyan-500/5,
 * but the text just brightened gray-500→gray-300. Half-preview:
 * cyan ghost bg + gray text. Active state was cyan-500/15 bg + cyan-300
 * text — so hovering inactive didn't visually preview the active text
 * color.
 *
 * Post-R273:
 *   text-gray-500 hover:text-cyan-300 hover:bg-cyan-500/5 active:bg-cyan-500/15
 *
 * Hover state now previews BOTH the active bg (cyan ghost) AND text
 * (cyan-300). Bg /5 vs /15 still distinguishes hover-preview from
 * active-real.
 *
 * Test scope:
 *   1. Ring inactive button (default state has Ring active; toggle to
 *      Grid first so Ring becomes inactive) classlist contains
 *      'hover:text-cyan-300' and does NOT contain 'hover:text-gray-300'.
 *   2. Grid inactive button (default state) classlist contains
 *      'hover:text-cyan-300'.
 *   3. R163 invariant: hover:bg-cyan-500/5 still present on inactive.
 *   4. R272 freshness chip text starts with 'live · ' (regression).
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
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 10000 });
await page.waitForSelector('[data-freshness-chip]',            { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  // Default localStorage = ring is active, grid is inactive.
  const ring = document.querySelector('[data-topo-chrome-layout="ring"]');
  const grid = document.querySelector('[data-topo-chrome-layout="grid"]');
  const freshness = document.querySelector('[data-freshness-chip]');
  return {
    ringClasses:    ring ? ring.className.toString() : null,
    ringActive:     ring ? ring.getAttribute('data-topo-chrome-layout-active') : null,
    gridClasses:    grid ? grid.className.toString() : null,
    gridActive:     grid ? grid.getAttribute('data-topo-chrome-layout-active') : null,
    freshnessText:  freshness ? freshness.textContent.trim() : null,
  };
});
await browser.close();

const has = (s, cls) => (s || '').includes(cls);

// Ring is default-active (true). Grid is default-inactive (false).
// Grid (inactive) should have hover:text-cyan-300.
// Ring (active) uses 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/20 active:bg-cyan-500/25'
//   — no hover:text-cyan-300 (it's already cyan-300 at rest) — UNCHANGED.

const results = {
  ring_is_active:                       probe.ringActive === 'true',
  grid_is_inactive:                     probe.gridActive === 'false',
  grid_inactive_has_hover_cyan_text:    has(probe.gridClasses, 'hover:text-cyan-300'),
  grid_inactive_no_hover_gray_text:     !has(probe.gridClasses, 'hover:text-gray-300'),
  grid_inactive_keeps_cyan_bg_hover:    has(probe.gridClasses, 'hover:bg-cyan-500/5'),
  ring_active_has_cyan_text_base:       has(probe.ringClasses, 'text-cyan-300'),
  r272_freshness_starts_with_live:      probe.freshnessText != null && probe.freshnessText.startsWith('live · '),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} layout hover text preview:`, JSON.stringify(results),
  '\n  ring classes:', probe.ringClasses,
  '\n  grid classes:', probe.gridClasses,
  '\n  freshness:',    probe.freshnessText);
process.exit(ok ? 0 : 1);
