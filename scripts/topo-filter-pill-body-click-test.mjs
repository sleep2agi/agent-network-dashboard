/* Round 73 verification: clicking the pill body (not just the ×) clears
 * the pin. Matches the Notion / Linear tag UX where the whole chip is
 * the clear target. The × button keeps its dedicated <button> +
 * aria-label so screen readers still get a proper "Clear filter" action.
 *
 *  - Pre-seed pin via R66 sessionStorage so pill renders on first paint.
 *  - Click the pill body (text portion, NOT the × button).
 *  - Assert: pin clears + pill removed from DOM + node opacities
 *    restored.
 *  - Re-pin; click the × button → pin also clears.
 *  - title attr on the pill body reads "Click to clear filter".
 *  - cursor:pointer set on the pill body for affordance.
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
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.setItem('anet-topo-pinned-status', 'working');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = [
    { alias: 'wkr',  status: 'working', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'idl',  status: 'idle',    network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForTimeout(500);

const readState = () => page.evaluate(() => {
  const pill = document.querySelector('[data-active-filter="status"]');
  return {
    pillPresent:    !!pill,
    pillTitle:      pill?.getAttribute('title') || null,
    pillCursor:     pill ? getComputedStyle(pill).cursor : null,
    idlOpacity:     +(document.querySelector('g[data-node="idl"]')?.style.opacity || '1'),
    storageStatus:  sessionStorage.getItem('anet-topo-pinned-status'),
  };
});

const before = await readState();

// Click on the pill body — pick a point in the text region, NOT the ×.
// The pill is a flex row; the first inner <span> holds the text. Click
// at its centre.
await page.evaluate(() => {
  const pill = document.querySelector('[data-active-filter="status"]');
  if (!pill) throw new Error('pill not found');
  const text = pill.querySelector('span');
  if (!text) throw new Error('pill text not found');
  const r = text.getBoundingClientRect();
  window.__bodyClickXY = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const xy = await page.evaluate(() => window.__bodyClickXY);
await page.mouse.click(xy.x, xy.y);
await page.waitForTimeout(250);
const afterBodyClick = await readState();

// Re-pin via sessionStorage + event.
await page.evaluate(() => {
  sessionStorage.setItem('anet-topo-pinned-status', 'working');
  window.dispatchEvent(new CustomEvent('anet:topo-pin', { detail: { kind: 'status', value: 'working' } }));
});
await page.waitForTimeout(250);
const afterRepin = await readState();

// Click the × button.
await page.locator('[data-active-filter="status"] button').first().click();
await page.waitForTimeout(250);
const afterXClick = await readState();

await browser.close();

const bright = (v) => v != null && v >= 0.55;
const dim    = (v) => v != null && v < 0.4;
const results = {
  before_pillPresent:      before.pillPresent === true,
  before_titleHint:        before.pillTitle === 'Click to clear filter',
  before_cursorPointer:    before.pillCursor === 'pointer',
  before_idleDim:          dim(before.idlOpacity),
  bodyClick_pillGone:      afterBodyClick.pillPresent === false,
  bodyClick_storageGone:   afterBodyClick.storageStatus === null,
  bodyClick_idleRestored:  bright(afterBodyClick.idlOpacity),
  repin_pillBack:          afterRepin.pillPresent === true,
  xClick_pillGone:         afterXClick.pillPresent === false,
  xClick_storageGone:      afterXClick.storageStatus === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} filter pill body click:`, JSON.stringify(results),
  `\n  before=`,         before,
  `\n  afterBodyClick=`, afterBodyClick,
  `\n  afterRepin=`,     afterRepin,
  `\n  afterXClick=`,    afterXClick);
process.exit(ok ? 0 : 1);
