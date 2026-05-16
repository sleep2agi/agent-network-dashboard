/* Round 330 verification (milestone): canvas wrapper rounded-lg →
 * rounded-xl (8px → 12px corner radius). The largest single surface
 * on the dashboard now reads contemporary rather than conservative.
 *
 * Contract:
 *   - [data-topo-wrapper] className contains 'rounded-xl' (not
 *     'rounded-lg').
 *   - Computed border-top-left-radius === '12px'.
 *   - R263 box-shadow transition still in inline transition list
 *     (regression: theme-toggle continues to ease).
 *   - R317 / R318 / R294 chrome + pulse regressions intact.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-wrapper]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-topo-wrapper]');
  const cs = wrapper ? getComputedStyle(wrapper) : null;
  return {
    wrapperClass:        wrapper?.className ?? '',
    wrapperTopLeftRadius: cs?.borderTopLeftRadius ?? null,
    wrapperTransition:   cs?.transition ?? null,
    layoutInactiveCls:   document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:     document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:          document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const hasBoxShadowTrans = (s) => /box-shadow\s+0?\.?\d*s|box-shadow\s+\d+ms/i.test(s || '');

const results = {
  wrapper_has_rounded_xl:      probe.wrapperClass.includes('rounded-xl') && !probe.wrapperClass.includes('rounded-lg'),
  wrapper_radius_12px:         probe.wrapperTopLeftRadius === '12px',
  // R263 regression: box-shadow transition.
  r263_box_shadow_transition:  hasBoxShadowTrans(probe.wrapperTransition),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} wrapper radius rounded-xl:`, JSON.stringify(results),
  '\n  border-top-left-radius:', probe.wrapperTopLeftRadius,
  '\n  transition:',             probe.wrapperTransition);
process.exit(ok ? 0 : 1);
