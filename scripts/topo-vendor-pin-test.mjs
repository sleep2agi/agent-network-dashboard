/* Round 88 verification: clicking a vendor letter in the distribution
 * chip toggles a sticky pin — closes the only filter dimension that
 * still released on mouseleave (R60 status, R63 group, R69 Cmd+K all
 * support pin). Composes via activeVendor = hoveredVendor ??
 * pinnedVendor so hover still wins for spot comparison.
 *
 * Fleet: 2 Claude (alpha, gamma) + 1 GPT (beta). Click A → alpha + gamma
 * stay bright across mouseleave; pinned-style boxShadow on the A
 * letter; aria-pressed="true". Hover O while A pinned → transient O
 * preview (alpha/gamma dim, beta lit); mouseleave → A pin restores.
 * Esc clears the pin (R62/R63 universal-cancel extends to vendor).
 * SessionStorage round-trips.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
    sessionStorage.removeItem('anet-topo-pinned-vendor');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'alpha', status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'beta',  status: 'idle', model: 'gpt-5',         runtime: 'codex-cli',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'gamma', status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const ops = () => page.evaluate(() => {
  const o = {};
  for (const a of ['alpha', 'beta', 'gamma']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});
const meta = () => page.evaluate(() => {
  const a = document.querySelector('[data-vendor-letter="A"]');
  const o = document.querySelector('[data-vendor-letter="O"]');
  return {
    A: { pinned: a?.getAttribute('data-vendor-pinned'), aria: a?.getAttribute('aria-pressed'), shadow: (a?.getAttribute('style') || '').includes('inset') },
    O: { pinned: o?.getAttribute('data-vendor-pinned'), aria: o?.getAttribute('aria-pressed'), shadow: (o?.getAttribute('style') || '').includes('inset') },
  };
});
const storage = () => page.evaluate(() => sessionStorage.getItem('anet-topo-pinned-vendor'));

const before     = await ops();
const beforeMeta = await meta();

// Click A to pin. Mouse moves away — pin survives.
await page.locator('[data-vendor-letter="A"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterClickA    = await ops();
const afterClickAMeta = await meta();
const afterClickAStorage = await storage();

// Hover O while A pinned — transient O preview wins.
await page.locator('[data-vendor-letter="O"]').hover();
await page.waitForTimeout(250);
const hoverOWhilePinA = await ops();

// Leave — A pin restores.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const leaveOWhilePinA = await ops();

// Esc clears the vendor pin.
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const afterEsc        = await ops();
const afterEscMeta    = await meta();
const afterEscStorage = await storage();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:          bright(before.alpha) && bright(before.beta) && bright(before.gamma),
  before_noPinMeta:         beforeMeta.A.pinned === 'false' && beforeMeta.A.aria === 'false' && !beforeMeta.A.shadow,
  pinA_keepsClaudes:        bright(afterClickA.alpha) && bright(afterClickA.gamma),
  pinA_dimsGPT:             dim(afterClickA.beta),
  pinA_metaSet:             afterClickAMeta.A.pinned === 'true' && afterClickAMeta.A.aria === 'true' && afterClickAMeta.A.shadow,
  pinA_storagePersisted:    afterClickAStorage === 'A',
  hoverOPinA_transientO:    bright(hoverOWhilePinA.beta) && dim(hoverOWhilePinA.alpha) && dim(hoverOWhilePinA.gamma),
  leaveOPinA_aRestored:     bright(leaveOWhilePinA.alpha) && bright(leaveOWhilePinA.gamma) && dim(leaveOWhilePinA.beta),
  esc_releasesPin:          bright(afterEsc.alpha) && bright(afterEsc.beta) && bright(afterEsc.gamma),
  esc_metaCleared:          afterEscMeta.A.pinned === 'false' && afterEscMeta.A.aria === 'false' && !afterEscMeta.A.shadow,
  esc_storageCleared:       afterEscStorage === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor pin:`, JSON.stringify(results),
  `\n  before=`,           before,
  `\n  afterClickA=`,      afterClickA,
  `\n  hoverOPinA=`,       hoverOWhilePinA,
  `\n  leaveOPinA=`,       leaveOWhilePinA,
  `\n  afterEsc=`,         afterEsc);
process.exit(ok ? 0 : 1);
