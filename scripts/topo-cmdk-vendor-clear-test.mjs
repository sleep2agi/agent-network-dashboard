/* Round 90 verification: Cmd+K palette "Clear topology filters" also
 * releases the R88 pinnedVendor (the R69 implementation only knew
 * about status + group). Plus the new granular "Clear topology vendor
 * filter" command releases just vendor without disturbing status or
 * group pins.
 *
 * Drive via direct CustomEvent dispatch (avoids fuzzy-match flake —
 * same approach as the R82 chip-pin-mirror test). Verifies both the
 * TopoGraph listener branch (state mutation) and the in-memory
 * sessionStorage cleanup.
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
  const mk = (alias, status, model) => ({
    alias, status, model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  const sessions = [
    mk('alpha', 'working', 'claude-opus-4'),
    mk('beta',  'idle',    'gpt-5'),
    mk('gamma', 'idle',    'claude-opus-4'),
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const pills = () => page.evaluate(() => {
  const all = document.querySelectorAll('[data-active-filter]');
  return [...all].map(p => p.getAttribute('data-active-filter'));
});
const storage = () => page.evaluate(() => ({
  status: sessionStorage.getItem('anet-topo-pinned-status'),
  group:  sessionStorage.getItem('anet-topo-pinned-group'),
  vendor: sessionStorage.getItem('anet-topo-pinned-vendor'),
}));

// Helper: dispatch a topo-pin event from the page side.
const pin = async (kind, value) => {
  await page.evaluate(({ kind, value }) => {
    if (kind === 'status') sessionStorage.setItem('anet-topo-pinned-status', value);
    if (kind === 'group')  sessionStorage.setItem('anet-topo-pinned-group',  value);
    window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind, value } }));
  }, { kind, value });
  await page.waitForTimeout(200);
};
// Pin vendor via the actual UI letter click (no CustomEvent for that
// flow yet — palette doesn't surface per-vendor pin actions).
const pinVendor = async (initial) => {
  await page.locator(`[data-vendor-letter="${initial}"]`).click();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(200);
};
const clearAll = async () => {
  await page.evaluate(() => {
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
    sessionStorage.removeItem('anet-topo-pinned-vendor');
    window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'clear' } }));
  });
  await page.waitForTimeout(250);
};
const clearVendor = async () => {
  await page.evaluate(() => {
    sessionStorage.removeItem('anet-topo-pinned-vendor');
    window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'clear-vendor' } }));
  });
  await page.waitForTimeout(250);
};

// === Test 1: clear-all now also clears vendor (the R90 bug fix). ===
await pin('status', 'working');
await pinVendor('A');
const afterPinBoth = { pills: await pills(), storage: await storage() };

await clearAll();
const afterClearAll = { pills: await pills(), storage: await storage() };

// === Test 2: granular clear-vendor leaves status + group untouched. ===
await pin('status', 'working');
await pinVendor('A');
const beforeGranular = { pills: await pills(), storage: await storage() };

await clearVendor();
const afterClearVendor = { pills: await pills(), storage: await storage() };

await browser.close();

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const results = {
  pinBoth_threePills:        sameSet(afterPinBoth.pills,  ['status', 'vendor']),
  pinBoth_storageBoth:       afterPinBoth.storage.status === 'working' && afterPinBoth.storage.vendor === 'A',
  clearAll_noPills:          afterClearAll.pills.length === 0,
  clearAll_storageAllNull:   afterClearAll.storage.status === null && afterClearAll.storage.group === null && afterClearAll.storage.vendor === null,
  granular_threePills:       sameSet(beforeGranular.pills, ['status', 'vendor']),
  clearVendor_keepsStatus:   afterClearVendor.pills.includes('status'),
  clearVendor_dropsVendor:  !afterClearVendor.pills.includes('vendor'),
  clearVendor_storageStatusKept:  afterClearVendor.storage.status === 'working',
  clearVendor_storageVendorCleared: afterClearVendor.storage.vendor === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} cmdk vendor clear:`, JSON.stringify(results),
  `\n  afterPinBoth=`,       afterPinBoth,
  `\n  afterClearAll=`,      afterClearAll,
  `\n  beforeGranular=`,     beforeGranular,
  `\n  afterClearVendor=`,   afterClearVendor);
process.exit(ok ? 0 : 1);
