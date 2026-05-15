/* Round 100 verification: edges with count >= 3 render a midpoint
 * count badge. The edge stroke width gauges intensity but at high
 * volume "5 vs 12" is hard to read off the line. The badge spells
 * out the integer at the bezier midpoint.
 *
 * Fleet: alpha → beta with 5 messages, gamma → delta with 1, all
 * fresh. Expect one badge for the 5-msg flow, none for the 1-msg
 * flow (count below threshold). Verify badge text matches the
 * link.count and pointer-events:none so the existing R48 edge
 * hitbox stays alive.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 30 * 1000).toISOString();
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

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'ping', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  // 5 alpha → beta (count=5, badge expected)
  mkMsg('m1', 'alpha', 'beta', 30 * 1000),
  mkMsg('m2', 'alpha', 'beta', 40 * 1000),
  mkMsg('m3', 'alpha', 'beta', 50 * 1000),
  mkMsg('m4', 'alpha', 'beta', 60 * 1000),
  mkMsg('m5', 'alpha', 'beta', 70 * 1000),
  // 1 gamma → delta (count=1, NO badge)
  mkMsg('m6', 'gamma', 'delta', 80 * 1000),
  // 3 beta → alpha (count=3 — threshold, badge expected)
  mkMsg('m7', 'beta', 'alpha', 35 * 1000),
  mkMsg('m8', 'beta', 'alpha', 45 * 1000),
  mkMsg('m9', 'beta', 'alpha', 55 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000 });
await page.waitForTimeout(400);

const badges = await page.evaluate(() => {
  return [...document.querySelectorAll('[data-edge-count-badge]')].map(g => ({
    key:   g.getAttribute('data-edge-count-badge'),
    count: g.querySelector('text')?.textContent || '',
    pe:    getComputedStyle(g).pointerEvents,
  }));
});

await browser.close();

const byKey = Object.fromEntries(badges.map(b => [b.key, b]));
const results = {
  twoBadges:               badges.length === 2,
  alphaBeta_badge:         byKey['alpha->beta']?.count === '5',
  betaAlpha_badge:         byKey['beta->alpha']?.count === '3',
  gammaDelta_noBadge:     !byKey['gamma->delta'],
  // R121 promoted the badge from passive display to a click-to-pin
  // affordance — assertion flipped from non-interactive to interactive.
  badges_interactive:      badges.every(b => b.pe === 'all'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-count badge:`, JSON.stringify(results),
  `\n  badges=`, badges);
process.exit(ok ? 0 : 1);
