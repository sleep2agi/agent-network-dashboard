/* Round 94 verification: each recent-signal panel row now carries a
 * right-aligned relative timestamp (e.g. `2s` / `1m`). Composes with
 * the R56 hover affordance and R57 panel elevation without changing
 * geometry. Mirror what the R42 active-links chip already shows for
 * the most-recent flow, but per-row so users can see which flows
 * are current vs stale.
 *
 * Drive the dashboard with messages at known ages — 30s, 5m, 2h —
 * and assert each row's timestamp matches the expected glyph. Also
 * verify the timestamp <text> is non-interactive (pointerEvents:none)
 * so it doesn't steal hover from the row hitbox.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma'), mk('delta')] } });
});

// Mock messages so flowLinks aggregates them. Three flows at increasing
// ages — the panel sorts most-recent first (per the recent-signal
// aggregator), so row 0 is the freshest.
const now = Date.now();
const mkMsg = (id, from_alias, to_alias, content, ageMs) => ({
  id, from_alias, to_alias, content, network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha', 'beta', 'fix-the-bug',    30 * 1000),       // 30s ago → "30s"
  mkMsg('m2', 'gamma', 'delta', 'review-the-pr',  5 * 60 * 1000),   // 5m ago  → "5m"
  mkMsg('m3', 'alpha', 'gamma', 'deploy-stage',   2 * 60 * 60 * 1000), // 2h ago → "2h"
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
// Wait for at least one recent-signal timestamp to render.
await page.waitForSelector('[data-recent-row-ts]', { timeout: 10000 });
await page.waitForTimeout(400);

const rows = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-recent-row]')].map(g => {
    const rowKey  = g.getAttribute('data-recent-row');
    const tsEl    = g.querySelector('[data-recent-row-ts]');
    const rowText = g.querySelector('text:not([data-recent-row-ts])')?.textContent || '';
    const tsText  = tsEl?.textContent || null;
    const tsPointerEvents = tsEl ? getComputedStyle(tsEl).pointerEvents : null;
    return { rowKey, rowText, tsText, tsPointerEvents };
  });
});

await browser.close();

const results = {
  threeRows:           rows.length === 3,
  // Row 0 (freshest) should be alpha→beta around "30s" or "29s" etc.
  row0_hasFreshTs:     rows[0] && /^[2-9]\d?s$/.test(rows[0].tsText || ''),
  // Row 1 should read 5m (minutes precision).
  row1_minuteTs:       rows[1] && /^[4-6]m$/.test(rows[1].tsText || ''),
  // Row 2 should read ~2h.
  row2_hourTs:         rows[2] && /^[12]h$/.test(rows[2].tsText || ''),
  // ts <text> must be non-interactive so it doesn't intercept the row hover.
  ts_nonInteractive:   rows.every(r => r.tsPointerEvents === 'none'),
  // Row content shows from/to/count/content via the existing layout.
  row0_hasArrow:       rows[0]?.rowText.includes('->'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row ts:`, JSON.stringify(results),
  `\n  rows=`, rows);
process.exit(ok ? 0 : 1);
