/* Round 127 verification: recent-signal panel row mirrors R126's
 * canvas hot-badge convention. When link.count >= 10 the count
 * digit inside the row text renders in amber (#d97706 light,
 * #fbbf24 dark) + bold (font-weight 700). Surrounding alias text +
 * separators stay in legendText/legendHeadline.
 *
 * Fleet:
 *   alpha → beta:  12 msgs → HOT row, count tspan amber+bold
 *   beta  → gamma:  4 msgs → warm row, count tspan default
 *
 * Path:
 *   1. recent panel has 2 rows; data-recent-row-hot reflects bucket
 *   2. alpha→beta row: data-recent-row-count-hot tspan present, amber
 *   3. beta→gamma row: data-recent-row-count (non-hot) tspan present
 *   4. Symmetry with R126: the canvas badge for alpha→beta and the
 *      recent-row count for alpha→beta both render the same amber
 *      hex.
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
const mkMsg = (id, from_alias, to_alias, ageMs) => ({
  id, from_alias, to_alias, content: 'hi', network_id: 'default',
  created_at: new Date(now - ageMs).toISOString(),
});
const msgs = [];
for (let i = 0; i < 12; i++) msgs.push(mkMsg(`a${i}`, 'alpha', 'beta',  20000 + i * 500));
for (let i = 0; i < 4;  i++) msgs.push(mkMsg(`b${i}`, 'beta',  'gamma', 30000 + i * 500));
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-recent-row="alpha->beta"]', { timeout: 10000 });
await page.waitForTimeout(400);

const inspect = (key) => page.evaluate((k) => {
  const row = document.querySelector(`[data-recent-row="${k}"]`);
  if (!row) return null;
  const hotTspan = row.querySelector('[data-recent-row-count-hot]');
  const warmTspan = row.querySelector('[data-recent-row-count]');
  return {
    hot:           row.getAttribute('data-recent-row-hot'),
    hotTspanText:  hotTspan?.textContent,
    hotTspanFill:  hotTspan?.getAttribute('fill'),
    hotTspanWeight: hotTspan?.getAttribute('font-weight'),
    warmTspanText: warmTspan?.textContent,
  };
}, key);

const a2b = await inspect('alpha->beta');
const b2g = await inspect('beta->gamma');

// Also assert the canvas badge for alpha→beta still flips to the
// same amber stroke — symmetry of canvas + panel hot signals.
const badgeStroke = await page.evaluate(() => {
  const g = document.querySelector('[data-edge-count-badge="alpha->beta"]');
  return g?.querySelector('circle')?.getAttribute('stroke');
});

await browser.close();

// Dark theme amber: #fbbf24
const amberHex = '#fbbf24';

const results = {
  a2b_attrHot:        a2b !== null && a2b.hot === 'true',
  a2b_hotTspan:       a2b !== null && a2b.hotTspanText === '12',
  a2b_amberFill:      a2b !== null && (a2b.hotTspanFill || '').toLowerCase() === amberHex,
  a2b_boldWeight:     a2b !== null && a2b.hotTspanWeight === '700',
  a2b_noWarmTspan:    a2b !== null && a2b.warmTspanText === undefined,

  b2g_attrNotHot:     b2g !== null && b2g.hot === 'false',
  b2g_warmTspan:      b2g !== null && b2g.warmTspanText === '4',
  b2g_noHotTspan:     b2g !== null && a2b !== null && b2g.hotTspanText === undefined,

  symmetric_badgeAmber: (badgeStroke || '').toLowerCase() === amberHex,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row hot:`, JSON.stringify(results),
  `\n  a2b=`, a2b,
  `\n  b2g=`, b2g,
  `\n  canvas badge stroke for alpha→beta =`, badgeStroke);
process.exit(ok ? 0 : 1);
