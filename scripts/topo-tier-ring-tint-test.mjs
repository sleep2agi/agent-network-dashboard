/* Round 93 verification: tier rings tint to pal.legendAccent when
 * any of pinnedStatus / pinnedGroup / pinnedVendor is active, and
 * revert to the neutral pal.ringStroke when all three release.
 *
 * Drive pin state via the R69 CustomEvent for status (deterministic;
 * same approach the R82 chip-pin-mirror test uses) and the vendor
 * letter click for vendor. Verify data-tier-tinted toggles + stroke
 * attribute differs from the neutral baseline.
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
  // 4 nodes → single tier (≤8 threshold). Enough to have 1 ring to inspect.
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  const sessions = [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-5'),
    mk('gamma', 'claude-opus-4'),
    mk('delta', 'gpt-5'),
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const ring = () => page.evaluate(() => {
  const r = document.querySelector('[data-tier-ring]');
  if (!r) return null;
  return {
    tinted: r.getAttribute('data-tier-tinted'),
    stroke: r.getAttribute('stroke'),
  };
});

const before = await ring();

// Pin a status — tier ring should tint.
await page.evaluate(() => {
  sessionStorage.setItem('anet-topo-pinned-status', 'idle');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'idle' } }));
});
await page.waitForTimeout(300);
const afterStatusPin = await ring();

// Clear via Esc — ring should revert.
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const afterEscStatus = await ring();

// Pin vendor — tier ring should tint again.
await page.locator('[data-vendor-letter="A"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterVendorPin = await ring();

// Clear via Esc — back to neutral.
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const afterEscVendor = await ring();

await browser.close();

const results = {
  before_neutral:       before?.tinted === 'false',
  before_strokeSet:     typeof before?.stroke === 'string' && before.stroke.length > 0,
  statusPin_tinted:     afterStatusPin?.tinted === 'true',
  statusPin_strokeDiffers: afterStatusPin?.stroke !== before?.stroke,
  escStatus_revertsTinted: afterEscStatus?.tinted === 'false',
  escStatus_strokeMatchesBaseline: afterEscStatus?.stroke === before?.stroke,
  vendorPin_tinted:     afterVendorPin?.tinted === 'true',
  vendorPin_strokeDiffers: afterVendorPin?.stroke !== before?.stroke,
  escVendor_revertsTinted: afterEscVendor?.tinted === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} tier-ring tint:`, JSON.stringify(results),
  `\n  before=`,           before,
  `\n  afterStatusPin=`,   afterStatusPin,
  `\n  afterEscStatus=`,   afterEscStatus,
  `\n  afterVendorPin=`,   afterVendorPin,
  `\n  afterEscVendor=`,   afterEscVendor);
process.exit(ok ? 0 : 1);
