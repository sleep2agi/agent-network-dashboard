/* Round 342 verification: active-links chip freshness suffix wrapper
 * lifts text-gray-500 → text-gray-400 (R317 subordinate-text-lift
 * family). Affects the literal "last {rel}" text; the freshness dot
 * keeps its own inline color via `style={{color: dotColor}}`.
 *
 * Contract:
 *   - The wrapper span containing [data-active-links-freshness-dot]
 *     has className containing 'text-gray-400' (not 'text-gray-500').
 *   - Wrapper textContent includes 'last' (the trailing literal).
 *   - Freshness dot keeps its own color (not the wrapper's).
 *   - R341 pin-intersection " pins" unit + R317/R318 chrome
 *     regressions intact.
 *   - R294 pulse absent.
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
    mk('alpha'), mk('beta'), mk('gamma'),
  ] } });
});
// One recent message → active-links chip's freshness suffix renders.
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'alpha', to_alias: 'beta', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-active-links-freshness-dot]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const dot = document.querySelector('[data-active-links-freshness-dot]');
  const wrapper = dot?.parentElement || null;
  return {
    wrapperClass:      wrapper?.className ?? '',
    wrapperText:       wrapper?.textContent ?? null,
    dotInlineColor:    dot?.getAttribute('style') ?? '',
    // R341 regression.
    pinIntersectionUnit: document.querySelector('[data-pin-intersection-unit]')?.className ?? '',
    layoutInactiveCls: document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:   document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:        document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  wrapper_has_gray_400:        /text-gray-400/.test(probe.wrapperClass),
  wrapper_no_gray_500:         !/text-gray-500/.test(probe.wrapperClass),
  wrapper_text_last:           /\blast\b/.test(probe.wrapperText || ''),
  dot_has_inline_color:        /color:/.test(probe.dotInlineColor),
  // R341 regression — only triggers when a pin is active. Test
  // doesn't click filters, so accept null OR opacity-70.
  r341_pin_unit_or_absent:     probe.pinIntersectionUnit === '' ||
                               /opacity-70/.test(probe.pinIntersectionUnit),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links freshness wrapper gray-400:`, JSON.stringify(results),
  '\n  wrapper class:', probe.wrapperClass,
  '\n  wrapper text:',  JSON.stringify(probe.wrapperText));
process.exit(ok ? 0 : 1);
