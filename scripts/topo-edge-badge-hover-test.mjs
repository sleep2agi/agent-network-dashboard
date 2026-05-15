/* Round 122 verification: hovering the edge midpoint count badge
 * (R100/R121) sets hoveredEdgeKey — same as hovering the line
 * itself (R48). Endpoint rings light, edge brightens. R121 only
 * wired click; R122 closes the hover consistency gap.
 *
 * Fleet: alpha→beta with 4 msgs (badge renders), gamma idle.
 * Hover the badge → alpha + beta get endpoint rings (R111),
 * gamma stays bare. mouseleave → rings clear.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'hi', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha', 'beta', 30 * 1000),
  mkMsg('m2', 'alpha', 'beta', 40 * 1000),
  mkMsg('m3', 'alpha', 'beta', 50 * 1000),
  mkMsg('m4', 'alpha', 'beta', 60 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000 });
await page.waitForTimeout(400);

const rings = () => page.evaluate(() => ({
  alpha: !!document.querySelector('g[data-node="alpha"] [data-edge-endpoint-ring]'),
  beta:  !!document.querySelector('g[data-node="beta"]  [data-edge-endpoint-ring]'),
  gamma: !!document.querySelector('g[data-node="gamma"] [data-edge-endpoint-ring]'),
}));

const before = await rings();

// Hover the badge.
await page.locator('[data-edge-count-badge="alpha->beta"]').hover();
await page.waitForTimeout(300);
const onHover = await rings();

// Mouse far away.
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterLeave = await rings();

await browser.close();

const results = {
  before_noRings:  !before.alpha && !before.beta && !before.gamma,
  hover_alphaRing:  onHover.alpha === true,
  hover_betaRing:   onHover.beta === true,
  hover_gammaBare:  onHover.gamma === false,
  leave_allClear:  !afterLeave.alpha && !afterLeave.beta && !afterLeave.gamma,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge-badge hover:`, JSON.stringify(results),
  `\n  before=`,    before,
  `\n  onHover=`,   onHover,
  `\n  afterLeave=`, afterLeave);
process.exit(ok ? 0 : 1);
