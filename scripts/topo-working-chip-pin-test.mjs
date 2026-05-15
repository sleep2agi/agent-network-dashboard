/* Round 139 verification: the chip-row "N working" chip click
 * pins pinnedStatus='working'. Closes the cursor-pointer-lying
 * bug from R79 — the chip's tooltip has been promising "click to
 * pin" since R79 ("hover highlights, click to pin") but no onClick
 * was ever wired. Same shape as R136 fix on the active-links chip.
 *
 * Composes with two existing pin surfaces:
 *   R60 pressure-bar segments
 *   R61 legend rows
 *   R139 working chip in the chip row (new)
 * All three toggle the same pinnedStatus state via setPinnedStatus.
 *
 * Behavior tested:
 *   1. Idle baseline: workingCount > 0, aria-pressed="false",
 *      data-pin-mirror="false", boxShadow absent
 *   2. Click → pinnedStatus='working', aria-pressed="true",
 *      data-pin-mirror="true", boxShadow set
 *   3. Click again → unpin, aria-pressed="false"
 *   4. Esc clears pin (R62 invariant)
 *   5. Empty fleet (workingCount=0): chip not interactive
 *      (no role, no tabindex, no cursor:pointer)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

async function probe(workingCount, totalCount) {
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
    const sessions = [];
    for (let i = 0; i < totalCount; i++) {
      sessions.push({
        alias: `node${i}`,
        status: i < workingCount ? 'working' : 'idle',
        model: 'claude-opus-4', runtime: 'cli-claude-code',
        network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh,
      });
    }
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, totalCount, { timeout: 30000 });
  await page.waitForSelector('[data-working-chip]', { timeout: 10000 });
  await page.waitForTimeout(400);

  return { browser, page };
}

// State A: fleet with working agents
const { browser: b1, page: p1 } = await probe(3, 5);

const readChip = () => p1.evaluate(() => {
  const chip = document.querySelector('[data-working-chip]');
  return {
    clickable:   chip?.getAttribute('data-working-chip-clickable'),
    role:        chip?.getAttribute('role'),
    tabindex:    chip?.getAttribute('tabindex'),
    pinMirror:   chip?.getAttribute('data-pin-mirror'),
    ariaPressed: chip?.getAttribute('aria-pressed'),
    boxShadow:   chip?.getAttribute('style')?.includes('box-shadow'),
    cursor:      chip?.getAttribute('style')?.includes('cursor: pointer'),
  };
});

const before = await readChip();

await p1.locator('[data-working-chip]').click();
await p1.waitForTimeout(200);
const afterClick = await readChip();

await p1.locator('[data-working-chip]').click();
await p1.waitForTimeout(200);
const afterReclick = await readChip();

// Re-pin then test Esc clears (R62 invariant)
await p1.locator('[data-working-chip]').click();
await p1.waitForTimeout(200);
await p1.keyboard.press('Escape');
await p1.waitForTimeout(200);
const afterEsc = await readChip();

await b1.close();

// State B: empty fleet (workingCount=0) — chip not interactive
const { browser: b2, page: p2 } = await probe(0, 3);
const emptyState = await p2.evaluate(() => {
  const chip = document.querySelector('[data-working-chip]');
  return {
    clickable: chip?.getAttribute('data-working-chip-clickable'),
    role:      chip?.getAttribute('role'),
    tabindex:  chip?.getAttribute('tabindex'),
    cursor:    chip?.getAttribute('style')?.includes('cursor: pointer'),
  };
});
await b2.close();

const results = {
  // Initial (3 working / 5 total)
  before_clickableTrue:   before.clickable === 'true',
  before_roleButton:      before.role === 'button',
  before_tabIndex0:       before.tabindex === '0',
  before_ariaPressedFalse: before.ariaPressed === 'false',
  before_pinMirrorFalse:  before.pinMirror === 'false',
  before_cursorPointer:   before.cursor === true,
  before_noBoxShadow:     before.boxShadow === false,

  // After click — pinned
  click_ariaPressedTrue:  afterClick.ariaPressed === 'true',
  click_pinMirrorTrue:    afterClick.pinMirror === 'true',
  click_boxShadowSet:     afterClick.boxShadow === true,

  // After reclick — released
  reclick_ariaPressedFalse: afterReclick.ariaPressed === 'false',
  reclick_pinMirrorFalse:   afterReclick.pinMirror === 'false',

  // Esc clears pin
  esc_ariaPressedFalse:   afterEsc.ariaPressed === 'false',
  esc_pinMirrorFalse:     afterEsc.pinMirror === 'false',

  // Empty fleet — not interactive
  empty_clickableFalse:   emptyState.clickable === 'false',
  empty_noRole:           emptyState.role === null || emptyState.role === undefined,
  empty_noTabIndex:       emptyState.tabindex === null || emptyState.tabindex === undefined,
  empty_noCursor:         !emptyState.cursor,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} working chip pin:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  afterClick=`, afterClick,
  `\n  afterReclick=`, afterReclick,
  `\n  afterEsc=`, afterEsc,
  `\n  emptyState=`, emptyState);
process.exit(ok ? 0 : 1);
