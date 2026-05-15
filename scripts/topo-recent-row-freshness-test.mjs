/* Round 160 verification: recency pip on recent-signal panel rows.
 *
 * Canvas flow edges fade by freshness (R10: full intensity ≤30s,
 * decaying to ~35% over 5min). The recent-signal panel rows
 * encoded last_at purely in text ("5s" at row right edge) — no
 * at-a-glance visual cue for "which row is actively firing".
 *
 * R160 adds a 1.6-px cyan dot at x=10 (in the 7-px margin
 * between rect-start x=6 and text-start x=13). Alpha ramp:
 *   ageSec ≤ 30   →  1.0   (fully fresh)
 *   30 < ageSec ≤ 300 → smooth decay 1.0 → 0.25
 *   ageSec > 300  →  0.25  (stale floor)
 *
 * Three independent encodings on each row, none competing:
 *   rect fill   = hover/pin state (R104/R116)
 *   count tspan = magnitude (R127 amber when ≥10)
 *   pip         = recency (this round)
 *
 * Test:
 *   Mock 3 flows — 1 fresh (5s ago), 1 mid (90s ago), 1 stale
 *   (6 min ago). Each should produce one pip; alpha ladder:
 *   fresh > mid > stale.
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

const now = Date.now();
// Three distinct flows with different recency:
//   fresh: 5s ago     → alpha ≈ 1.0
//   mid:   90s ago    → alpha ≈ 1 - (60/270)*0.75 ≈ 0.833
//   stale: 360s ago   → alpha ≈ 0.25 (floor)
const msgs = [
  { id: 'f1', from_alias: 'alpha', to_alias: 'beta',  content: 'hi', network_id: 'default', created_at: new Date(now - 5000).toISOString() },
  { id: 'm1', from_alias: 'beta',  to_alias: 'gamma', content: 'hi', network_id: 'default', created_at: new Date(now - 90000).toISOString() },
  { id: 's1', from_alias: 'gamma', to_alias: 'delta', content: 'hi', network_id: 'default', created_at: new Date(now - 360000).toISOString() },
];
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row-freshness]', { timeout: 10000 });
await page.waitForTimeout(400);

const probes = await page.evaluate(() => {
  const pips = [...document.querySelectorAll('[data-recent-row-freshness]')];
  return pips.map(el => ({
    key:   el.getAttribute('data-recent-row-freshness'),
    alpha: parseFloat(el.getAttribute('data-recent-row-freshness-alpha') || ''),
    cx:    parseFloat(el.getAttribute('cx') || ''),
    r:     parseFloat(el.getAttribute('r') || ''),
    tag:   el.tagName.toLowerCase(),
  }));
});

await browser.close();

if (probes.length !== 3) {
  console.log(`❌ wrong pip count: expected 3, got ${probes.length}`, probes);
  process.exit(1);
}
// Rows are sorted by recency (newest first), so probes[0] is freshest.
const [pFresh, pMid, pStale] = probes;
const results = {
  three_pips:              probes.length === 3,
  all_circles:             probes.every(p => p.tag === 'circle'),
  all_at_x_10:             probes.every(p => Math.abs(p.cx - 10) < 0.01),
  all_radius_1p6:          probes.every(p => Math.abs(p.r - 1.6) < 0.01),
  fresh_alpha_1:           Math.abs(pFresh.alpha - 1.0) < 0.05,
  mid_alpha_0p7_to_0p9:    pMid.alpha > 0.7 && pMid.alpha < 0.95,
  stale_alpha_floor_0p25:  Math.abs(pStale.alpha - 0.25) < 0.05,
  ladder_descends:         pFresh.alpha > pMid.alpha && pMid.alpha > pStale.alpha,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row freshness pip:`, JSON.stringify(results),
  `\n  probes=`, probes);
process.exit(ok ? 0 : 1);
