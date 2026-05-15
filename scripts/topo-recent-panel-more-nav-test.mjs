/* Round 133 verification: R128's "+N more flows" footer becomes a
 * clickable nav to /messages. R128 introduced the truncation hint
 * as pure metadata; R133 lets the user act on it.
 *
 * Three states tested:
 *   A. Click footer → navigation lands on /messages
 *   B. Hover footer → opacity rises 0.55 → 0.85, underline appears
 *   C. Leave hover → opacity drops back, underline gone
 *
 * Plus: footer carries role="link" + cursor:pointer + a tooltip
 * referencing /messages, all for discoverability and a11y.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const aliases = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
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
// 5 distinct pairs → forces R128 footer with "+ 2 more flows"
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`,
    from_alias: aliases[i],
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
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForSelector('[data-recent-panel-more-nav]', { timeout: 10000 });
await page.waitForTimeout(400);

const beforeHover = await page.evaluate(() => {
  const wrap = document.querySelector('[data-recent-panel-more-nav]');
  const text = wrap?.querySelector('text[data-recent-panel-more]');
  return {
    role:        wrap?.getAttribute('role'),
    tabindex:    wrap?.getAttribute('tabindex'),
    cursor:      (wrap?.getAttribute('style') || '').includes('pointer'),
    title:       wrap?.querySelector('title')?.textContent,
    opacity:     text?.getAttribute('opacity'),
    underline:   text?.getAttribute('text-decoration'),
    moreCount:   text?.getAttribute('data-recent-panel-more'),
  };
});

// Hover the footer
await page.locator('[data-recent-panel-more-nav]').hover();
await page.waitForTimeout(250);
const onHover = await page.evaluate(() => {
  const text = document.querySelector('[data-recent-panel-more-nav] text');
  return {
    opacity:   text?.getAttribute('opacity'),
    underline: text?.getAttribute('text-decoration'),
  };
});

// Move away → restore
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const afterLeave = await page.evaluate(() => {
  const text = document.querySelector('[data-recent-panel-more-nav] text');
  return {
    opacity:   text?.getAttribute('opacity'),
    underline: text?.getAttribute('text-decoration'),
  };
});

// Click → expect /messages navigation
await page.locator('[data-recent-panel-more-nav]').click();
await page.waitForURL('**/messages', { timeout: 10000 });
const finalUrl = page.url();

await browser.close();

const results = {
  before_roleLink:       beforeHover.role === 'link',
  before_tabIndex0:      beforeHover.tabindex === '0',
  before_cursorPointer:  beforeHover.cursor,
  before_titleMentionsMessages: (beforeHover.title || '').includes('/messages'),
  before_moreCount2:     beforeHover.moreCount === '2',
  before_opacity55:      beforeHover.opacity === '0.55',
  before_noUnderline:    beforeHover.underline === 'none' || !beforeHover.underline,

  hover_opacity85:       onHover.opacity === '0.85',
  hover_underline:       onHover.underline === 'underline',

  leave_opacityRestored: afterLeave.opacity === '0.55',
  leave_underlineGone:   afterLeave.underline === 'none' || !afterLeave.underline,

  click_navigatedToMessages: /\/messages$/.test(finalUrl),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-panel more nav:`, JSON.stringify(results),
  `\n  before=`, beforeHover,
  `\n  onHover=`, onHover,
  `\n  afterLeave=`, afterLeave,
  `\n  finalUrl=`, finalUrl);
process.exit(ok ? 0 : 1);
