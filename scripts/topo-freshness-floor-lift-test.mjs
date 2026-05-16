/* Round 358 verification: freshness-ramp stale floor lifted 0.25 →
 * 0.30 across 3 coordinated scopes:
 *   - active-links chip dot     (line ~3055)
 *   - recent-panel header count (line ~6524)
 *   - recent-row freshness pip  (line ~7021)
 *
 * The ramp shape stays the same:
 *   0-30s   → 1.0  (fully fresh)
 *   30-300s → smooth decay 1.0 → 0.30
 *   > 300s  → 0.30 (stale floor)
 *
 * R358 polish: stale state becomes ~20 % more readable (0.30 / 0.25
 * = 1.2x) while the fresh-vs-stale ratio stays strong (1.0 / 0.30 ≈
 * 3.3× vs prior 4×). Joins the R317 subordinate-text-lift family
 * at the freshness scope.
 *
 * Test approach: feed a STALE message (~ 600s ago, well past the 300s
 * floor boundary) to the route mock, then read all 3 freshness-alpha
 * data attrs. Each should be '0.30'.
 *
 * Contract:
 *   - Active-links chip dot data-active-links-freshness-alpha === '0.30'.
 *   - Recent-panel header count data-recent-panel-count-freshness-alpha
 *     === '0.30'.
 *   - Recent-row pip data-recent-row-freshness-alpha === '0.30'.
 *   - SVG fill colors include alpha 0.3 (rgba form).
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b') ] } });
});

// STALE message: created_at ~ 600s ago + last_at ~ 600s ago.
const now = Date.now();
const staleIso = new Date(now - 600 * 1000).toISOString();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'old ping',
    network_id: 'default', created_at: staleIso, last_at: staleIso },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-active-links-freshness-dot]',       { timeout: 15000 });
await page.waitForSelector('[data-recent-panel-count-freshness-alpha]', { timeout: 5000 });
await page.waitForSelector('[data-recent-row-freshness-alpha]',         { timeout: 5000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const dot   = document.querySelector('[data-active-links-freshness-dot]');
  const count = document.querySelector('[data-recent-panel-count-freshness-alpha]');
  const pip   = document.querySelector('[data-recent-row-freshness-alpha]');
  return {
    dotAlpha:   dot?.getAttribute('data-active-links-freshness-alpha') ?? null,
    countAlpha: count?.getAttribute('data-recent-panel-count-freshness-alpha') ?? null,
    pipAlpha:   pip?.getAttribute('data-recent-row-freshness-alpha') ?? null,
    // The pip uses a static fill + a separate `opacity` SVG attr —
    // probe that, not the fill colour.
    pipOpacity: pip?.getAttribute('opacity') ?? null,
  };
});

await browser.close();

const results = {
  dot_alpha_0_30:   probe.dotAlpha === '0.30',
  count_alpha_0_30: probe.countAlpha === '0.30',
  pip_alpha_0_30:   probe.pipAlpha === '0.30',
  pip_opacity_0_3: /^0\.3$|^0\.30$/.test(probe.pipOpacity || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} freshness floor lift 0.25 → 0.30:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
