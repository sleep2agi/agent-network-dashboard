/* Round 129 verification: recent-signal panel header gains a
 * " · N hot" amber tail when ≥ 1 flowLink has count ≥ 10.
 *
 * The hot-lane convention's surfaces:
 *   R126: canvas midpoint count badge → amber stroke
 *   R127: recent-signal row count digit → amber + bold
 *   R129: recent-signal panel HEADER  → " · N hot" amber suffix
 *
 * Vertical scan path now reads: header → rows → canvas. Each layer
 * answers a different scope: header = "how many hot?", rows =
 * "which ones?", canvas = "where on the topology?".
 *
 * Three states:
 *   A. 3 pairs, all count <  10                  → header "3 flows", no hot tail
 *   B. 5 pairs, 2 of them count ≥ 10             → header "5 flows · 2 hot", amber tail
 *   C. 5 pairs, 5 of them count ≥ 10             → header "5 flows · 5 hot"
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

async function probe(seedPairs) {
  // seedPairs is an array of [from, to, count] tuples — each pair gets
  // `count` msgs to make link.count == count after dedup.
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });

  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const aliasSet = new Set();
  for (const [a, b] of seedPairs) { aliasSet.add(a); aliasSet.add(b); }
  const aliases = [...aliasSet];
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
  let id = 0;
  for (const [from, to, count] of seedPairs) {
    for (let i = 0; i < count; i++) {
      msgs.push({
        id: `m${id++}`,
        from_alias: from,
        to_alias: to,
        content: 'hi',
        network_id: 'default',
        created_at: new Date(now - (20000 + i * 500 + id * 13)).toISOString(),
      });
    }
  }
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('g[data-node]').length === n, aliases.length, { timeout: 30000 });
  await page.waitForTimeout(500);

  const out = await page.evaluate(() => {
    const count = document.querySelector('[data-recent-panel-count]');
    const hot   = document.querySelector('[data-recent-panel-hot-count]');
    return {
      countText: count?.textContent,
      hotText:   hot?.textContent,
      hotAttr:   hot?.getAttribute('data-recent-panel-hot-count'),
      hotFill:   hot?.getAttribute('fill'),
      hotWeight: hot?.getAttribute('font-weight'),
    };
  });

  await browser.close();
  return out;
}

// State A: all warm
const a = await probe([
  ['alpha', 'beta', 4],
  ['gamma', 'delta', 5],
  ['epsilon', 'zeta', 3],
]);

// State B: 5 pairs, 2 hot (≥ 10)
const b = await probe([
  ['alpha', 'beta', 12],   // hot
  ['gamma', 'delta', 15],  // hot
  ['epsilon', 'zeta', 4],
  ['eta', 'theta', 6],
  ['iota', 'kappa', 8],
]);

// State C: 5 pairs, all 5 hot
const c = await probe([
  ['alpha', 'beta', 12],
  ['gamma', 'delta', 11],
  ['epsilon', 'zeta', 14],
  ['eta', 'theta', 13],
  ['iota', 'kappa', 25],
]);

const amber = '#fbbf24';

const results = {
  a_count_3flows:   a.countText === '3 flows',
  a_noHotTspan:     a.hotText === undefined,

  b_count_5flows:   b.countText === '5 flows',
  b_hot_text:       b.hotText === ' · 2 hot',
  b_hot_attr:       b.hotAttr === '2',
  b_hot_amberFill:  (b.hotFill || '').toLowerCase() === amber,
  b_hot_boldWeight: b.hotWeight === '700',

  c_count_5flows:   c.countText === '5 flows',
  c_hot_text:       c.hotText === ' · 5 hot',
  c_hot_attr:       c.hotAttr === '5',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-panel hot header:`, JSON.stringify(results),
  `\n  A=`, a, `\n  B=`, b, `\n  C=`, c);
process.exit(ok ? 0 : 1);
