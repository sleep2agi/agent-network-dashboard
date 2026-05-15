/* Round 136 verification: the "N active links" chip in the chip
 * row becomes a clickable nav to /messages when flowLinks.length
 * > 0. Closes the cursor-pointer-lying bug — the chip already had
 * cursor:pointer set when interactive, but no onClick handler was
 * wired (line 1877 of TopoGraph.tsx pre-R136). Mirrors R133 footer-
 * nav idiom and generalizes "click to open the full flow list"
 * across the chip row, not just the recent-signal panel.
 *
 * Two-state behavior:
 *   - flowLinks.length === 0 → not interactive: no role=link, no
 *     cursor:pointer, no onClick fires
 *   - flowLinks.length  > 0 → role=link, tabIndex=0, cursor:pointer,
 *     onClick → /messages, tooltip mentions "click to open"
 *
 * Hover still boosts edges (R77) regardless — that's a separate
 * gesture.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

async function probeWithFlows(pairCount) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const aliases = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: aliases.map(mk) } });
  });
  const now = Date.now();
  const msgs = [];
  for (let i = 0; i < pairCount; i++) {
    msgs.push({
      id: `m${i}`,
      from_alias: aliases[i % aliases.length],
      to_alias:   aliases[(i + 1) % aliases.length],
      content: 'hi',
      network_id: 'default',
      created_at: new Date(now - (20000 + i * 1000)).toISOString(),
    });
  }
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 5, { timeout: 30000 });
  await page.waitForSelector('[data-active-links-chip]', { timeout: 10000 });
  await page.waitForTimeout(400);

  const probe = await page.evaluate(() => {
    const chip = document.querySelector('[data-active-links-chip]');
    return {
      flowCount:    chip?.getAttribute('data-active-links-flow-count'),
      clickable:    chip?.getAttribute('data-active-links-clickable'),
      role:         chip?.getAttribute('role'),
      tabindex:     chip?.getAttribute('tabindex'),
      cursor:       (chip?.getAttribute('style') || '').includes('cursor: pointer'),
      title:        chip?.getAttribute('title'),
    };
  });

  let finalUrl = null;
  if (pairCount > 0) {
    await page.locator('[data-active-links-chip]').click();
    await page.waitForURL('**/messages', { timeout: 10000 });
    finalUrl = page.url();
  }
  await browser.close();
  return { probe, finalUrl };
}

const empty   = await probeWithFlows(0);
const oneFlow = await probeWithFlows(1);
const many    = await probeWithFlows(3);

const results = {
  // Empty (0 flows) — not interactive
  empty_flowCount0:        empty.probe.flowCount === '0',
  empty_clickableFalse:    empty.probe.clickable === 'false',
  empty_noRole:            empty.probe.role === null || empty.probe.role === undefined,
  empty_noTabIndex:        empty.probe.tabindex === null || empty.probe.tabindex === undefined,
  empty_noPointer:         !empty.probe.cursor,
  empty_noTooltip:         !empty.probe.title,

  // 1 flow — interactive
  one_flowCount1:          oneFlow.probe.flowCount === '1',
  one_clickableTrue:       oneFlow.probe.clickable === 'true',
  one_roleLink:            oneFlow.probe.role === 'link',
  one_tabIndex0:           oneFlow.probe.tabindex === '0',
  one_cursorPointer:       oneFlow.probe.cursor,
  one_titleMentionsOpen:   (oneFlow.probe.title || '').includes('click to open'),
  one_navigatedToMessages: /\/messages$/.test(oneFlow.finalUrl || ''),

  // 3 flows — same interactive shape
  many_clickableTrue:      many.probe.clickable === 'true',
  many_navigatedToMessages: /\/messages$/.test(many.finalUrl || ''),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links chip nav:`, JSON.stringify(results),
  `\n  empty=`, empty,
  `\n  oneFlow=`, oneFlow,
  `\n  many=`, many);
process.exit(ok ? 0 : 1);
