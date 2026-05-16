/* Round 225 verification: info-density tabular-nums sweep across
 * the three remaining digit-bearing texts in the TopoGraph after
 * R224's edge badge:
 *   1) Hub center digit       (data-topo-hub-working-count)
 *   2) Recent panel header    (data-recent-panel-count tspan)
 *   3) Recent row count       (data-recent-row-count tspan)
 *
 * Pre-R225 each suffered the same monospace-digit jitter at the
 * 9 → 10 boundary (the digit-vs-control glyph width variance is
 * non-zero even in mono fonts; textAnchor='middle' or trailing
 * text columns visibly shift on the boundary).
 *
 * Verification: getComputedStyle().fontVariantNumeric contains
 * 'tabular-nums' on each of the three. Single populated scenario
 * (4 working agents + 12-msg hot flow) drives all three at once.
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
const now = Date.now();
const msgs = [];
for (let i = 0; i < 12; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-recent-row-count]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(400);

const out = await page.evaluate(() => {
  const fvn = (el) => el ? getComputedStyle(el).fontVariantNumeric : null;
  const text = (el) => el?.textContent?.trim() || null;
  const hubDigit  = document.querySelector('[data-topo-hub-working-count]');
  const panelCnt  = document.querySelector('[data-recent-panel-count]');
  const rowCnt    = document.querySelector('[data-recent-row-count]');
  return {
    hub:   { found: !!hubDigit, fvn: fvn(hubDigit),  text: text(hubDigit),
             working: hubDigit?.getAttribute('data-topo-hub-working-count') },
    panel: { found: !!panelCnt, fvn: fvn(panelCnt),  text: text(panelCnt) },
    row:   { found: !!rowCnt,   fvn: fvn(rowCnt),    text: text(rowCnt) },
  };
});
await browser.close();

const hasTab = (s) => /tabular-nums/.test(s || '');
const results = {
  hub_found:         out.hub.found,
  hub_tabular:       hasTab(out.hub.fvn),
  hub_text_present:  /^\d+$/.test(out.hub.text || ''),
  hub_text_equals_4: out.hub.text === '4',

  panel_found:       out.panel.found,
  panel_tabular:     hasTab(out.panel.fvn),
  panel_text_flows:  /^\d+\s+flows?$/.test(out.panel.text || ''),

  row_found:         out.row.found,
  row_tabular:       hasTab(out.row.fvn),
  row_text_equals_12: out.row.text === '12',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} tabular-nums sweep:`, JSON.stringify(results),
  '\n  hub:  ', out.hub,
  '\n  panel:', out.panel,
  '\n  row:  ', out.row);
process.exit(ok ? 0 : 1);
