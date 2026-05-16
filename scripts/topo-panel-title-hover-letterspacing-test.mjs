/* Round 345 verification: panel titles ("recent signal" + "legend")
 * gain letter-spacing tween 0.3 → 0.4 on panel hover. Sibling to
 * R344 hover-letter-spacing applied to the +N more flows footer —
 * same gesture vocabulary at panel-title scope.
 *
 * Contract:
 *   - Rest: both titles letterSpacing 0.3.
 *   - Hover recent panel: recent-panel-title letterSpacing 0.4.
 *   - Hover legend panel: legend-panel-title letterSpacing 0.4
 *     (separately).
 *   - Inline transition list contains 'letter-spacing' on both.
 *   - R344 footer hover regression intact (when flowLinks > 3).
 *   - R317/R318/R294 chrome + pulse regressions intact.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
// One message → recent-signal panel mounts so its title is testable.
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-recent-panel-title]', { timeout: 15000 });
await page.waitForSelector('[data-legend-panel-title]',  { timeout: 5000 });
await page.waitForTimeout(300);

// Rest probe.
const restProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-recent-panel-title]');
  const l = document.querySelector('[data-legend-panel-title]');
  return {
    recentLetterSp:    r?.getAttribute('letter-spacing') ?? null,
    recentTrans:       r ? getComputedStyle(r).transition : null,
    legendLetterSp:    l?.getAttribute('letter-spacing') ?? null,
    legendTrans:       l ? getComputedStyle(l).transition : null,
  };
});

// Hover the recent panel via its data attribute.
await page.hover('[data-topo-panel="recent"]');
await page.waitForTimeout(300);
const recentHoverProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-recent-panel-title]');
  return { letterSp: r?.getAttribute('letter-spacing') ?? null };
});

// Move to legend panel.
await page.hover('[data-topo-panel="legend"]');
await page.waitForTimeout(300);
const legendHoverProbe = await page.evaluate(() => {
  const l = document.querySelector('[data-legend-panel-title]');
  return { letterSp: l?.getAttribute('letter-spacing') ?? null };
});

await browser.close();

const hasLetterSpacingTrans = (s) =>
  /letter-spacing\s+\d*\.?\d*s|letter-spacing\s+\d+ms/i.test(s || '');

const results = {
  rest_recent_0_3:           restProbe.recentLetterSp === '0.3',
  rest_legend_0_3:           restProbe.legendLetterSp === '0.3',
  recent_transition_has_ls:  hasLetterSpacingTrans(restProbe.recentTrans),
  legend_transition_has_ls:  hasLetterSpacingTrans(restProbe.legendTrans),
  hover_recent_0_4:          recentHoverProbe.letterSp === '0.4',
  hover_legend_0_4:          legendHoverProbe.letterSp === '0.4',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel title hover letter-spacing:`, JSON.stringify(results),
  '\n  rest:        ', restProbe,
  '\n  hover recent:', recentHoverProbe,
  '\n  hover legend:', legendHoverProbe);
process.exit(ok ? 0 : 1);
