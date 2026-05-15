/* Round 63 verification: clicking the group label pins the group focus
 * via pinnedGroup. activeGroup = hoveredGroup ?? pinnedGroup is read by
 * the R8 inFocus dim mechanic and the R53 in-group edge boost.
 *
 *  - Click a group label → that group's nodes stay bright, others dim
 *    via the existing inFocus formula (opacity 0.32).
 *  - Move mouse away → pin persists (transient hover cleared).
 *  - In-group edge between OTHER team members brightens 1.3× even
 *    without an alias hover.
 *  - Esc clears the pin (R62 extended).
 *  - aria-pressed flips on the group <text>.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'alpha1', status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha2', status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'alpha3', status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta',   status: 'idle', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
const now = new Date().toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  // alpha2 → alpha3: both in alpha group, neither is the pinned-group's "exact alias"
  { from_alias: 'alpha2', to_alias: 'alpha3', content: 'm', created_at: now },
  // alpha1 → beta: alpha1 in pinned group, beta outside → should dim
  { from_alias: 'alpha1', to_alias: 'beta', content: 'm', created_at: now },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(600);

const nodeOpacities = () => page.evaluate(() => {
  const o = {};
  for (const a of ['alpha1', 'alpha2', 'alpha3', 'beta']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});
const edgeOpacities = () => page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  const out = {};
  for (const g of svg.querySelectorAll(':scope > g > g')) {
    const t = g.querySelector('path[data-edge-hitbox] title');
    if (!t) continue;
    const route = (t.textContent || '').split('\n')[0];
    const base = [...g.querySelectorAll(':scope > path')].find(
      p => !p.hasAttribute('data-edge-hitbox') && p.hasAttribute('marker-end')
    );
    if (base) out[route] = +base.getAttribute('opacity');
  }
  return out;
});

const before = await nodeOpacities();
const beforeEdges = await edgeOpacities();

// Click the alpha group label via its R63 hitbox wrapper.
const alphaLabel = page.locator('g[data-group-label-hit="alpha"]').first();
const exists = await alphaLabel.count() > 0;
if (!exists) { console.log('❌ alpha group label hit not found'); process.exit(1); }
await alphaLabel.click({ force: true });
// Mouse away so we observe pin-only state.
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterPinNodes = await nodeOpacities();
const afterPinEdges = await edgeOpacities();
const ariaPressed = await page.evaluate(() => document.querySelector('g[data-group-label-hit="alpha"]')?.getAttribute('aria-pressed'));

// Esc to release.
await page.evaluate(() => document.activeElement && typeof document.activeElement.blur === 'function' && document.activeElement.blur());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const afterEscNodes = await nodeOpacities();
const ariaAfterEsc = await page.evaluate(() => document.querySelector('g[data-group-label-hit="alpha"]')?.getAttribute('aria-pressed'));

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:           bright(before.alpha1) && bright(before.alpha2) && bright(before.alpha3) && bright(before.beta),
  pin_keepsAlphaTeam:        bright(afterPinNodes.alpha1) && bright(afterPinNodes.alpha2) && bright(afterPinNodes.alpha3),
  pin_dimsBeta:              dim(afterPinNodes.beta),
  pin_ariaPressed:           ariaPressed === 'true',
  pin_inGroupEdgeBoosts:     afterPinEdges['alpha2 → alpha3'] > beforeEdges['alpha2 → alpha3'] * 1.15,
  pin_leavingEdgeDims:       afterPinEdges['alpha1 → beta'] < beforeEdges['alpha1 → beta'] * 0.6,
  esc_releasesPin:           bright(afterEscNodes.alpha1) && bright(afterEscNodes.beta),
  esc_ariaBackToFalse:       ariaAfterEsc === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group pin:`, JSON.stringify(results),
  `\n  before nodes=`, before, ` edges=`, beforeEdges,
  `\n  afterPin nodes=`, afterPinNodes, ` edges=`, afterPinEdges, ` aria=${ariaPressed}`,
  `\n  afterEsc nodes=`, afterEscNodes, ` aria=${ariaAfterEsc}`);
process.exit(ok ? 0 : 1);
