/* Round 140 verification: the "N online" chip in the chip row
 * gets an onClick that navigates to /nodes when interactive.
 * Mirrors R136 active-links→/messages idiom; complements R139
 * working→pin idiom. The online chip is the third chip-row chip
 * that had cursor:pointer without a click action since R79.
 *
 * Why nav not pin: "online" = working + idle in semantics; there's
 * no single pinnedStatus value that captures both. /nodes is the
 * natural full-list destination.
 *
 * Three states tested:
 *   - Empty fleet (onlineCount=0): chip not interactive
 *   - 1 online: clickable, role=link, click → /nodes
 *   - 5 online (mix of working+idle): same shape, click → /nodes
 *
 * Hover preview still works (R79 highlight all online) — that's
 * a separate gesture verified in topo-active-links-chip-hover-test
 * for the chip-row's hover ladder.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

// status: 'working' | 'idle' | 'offline' — distribute by counts
async function probe({ working, idle, offline }) {
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
    let i = 0;
    for (let n = 0; n < working;  n++, i++) sessions.push(mk(i, 'working',  fresh, nid));
    for (let n = 0; n < idle;     n++, i++) sessions.push(mk(i, 'idle',     fresh, nid));
    for (let n = 0; n < offline;  n++, i++) sessions.push(mk(i, 'offline',  fresh, nid));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  // offline-only fleet won't render g[data-node] (only online ones do),
  // but the chip row still renders because sessions.length > 0.
  await page.waitForSelector('[data-online-chip]', { timeout: 10000 });
  await page.waitForTimeout(400);

  return { browser, page };
}

function mk(i, status, fresh, nid) {
  return {
    alias: `node${i}`,
    status,
    model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  };
}

// State A: 5 online (3 working / 2 idle)
const { browser: b1, page: p1 } = await probe({ working: 3, idle: 2, offline: 0 });
const fiveProbe = await p1.evaluate(() => {
  const chip = document.querySelector('[data-online-chip]');
  return {
    text:        chip?.textContent,
    clickable:   chip?.getAttribute('data-online-chip-clickable'),
    role:        chip?.getAttribute('role'),
    tabindex:    chip?.getAttribute('tabindex'),
    cursor:      chip?.getAttribute('style')?.includes('cursor: pointer'),
    title:       chip?.getAttribute('title'),
  };
});
await p1.locator('[data-online-chip]').click();
await p1.waitForURL('**/nodes', { timeout: 10000 });
const fiveUrl = p1.url();
await b1.close();

// State B: 1 online (1 idle, 0 working)
const { browser: b2, page: p2 } = await probe({ working: 0, idle: 1, offline: 0 });
const oneProbe = await p2.evaluate(() => {
  const chip = document.querySelector('[data-online-chip]');
  return {
    text: chip?.textContent,
    clickable: chip?.getAttribute('data-online-chip-clickable'),
    role: chip?.getAttribute('role'),
  };
});
await p2.locator('[data-online-chip]').click();
await p2.waitForURL('**/nodes', { timeout: 10000 });
const oneUrl = p2.url();
await b2.close();

// State C: offline-only fleet (2 sessions, all offline → onlineNodes=0)
// 0-session fleet hits Overview's R52/R70 first-run CTA path, not
// TopoGraph; offline-only keeps the chip row alive so the non-
// interactive contract on "0 online" can be verified.
const { browser: b3, page: p3 } = await probe({ working: 0, idle: 0, offline: 2 });
const emptyProbe = await p3.evaluate(() => {
  const chip = document.querySelector('[data-online-chip]');
  return {
    text: chip?.textContent,
    clickable: chip?.getAttribute('data-online-chip-clickable'),
    role: chip?.getAttribute('role'),
    tabindex: chip?.getAttribute('tabindex'),
    cursor: chip?.getAttribute('style')?.includes('cursor: pointer'),
  };
});
await b3.close();

const results = {
  five_text5Online:        fiveProbe.text === '5 online',
  five_clickableTrue:      fiveProbe.clickable === 'true',
  five_roleLink:           fiveProbe.role === 'link',
  five_tabIndex0:          fiveProbe.tabindex === '0',
  five_cursorPointer:      fiveProbe.cursor === true,
  five_titleMentionsNodes: (fiveProbe.title || '').includes('/nodes'),
  five_navToNodes:         /\/nodes$/.test(fiveUrl),

  one_text1Online:         oneProbe.text === '1 online',
  one_clickableTrue:       oneProbe.clickable === 'true',
  one_roleLink:            oneProbe.role === 'link',
  one_navToNodes:          /\/nodes$/.test(oneUrl),

  empty_text0Online:       emptyProbe.text === '0 online',
  empty_clickableFalse:    emptyProbe.clickable === 'false',
  empty_noRole:            emptyProbe.role === null || emptyProbe.role === undefined,
  empty_noTabIndex:        emptyProbe.tabindex === null || emptyProbe.tabindex === undefined,
  empty_noCursor:          !emptyProbe.cursor,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} online chip nav:`, JSON.stringify(results),
  `\n  fiveProbe=`, fiveProbe, ` fiveUrl=`, fiveUrl,
  `\n  oneProbe=`, oneProbe, ` oneUrl=`, oneUrl,
  `\n  emptyProbe=`, emptyProbe);
process.exit(ok ? 0 : 1);
