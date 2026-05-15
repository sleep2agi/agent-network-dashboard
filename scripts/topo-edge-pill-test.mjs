/* Round 119 verification: when a recent-signal row is pinned (R116),
 * the chip row renders a 4th "filter: from→to · N" pill matching
 * the R64 / R89 pattern for status / group / vendor pins. Closes the
 * pill-pattern gap left after R116.
 *
 * Verifies:
 *   - Before pin: no edge pill
 *   - Click row → pill shows correct from→to and count
 *   - Click pill body → clears
 *   - × button also clears
 *   - data-filter-match-aliases lists the two endpoints
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
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});

const now = Date.now();
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'hi', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  mkMsg('m1', 'alpha', 'beta', 30 * 1000),
  mkMsg('m2', 'alpha', 'beta', 40 * 1000),
  mkMsg('m3', 'alpha', 'beta', 50 * 1000),
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-recent-row]', { timeout: 10000 });
await page.waitForTimeout(400);

const readPill = () => page.evaluate(() => {
  const p = document.querySelector('[data-active-filter="edge"]');
  if (!p) return null;
  return {
    text:    (p.textContent || '').trim(),
    count:   p.getAttribute('data-filter-match-count'),
    aliases: p.getAttribute('data-filter-match-aliases') || '',
    title:   p.getAttribute('title') || '',
  };
});

const before = await readPill();

// Click row to pin.
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterPin = await readPill();

// Click pill body to clear.
await page.locator('[data-active-filter="edge"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterBodyClear = await readPill();

// Pin again, then click × button.
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
await page.locator('[data-active-filter="edge"] button').click();
await page.waitForTimeout(300);
const afterXClear = await readPill();

await browser.close();

const results = {
  before_noPill:         before === null,
  pin_pillRendered:      afterPin !== null,
  pin_textContainsArrow: /alpha→beta/.test(afterPin?.text || ''),
  pin_count3:            afterPin?.count === '3',
  pin_aliasesMatch:      afterPin?.aliases === 'alpha,beta',
  pin_titleHasFromTo:    /alpha → beta \(3 msgs\)/.test(afterPin?.title || ''),
  bodyClear_pillGone:    afterBodyClear === null,
  xClear_pillGone:       afterXClear === null,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge pill:`, JSON.stringify(results),
  `\n  afterPin=`,        afterPin,
  `\n  afterBodyClear=`,  afterBodyClear,
  `\n  afterXClear=`,     afterXClear);
process.exit(ok ? 0 : 1);
