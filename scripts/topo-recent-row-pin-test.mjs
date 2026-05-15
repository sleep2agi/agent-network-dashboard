/* Round 116 verification: recent-signal row click pins the edge.
 * R56 made hover transient; R116 makes click sticky — survives
 * mouseleave, releases on second click or Esc. activeEdgeKey =
 * hoveredEdgeKey ?? pinnedEdgeKey, so hover-while-pinned previews
 * another edge transiently and mouseleave falls back to the pin.
 *
 * Drives 2 flow rows. Click row 0 → row's aria-pressed=true,
 * data-recent-row-pinned=true, the edge stays bright after mouseleave
 * (non-endpoints stay dim, endpoint ring stays). Click row 0 again
 * → release. Pin row 0, hover row 1 → row-1 preview wins; leave →
 * row-0 pin restores. Esc clears.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma'), mk('delta')] } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'hi', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha', 'beta',  30 * 1000),
  mkMsg('m2', 'gamma', 'delta', 60 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row]', { timeout: 10000 });
await page.waitForTimeout(400);

const rowState = (key) => page.evaluate((k) => {
  const g = document.querySelector(`[data-recent-row="${k}"]`);
  return {
    pinned: g?.getAttribute('data-recent-row-pinned') || '',
    aria:   g?.getAttribute('aria-pressed') || '',
  };
}, key);
const endpointRingFor = (alias) => page.evaluate((a) => {
  const g = document.querySelector(`g[data-node="${a}"]`);
  return !!g?.querySelector('[data-edge-endpoint-ring]');
}, alias);

const before = await rowState('alpha->beta');

// Click row 0 → pin.
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterPin       = await rowState('alpha->beta');
const alphaRingPin   = await endpointRingFor('alpha');
const betaRingPin    = await endpointRingFor('beta');
const gammaRingPin   = await endpointRingFor('gamma');

// Click again → release.
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterRelease     = await rowState('alpha->beta');
const alphaRingRelease = await endpointRingFor('alpha');

// Pin row 0 again, hover row 1 — preview wins.
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(200);
await page.locator('[data-recent-row="gamma->delta"]').hover();
await page.waitForTimeout(300);
const alphaWhileHoverGamma = await endpointRingFor('alpha');
const gammaWhileHover      = await endpointRingFor('gamma');

// Leave gamma row — row-0 pin restores.
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const alphaAfterLeave = await endpointRingFor('alpha');
const gammaAfterLeave = await endpointRingFor('gamma');

// Esc clears.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const afterEsc       = await rowState('alpha->beta');
const alphaAfterEsc  = await endpointRingFor('alpha');

await browser.close();

const results = {
  before_notPinned:         before.pinned === 'false' && before.aria === 'false',
  pin_attrTrue:             afterPin.pinned === 'true' && afterPin.aria === 'true',
  pin_endpointsLit:         alphaRingPin === true && betaRingPin === true,
  pin_nonEndpointDark:      gammaRingPin === false,
  releaseAfterReclick:      afterRelease.pinned === 'false' && alphaRingRelease === false,
  hoverPreview_gammaLit:    gammaWhileHover === true,
  hoverPreview_alphaDark:   alphaWhileHoverGamma === false,
  leave_pinRestored:        alphaAfterLeave === true && gammaAfterLeave === false,
  esc_clearsPin:            afterEsc.pinned === 'false' && alphaAfterEsc === false,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row pin:`, JSON.stringify(results),
  `\n  afterPin=`,     afterPin,
  `\n  rings@pin: alpha=`, alphaRingPin, ' beta=', betaRingPin, ' gamma=', gammaRingPin,
  `\n  afterRelease=`, afterRelease,
  `\n  hoverPreview: alpha=`, alphaWhileHoverGamma, ' gamma=', gammaWhileHover,
  `\n  afterLeave: alpha=`, alphaAfterLeave, ' gamma=', gammaAfterLeave,
  `\n  afterEsc=`,     afterEsc);
process.exit(ok ? 0 : 1);
