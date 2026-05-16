/* Round 269 verification: legend offline-row label " / " → " · "
 * delimiter unification — closes R138 sweep.
 *
 * Pre-R269 the legend's offline row read "offline / no SSE" (ASCII
 * forward-slash separator). R138 already swept the recent-signal
 * row separators to " · " (typographic middot) along with filter
 * pills, node tooltips, edge badges, and active-links tooltip. The
 * legend offline label was the last hardcoded " / " in TopoGraph.
 *
 * R269 changes the label string from "offline / no SSE" to
 * "offline · no SSE" — same monospace cell width (no layout shift),
 * matches the dashboard-wide typographic delimiter convention.
 *
 * Test scope:
 *   1. Legend offline row label text contains the typographic middot.
 *   2. Label DOES NOT contain " / " (the ASCII separator).
 *   3. Working + idle row labels unchanged (regression: they never
 *      used " / ").
 *   4. R257 legend header symmetric inset intact (legend count x === 211).
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
  const mk = (alias, status = 'working') => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
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
await page.waitForSelector('[data-legend-row-label="offline"]', { timeout: 10000 });
await page.waitForSelector('[data-legend-row-label="working"]', { timeout: 10000 });
await page.waitForSelector('[data-legend-row-label="idle"]',    { timeout: 10000 });
await page.waitForSelector('[data-legend-panel-count]',         { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const offline = document.querySelector('[data-legend-row-label="offline"]');
  const working = document.querySelector('[data-legend-row-label="working"]');
  const idle    = document.querySelector('[data-legend-row-label="idle"]');
  const count   = document.querySelector('[data-legend-panel-count]');
  return {
    offlineText: offline ? offline.textContent : null,
    workingText: working ? working.textContent : null,
    idleText:    idle    ? idle.textContent    : null,
    countX:      count   ? +count.getAttribute('x') : null,
  };
});
await browser.close();

const results = {
  offline_uses_middot:           probe.offlineText === 'offline · no SSE',
  offline_no_ascii_slash:        probe.offlineText != null && !probe.offlineText.includes(' / '),
  working_text_unchanged:        probe.workingText === 'working node',
  idle_text_unchanged:           probe.idleText    === 'online idle',
  r257_legend_count_x_211:       probe.countX === 211,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend offline delimiter:`, JSON.stringify(results),
  '\n  offline:', JSON.stringify(probe.offlineText),
  '\n  working:', JSON.stringify(probe.workingText),
  '\n  idle:   ', JSON.stringify(probe.idleText),
  '\n  count x:', probe.countX);
process.exit(ok ? 0 : 1);
