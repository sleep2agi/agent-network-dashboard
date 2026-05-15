/* Round 62 verification: pressing Esc clears pinnedStatus when no chat
 * is open. Composes cleanly with the R136 ChatPopover Esc handler
 * (which only mounts while chatAlias is set).
 *
 *  - Pin via legend row (R61) → assert filter active.
 *  - Press Esc → assert pin released, all nodes restore.
 *  - aria-pressed flips back to false.
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
  const sessions = [
    { alias: 'wkr',  status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl1', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl2', status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(500);

const opacities = () => page.evaluate(() => {
  const o = {};
  for (const a of ['wkr', 'idl1', 'idl2']) {
    const g = document.querySelector(`g[data-node="${a}"]`);
    o[a] = g ? +(g.style.opacity || '1') : null;
  }
  return o;
});
const ariaPressed = (status) => page.evaluate(s => {
  const g = document.querySelector(`g[data-legend-status="${s}"]`);
  return g?.getAttribute('aria-pressed');
}, status);

const before = await opacities();

// Pin working via legend row click.
await page.locator('g[data-legend-status="working"]').first().click({ force: true });
// Move mouse away so we observe pin-only (not hover-driven) filter.
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterPin = await opacities();
const ariaAfterPin = await ariaPressed('working');

// Press Esc. Body should have focus so the document-level keydown
// handler fires.
await page.evaluate(() => document.activeElement && typeof document.activeElement.blur === 'function' && document.activeElement.blur());
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const afterEsc = await opacities();
const ariaAfterEsc = await ariaPressed('working');

// Press Esc again — should be a no-op (no pin, no chat).
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const afterEsc2 = await opacities();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_baseline:      bright(before.wkr) && bright(before.idl1) && bright(before.idl2),
  pin_keepsWorking:     bright(afterPin.wkr),
  pin_dimsIdle:         dim(afterPin.idl1) && dim(afterPin.idl2),
  pin_ariaTrue:         ariaAfterPin === 'true',
  esc_releasesPin:      bright(afterEsc.wkr) && bright(afterEsc.idl1) && bright(afterEsc.idl2),
  esc_ariaBackToFalse:  ariaAfterEsc === 'false',
  escAgain_isNoOp:      bright(afterEsc2.wkr) && bright(afterEsc2.idl1),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} esc clears pin:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  afterPin=`, afterPin, ` aria=${ariaAfterPin}`,
  `\n  afterEsc=`, afterEsc, ` aria=${ariaAfterEsc}`);
process.exit(ok ? 0 : 1);
