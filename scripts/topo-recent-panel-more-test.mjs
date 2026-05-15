/* Round 128 verification: "+N more flows" overflow hint in the
 * recent-signal panel.
 *
 * The panel renders top 3 flowLinks via .slice(0, 3). When the
 * fleet has > 3 active flows, the rest silently disappear — the
 * R96 "X flows" header reports the total but doesn't make
 * truncation explicit. R128 adds a muted italic footer
 *   "+ N more flow(s)"
 * inside the existing panel (y=82, between row-3 baseline and the
 * panel bottom at y=84), only when flowLinks.length > 3.
 *
 * Three states tested:
 *   - 5 distinct flow pairs       → footer shows "+ 2 more flows"
 *   - exactly 3 flow pairs        → footer absent
 *   - 0 flows (empty panel)       → footer absent (R45 placeholder wins)
 *
 * Note: the test seeds (count) messages per pair so each unique
 * (from→to) pair becomes ONE flowLink (deduped). Pairs > 3 force
 * the hint; pairs ≤ 3 don't.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;

async function probe(pairCount) {
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
  // Make pairCount distinct (from→to) pairs, 1 msg each, ascending age
  for (let i = 0; i < pairCount; i++) {
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
  await page.waitForTimeout(500);

  const out = await page.evaluate(() => {
    const el = document.querySelector('[data-recent-panel-more]');
    const rows = document.querySelectorAll('[data-recent-row]').length;
    const headerCount = document.querySelector('[data-recent-panel-count]')?.textContent;
    return {
      footerPresent: !!el,
      footerText:    el?.textContent?.trim(),
      footerAttr:    el?.getAttribute('data-recent-panel-more'),
      rows,
      headerCount,
    };
  });

  await browser.close();
  return out;
}

const five  = await probe(5);
const three = await probe(3);
const zero  = await probe(0);

const results = {
  five_footerPresent:  five.footerPresent,
  five_footerText:     five.footerText === '+ 2 more flows',
  five_footerAttr:     five.footerAttr === '2',
  five_rowsCapped3:    five.rows === 3,
  five_headerSaysFive: five.headerCount?.startsWith('5'),

  three_footerAbsent:  !three.footerPresent,
  three_rowsExactly3:  three.rows === 3,

  zero_footerAbsent:   !zero.footerPresent,
  zero_rowsZero:       zero.rows === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} recent-panel more:`, JSON.stringify(results),
  `\n  five=`, five, `\n  three=`, three, `\n  zero=`, zero);
process.exit(ok ? 0 : 1);
