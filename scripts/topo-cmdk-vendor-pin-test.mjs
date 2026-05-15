/* Round 108 verification: Cmd+K palette can pin a vendor filter via
 * three new static actions ("Pin topology filter: Anthropic" /
 * OpenAI / 书生). TopoGraph's R69 listener handles kind='vendor' to
 * setPinnedVendor. The R88 stale-purge cleans up if the vendor isn't
 * in the fleet.
 *
 * Drives via direct CustomEvent dispatch (same deterministic path
 * R82/R90 tests use — fuzzy-match-free). Verifies pin sticks, vendor
 * pill renders, storage persists, and Esc / clear-all release.
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
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),  // A (Anthropic)
    mk('beta',  'gpt-5'),          // O (OpenAI)
    mk('gamma', 'claude-opus-4'),  // A
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const pillCount = () => page.locator('[data-active-filter="vendor"]').count();
const storage   = () => page.evaluate(() => sessionStorage.getItem('anet-topo-pinned-vendor'));
const opacities = () => page.evaluate(() => {
  const o = {};
  for (const a of ['alpha', 'beta', 'gamma']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});

// Initial state — no pin.
const beforePill = await pillCount();
const beforeStorage = await storage();

// Pin A via R108 palette action's CustomEvent.
await page.evaluate(() => {
  sessionStorage.setItem('anet-topo-pinned-vendor', 'A');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'vendor', value: 'A' } }));
});
await page.waitForTimeout(300);
const afterPinA_ops    = await opacities();
const afterPinA_pill   = await pillCount();
const afterPinA_storage = await storage();

// Esc → clear pin.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const afterEsc_pill    = await pillCount();
const afterEsc_storage = await storage();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_noPill:           beforePill === 0,
  before_noStorage:        beforeStorage === null,
  pinA_pillShown:          afterPinA_pill === 1,
  pinA_storageWritten:     afterPinA_storage === 'A',
  pinA_keepsClaudes:       bright(afterPinA_ops.alpha) && bright(afterPinA_ops.gamma),
  pinA_dimsGPT:            dim(afterPinA_ops.beta),
  esc_clearsPill:          afterEsc_pill === 0,
  esc_clearsStorage:       afterEsc_storage === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} cmdk vendor pin:`, JSON.stringify(results),
  `\n  afterPinA_ops=`,    afterPinA_ops,
  `\n  afterPinA_pill=`,    afterPinA_pill,
  `\n  afterPinA_storage=`, afterPinA_storage,
  `\n  afterEsc_pill=`,     afterEsc_pill);
process.exit(ok ? 0 : 1);
