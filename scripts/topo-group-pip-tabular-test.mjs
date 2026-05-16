/* Round 230 verification: R58 status mix pip strip tspans
 * ([data-group-pip='working|idle|offline']) get fontVariantNumeric:
 * 'tabular-nums' so the digit doesn't jitter the dx-offset pip
 * chain at the 9→10 boundary.
 *
 * Scenario: 1 group with mixed tiers — alpha-1/2 working, alpha-3
 * idle, alpha-4 offline. R106 cluster forms one alpha- group with
 * box.statuses.working=2, idle=1, offline=1 → all three pips
 * present.
 *
 * Verifies each pip:
 *   getComputedStyle.fontVariantNumeric contains 'tabular-nums'
 *   text matches the expected '{N}{tier-letter}' shape
 *   fill is tier-specific (color check — sanity)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status,
    model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1', 'working'),
    mk('alpha-2', 'working'),
    mk('alpha-3', 'idle'),
    mk('alpha-4', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-group-pip="working"]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(400);

const out = await page.evaluate(() => {
  const grab = (tier) => {
    const el = document.querySelector(`[data-group-pip="${tier}"]`);
    if (!el) return null;
    return {
      tier,
      text:           el.textContent,
      fontVarNumeric: getComputedStyle(el).fontVariantNumeric,
      fill:           getComputedStyle(el).fill,
    };
  };
  return {
    working: grab('working'),
    idle:    grab('idle'),
    offline: grab('offline'),
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');

const results = {
  working_present:   out.working !== null,
  working_text:      out.working?.text === '2w',
  working_tabular:   hasTab(out.working?.fontVarNumeric),
  idle_present:      out.idle !== null,
  idle_text:         out.idle?.text === '1i',
  idle_tabular:      hasTab(out.idle?.fontVarNumeric),
  offline_present:   out.offline !== null,
  offline_text:      out.offline?.text === '1o',
  offline_tabular:   hasTab(out.offline?.fontVarNumeric),
  // Sanity: tier-specific fills still distinct from each other
  fills_distinct:    out.working && out.idle && out.offline &&
                     new Set([out.working.fill, out.idle.fill, out.offline.fill]).size === 3,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group-pip tabular:`, JSON.stringify(results),
  '\n  pips:', out);
process.exit(ok ? 0 : 1);
