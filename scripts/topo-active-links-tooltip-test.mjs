/* Round 114 verification: active-links chip tooltip lists the actual
 * flow pairs. Closes the info-density sweep on the last chip-row
 * hover surface (R97-R113 covered everything else). Format:
 *   "alpha→beta (3), gamma→delta (1) — hover brightens all"
 *
 * Drive 3 flow pairs of different counts. Verify each pair appears
 * in the title with its count; the trailing action hint says
 * "hover brightens all". Empty-flow fleet → no title.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const fresh = new Date(Date.now() - 30 * 1000).toISOString();

const probe = async (withFlow) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
  });
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias) => ({
      alias, status: 'idle', model: 'claude-opus-4', runtime: 'cli-claude-code',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma'), mk('delta')] } });
  });
  const now = Date.now();
  const mkMsg = (id, from_alias, to_alias, ageMs) => ({
    id, from_alias, to_alias, content: 'hi', network_id: 'default',
    created_at: new Date(now - ageMs).toISOString(),
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: withFlow ? [
    mkMsg('m1', 'alpha', 'beta',  30 * 1000),
    mkMsg('m2', 'alpha', 'beta',  40 * 1000),
    mkMsg('m3', 'alpha', 'beta',  50 * 1000),
    mkMsg('m4', 'gamma', 'delta', 60 * 1000),
  ] : [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
  await page.waitForTimeout(600);
  const data = await page.evaluate(() => {
    const el = document.querySelector('[data-active-links-chip]');
    return {
      title:     el?.getAttribute('title'),
      flowCount: el?.getAttribute('data-active-links-flow-count') || '',
      text:      el?.textContent?.trim() || '',
    };
  });
  await ctx.close();
  return data;
};

const empty = await probe(false);
const full  = await probe(true);
await browser.close();

const results = {
  empty_noTitle:           empty.title === null,
  empty_zeroCount:         empty.flowCount === '0',
  full_titleHasAlphaBeta:  /alpha→beta \(3\)/.test(full.title || ''),
  full_titleHasGammaDelta: /gamma→delta \(1\)/.test(full.title || ''),
  full_titleActionHint:    /hover brightens all/.test(full.title || ''),
  full_flowCount2:         full.flowCount === '2',
  full_chipShowsCount:     /2 active link/.test(full.text),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links tooltip:`, JSON.stringify(results),
  `\n  empty=`, empty,
  `\n  full=`,  full);
process.exit(ok ? 0 : 1);
