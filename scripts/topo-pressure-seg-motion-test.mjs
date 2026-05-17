/* Round 524 verification: pressure-bar segment width + filter motion
 * restored — extends .anet-topo-chip-focus transition-property list
 * to include `width` and `filter`, fixing the R165/R210 motion
 * polishes silently broken by R490.
 *
 * Test phases:
 *   1. computed transition on pressure-seg includes:
 *      - background-color (R510 family, R83 box-shadow already works)
 *      - width (R165 restoration ← R524)
 *      - filter (R210 brightness restoration ← R524)
 *      all at 200ms ease-out
 *   2. globals.css source confirms width + filter in property list
 *   3. hover the segment → filter brightness applied + transitioning
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'),
    mk('a·2', 'idle'),
    mk('a·3', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-pressure-seg="working"]', { timeout: 15000 });
await page.waitForTimeout(800);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-pressure-seg="working"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    transition:        cs.transition,
    transitionProp:    cs.transitionProperty,
    transitionDur:     cs.transitionDuration,
    filter:            cs.filter,
  };
});

// Hover the segment → filter should apply
await page.hover('[data-pressure-seg="working"]');
await page.waitForTimeout(350);
const hover = await page.evaluate(() => {
  const el = document.querySelector('[data-pressure-seg="working"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter:  cs.filter,
  };
});

await browser.close();

const css = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const cssHasWidth =
  /\.anet-topo-chip-focus[\s\S]*?transition-property:[\s\S]*?width[\s\S]*?!important/.test(css);
const cssHasFilter =
  /\.anet-topo-chip-focus[\s\S]*?transition-property:[\s\S]*?filter[\s\S]*?!important/.test(css);

const results = {
  has_width_in_prop:        /(^|,\s*)width(,|$)/.test(rest?.transitionProp || '') ||
                            /\bwidth\b/.test(rest?.transitionProp || ''),
  has_filter_in_prop:       /\bfilter\b/.test(rest?.transitionProp || ''),
  has_bg_color_in_prop:     /background-color/.test(rest?.transitionProp || ''),  // sanity
  duration_200ms:           /(200ms|0\.2s)/.test(rest?.transitionDur || ''),
  rest_no_filter:           rest?.filter === 'none' || rest?.filter === '',
  hover_filter_brightness:  /brightness\(1\.2\)/.test(hover?.filter || ''),
  css_width_in_list:        cssHasWidth,
  css_filter_in_list:       cssHasFilter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R524 pressure-seg motion restored:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover.filter:', hover?.filter);
process.exit(ok ? 0 : 1);
