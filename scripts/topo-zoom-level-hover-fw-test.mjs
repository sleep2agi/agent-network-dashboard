/* Round 420 verification: chrome zoom-level readout gains hover
 * fontWeight 500 → 600 — sibling to R347 hover letter-spacing
 * on the same element. Two-axis hover signature on the chrome
 * strip's only data display.
 *
 * Contract:
 *   - At rest: computed fontWeight === '500'
 *   - On hover: computed fontWeight === '600' AND letterSpacing > 0
 *     (R347 invariant)
 *   - Pre-R420 invariants preserved:
 *     * className includes 'tabular-nums' + 'font-medium' + 'border-x'
 *     * inline style transition list includes 'font-weight'
 *     * data-topo-chrome-zoom-level-hover toggles 'false' → 'true'
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-zoom-level]', { timeout: 15000 });
await page.waitForTimeout(400);

const restProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    className:    el.className,
    fwComputed:   cs.fontWeight,
    lsComputed:   cs.letterSpacing,
    hoverAttr:    el.getAttribute('data-topo-chrome-zoom-level-hover'),
    transition:   el.getAttribute('style') || '',
  };
});

// Hover the zoom-level via DOM dispatch — onMouseEnter sets hoveredZoomLevel
await page.hover('[data-topo-chrome-zoom-level]');
await page.waitForTimeout(400);

const hoverProbe = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-chrome-zoom-level]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    fwComputed: cs.fontWeight,
    lsComputed: cs.letterSpacing,
    hoverAttr:  el.getAttribute('data-topo-chrome-zoom-level-hover'),
  };
});

await browser.close();

const results = {
  // Rest state
  rest_fw_500:                  restProbe?.fwComputed === '500',
  rest_ls_zero:                 restProbe?.lsComputed === 'normal' || restProbe?.lsComputed === '0px',
  rest_hover_attr_false:        restProbe?.hoverAttr === 'false',
  rest_has_tabular_nums:        restProbe?.className.includes('tabular-nums') === true,
  rest_has_font_medium:         restProbe?.className.includes('font-medium') === true,
  rest_has_border_x:            restProbe?.className.includes('border-x') === true,
  // R420 transition includes font-weight
  rest_transition_font_weight:  restProbe?.transition.includes('font-weight') === true,
  // Hover state: fw 600 + letterSpacing > 0
  hover_fw_600:                 hoverProbe?.fwComputed === '600',
  hover_ls_lifted:              hoverProbe?.lsComputed === '0.5px',
  hover_attr_true:              hoverProbe?.hoverAttr === 'true',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome zoom-level hover fw 500 → 600:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
