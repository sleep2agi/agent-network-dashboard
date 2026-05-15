/* Round 89 verification: pinning a vendor renders a "filter: X · N ×"
 * pill in the chip-row, mirroring R64 status + group pills. R88 added
 * the pin but the affordance lived only on the letter — body-click /
 * × button on a dedicated pill was missing. R89 closes that.
 *
 * Also verifies the stale-purge useEffect: if the fleet's vendor
 * distribution loses the pinned vendor (last node disconnects), the
 * pin clears automatically so the pill doesn't show "filter: A · 0"
 * forever. Same defensive pattern pinnedGroup uses.
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
let dropGPT = false;
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  const sessions = [
    mk('alpha', 'claude-opus-4'),
    mk('gamma', 'claude-opus-4'),
  ];
  if (!dropGPT) sessions.splice(1, 0, mk('beta', 'gpt-5'));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const pill = () => page.evaluate(() => {
  const p = document.querySelector('[data-active-filter="vendor"]');
  if (!p) return null;
  return {
    text:  (p.textContent || '').trim(),
    count: p.getAttribute('data-filter-match-count'),
    color: getComputedStyle(p).color,
  };
});
const storage = () => page.evaluate(() => sessionStorage.getItem('anet-topo-pinned-vendor'));

// Pin O (gpt-5 → OpenAI) via click.
const before = await pill();
await page.locator('[data-vendor-letter="O"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterPinO = await pill();
const afterPinOStorage = await storage();

// Clicking the pill body clears the pin.
await page.locator('[data-active-filter="vendor"]').click();
await page.waitForTimeout(250);
const afterBodyClick = await pill();

// Pin A (Anthropic) — verify the × button works.
await page.locator('[data-vendor-letter="A"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterPinA = await pill();
await page.locator('[data-active-filter="vendor"] button').click();
await page.waitForTimeout(250);
const afterXButton = await pill();

// Pin O again, then mock the GPT node away → stale-purge fires.
await page.locator('[data-vendor-letter="O"]').click();
await page.waitForTimeout(250);
const beforePurge = await pill();
dropGPT = true;
// Force a refetch via swr revalidation — easiest is page.reload, but
// that wipes sessionStorage. Instead, just await the next swr cycle
// (5s by default). To speed things up, dispatch a focus event which
// triggers swr revalidateOnFocus. We expect the pin to clear once
// the vendor leaves the distribution.
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForTimeout(400);
const afterPurge = await pill();
const afterPurgeStorage = await storage();

await browser.close();

const results = {
  before_noPill:        before === null,
  pinO_pillRendered:    afterPinO !== null && /filter:?\s*O/.test(afterPinO.text),
  pinO_countCorrect:    afterPinO?.count === '1',
  pinO_storage:         afterPinOStorage === 'O',
  bodyClick_clears:     afterBodyClick === null,
  pinA_pillRendered:    afterPinA !== null && /filter:?\s*A/.test(afterPinA.text),
  pinA_countCorrect:    afterPinA?.count === '2',
  xButton_clears:       afterXButton === null,
  beforePurge_present:  beforePurge !== null && /filter:?\s*O/.test(beforePurge.text),
  purge_pillGone:       afterPurge === null,
  purge_storageGone:    afterPurgeStorage === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} vendor pill:`, JSON.stringify(results),
  `\n  afterPinO=`,       afterPinO,
  `\n  afterPinA=`,       afterPinA,
  `\n  beforePurge=`,     beforePurge,
  `\n  afterPurge=`,      afterPurge);
process.exit(ok ? 0 : 1);
