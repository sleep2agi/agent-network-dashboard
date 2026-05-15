/* Round 189 verification: recent-signal row count tspan unified
 * into one always-mounted element with fill/fontWeight gated by
 * isHot. transition: fill 300ms ease-out makes the R127 hot
 * threshold crossing (count >= 10) ease smoothly through the
 * colour shift instead of snapping.
 *
 * Pre-R189 two tspans branched on isHot — different
 * data-recent-row-count and data-recent-row-count-hot
 * attributes; mount/unmount made fill+fontWeight snap.
 *
 * Test:
 *   Mock 3 flows side by side:
 *     alpha→beta:  count=4  (cold) → fill unset, weight unset,
 *                                    no hot attr
 *     alpha→gamma: count=12 (hot)  → fill=amber, weight=700,
 *                                    hot attr 'true'
 *     alpha→delta: count=20 (hot)  → fill=amber, weight=700
 *   All three tspans:
 *     - have data-recent-row-count
 *     - have style.transition includes 'fill 300ms'
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});

const now = Date.now();
const msgs = [];
// alpha→beta: 4 (cold)
for (let i = 0; i < 4; i++) {
  msgs.push({ id: `cold${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (5000 + i * 50)).toISOString() });
}
// alpha→gamma: 12 (hot)
for (let i = 0; i < 12; i++) {
  msgs.push({ id: `h1${i}`, from_alias: 'alpha', to_alias: 'gamma', content: 'hi',
    network_id: 'default', created_at: new Date(now - (10000 + i * 50)).toISOString() });
}
// alpha→delta: 20 (hot)
for (let i = 0; i < 20; i++) {
  msgs.push({ id: `h2${i}`, from_alias: 'alpha', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (15000 + i * 50)).toISOString() });
}
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row-count]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const tspans = [...document.querySelectorAll('[data-recent-row-count]')];
  return tspans.map(t => {
    const row = t.closest('[data-recent-row]');
    return {
      rowKey:      row?.getAttribute('data-recent-row'),
      text:        t.textContent,
      fill:        t.getAttribute('fill'),
      fontWeight:  t.getAttribute('font-weight'),
      hotAttr:     t.getAttribute('data-recent-row-count-hot'),
      transition:  t.style.transition || getComputedStyle(t).transition,
    };
  });
});

await browser.close();

const findByKey = (key) => probe.find(p => p.rowKey === key);
const cold = findByKey('alpha->beta');
const hot1 = findByKey('alpha->gamma');
const hot2 = findByKey('alpha->delta');

const hasFillTransition = (s) =>
  (s?.transition || '').includes('fill 300ms') ||
  /fill\s+0\.3s|fill\s+300ms/.test(s?.transition || '');

const results = {
  three_tspans_present:     probe.length === 3,
  cold_found:               cold !== undefined,
  hot1_found:               hot1 !== undefined,
  hot2_found:               hot2 !== undefined,

  cold_no_fill:             cold?.fill === null || cold?.fill === undefined,
  cold_no_fontWeight:       cold?.fontWeight === null || cold?.fontWeight === undefined,
  cold_no_hot_attr:         cold?.hotAttr === null,
  cold_text_4:              cold?.text === '4',

  hot1_fill_amber:          hot1?.fill === '#fbbf24',
  hot1_fontWeight_700:      hot1?.fontWeight === '700',
  hot1_hot_attr:            hot1?.hotAttr === 'true',
  hot1_text_12:             hot1?.text === '12',

  hot2_fill_amber:          hot2?.fill === '#fbbf24',
  hot2_fontWeight_700:      hot2?.fontWeight === '700',
  hot2_hot_attr:            hot2?.hotAttr === 'true',
  hot2_text_20:             hot2?.text === '20',

  all_have_fill_transition: probe.every(p => hasFillTransition(p)),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-row count fill:`, JSON.stringify(results),
  `\n  cold:`, cold,
  `\n  hot1:`, hot1,
  `\n  hot2:`, hot2);
process.exit(ok ? 0 : 1);
