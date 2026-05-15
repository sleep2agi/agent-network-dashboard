/* Round 138 verification: recent-signal row typography unifies
 * with the rest of the topology UI.
 *
 * Pre-R138 row text:   "alpha -> beta / 12 / hi"
 * Post-R138 row text:  "alpha → beta · 12 · hi"
 *
 * Why: filter pills (R119), node tooltips (R98), active-links
 * chip tooltip (R114), edge-badge titles all use the unicode
 * arrow `→` and the data-delimiter ` · `. The recent-signal row
 * was the lone holdout using ASCII `->` and ` / `. R138 brings
 * it in line so the row reads like every other surface.
 *
 * Checks:
 *   - Row text contains "→" (unicode arrow)
 *   - Row text does NOT contain "->" (ASCII)
 *   - Row text uses " · " (middle dot) as separator
 *   - Row text does NOT contain " / " (forward slash)
 *   - Hot count tspan still works (R127 contract preserved)
 *   - Row pin still works (R116 contract preserved)
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'), mk('beta', 'working'), mk('gamma', 'idle'),
  ] } });
});

const now = Date.now();
const mkMsg = (id, from, to, ageMs) => ({
  id, from_alias: from, to_alias: to, content: 'hello',
  network_id: 'default', created_at: new Date(now - ageMs).toISOString(),
});
const msgs = [];
// alpha→beta: 12 msgs (hot)
for (let i = 0; i < 12; i++) msgs.push(mkMsg(`a${i}`, 'alpha', 'beta', 20000 + i * 500));
// beta→gamma: 4 msgs (warm)
for (let i = 0; i < 4; i++) msgs.push(mkMsg(`b${i}`, 'beta', 'gamma', 30000 + i * 500));
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-recent-row="alpha->beta"]', { timeout: 10000 });
await page.waitForTimeout(400);

const inspect = (key) => page.evaluate((k) => {
  const row = document.querySelector(`[data-recent-row="${k}"]`);
  const text = row?.querySelector('text');
  return {
    fullText: text?.textContent,
    pinned:   row?.getAttribute('data-recent-row-pinned'),
    hot:      row?.getAttribute('data-recent-row-hot'),
  };
}, key);

const a2b = await inspect('alpha->beta');
const b2g = await inspect('beta->gamma');

// Verify pin still works (R116 invariant)
await page.locator('[data-recent-row="alpha->beta"]').click();
await page.waitForTimeout(200);
const a2bPinned = await inspect('alpha->beta');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await browser.close();

// Note: data-recent-row attribute itself still uses "alpha->beta" as
// the link.key (computed from from + '->' + to upstream). That's
// internal data, not user-visible text — R138 only touches the
// rendered <text> content.
const hasUnicodeArrow = (s) => !!s && s.includes('→');
const lacksAsciiArrow = (s) => !!s && !s.includes('->');
const usesMiddleDot   = (s) => !!s && s.includes('·');
const lacksSlash      = (s) => !!s && !/\s\/\s/.test(s);

const results = {
  a2b_hasUnicodeArrow: hasUnicodeArrow(a2b.fullText),
  a2b_lacksAsciiArrow: lacksAsciiArrow(a2b.fullText),
  a2b_usesMiddleDot:   usesMiddleDot(a2b.fullText),
  a2b_lacksSlash:      lacksSlash(a2b.fullText),

  b2g_hasUnicodeArrow: hasUnicodeArrow(b2g.fullText),
  b2g_usesMiddleDot:   usesMiddleDot(b2g.fullText),

  // R127 hot preserved
  a2b_hotAttr:         a2b.hot === 'true',
  b2g_notHot:          b2g.hot === 'false',

  // R116 pin preserved
  pin_landed:          a2bPinned.pinned === 'true',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row typography:`, JSON.stringify(results),
  `\n  a2b=`, a2b,
  `\n  b2g=`, b2g,
  `\n  a2bPinned=`, a2bPinned);
process.exit(ok ? 0 : 1);
