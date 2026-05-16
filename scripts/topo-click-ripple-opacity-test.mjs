/* Round 403 verification: click-ripple SMIL initial opacity 0.7 →
 * 0.8. Theme-consistency / canvas-presence polish family (8th
 * anchor) — click-feedback now starts at the same 0.8 alpha as
 * R370 hub hover-ring and R391 hub-spoke active. Three canvas
 * state-feedback indicators share a uniform 0.8 start alpha.
 *
 * Contract:
 *   - Click the hub to fire the ripple (R52 fitView click path)
 *   - data-click-ripple-start-opacity === '0.8' on the opacity
 *     <animate> element
 *   - The opacity animation `values` starts with '0.8'
 *   - Pre-R403 invariants preserved:
 *     * dur='0.5s'
 *     * R227 calcMode='spline'
 *     * R227 keySplines='0.25 0.1 0.25 1'
 *     * fill='freeze'
 *
 * Source-file verification fallback: the SMIL element appears
 * only during the 500ms ripple window, so the test reads source
 * if the runtime probe doesn't catch the element in flight.
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
await page.waitForSelector('[data-topo-hub]', { timeout: 15000 });
await page.waitForTimeout(400);

// Click hub to fire ripple
await page.click('[data-topo-hub]');
await page.waitForTimeout(100);  // ripple lives 500ms, probe early

const probe = await page.evaluate(() => {
  const ripple = document.querySelector('[data-click-ripple]');
  if (!ripple) return null;
  const opacityAnim = ripple.querySelector('[data-click-ripple-start-opacity]');
  return {
    rippleMounted:  true,
    strokeWidth:    ripple.getAttribute('stroke-width'),
    fillAttr:       ripple.getAttribute('fill'),
    startOpacity:   opacityAnim?.getAttribute('data-click-ripple-start-opacity') ?? null,
    valuesAttr:     opacityAnim?.getAttribute('values') ?? null,
    durAttr:        opacityAnim?.getAttribute('dur') ?? null,
    calcMode:       opacityAnim?.getAttribute('calcMode') ?? null,
    keySplines:     opacityAnim?.getAttribute('keySplines') ?? null,
    fillFreeze:     opacityAnim?.getAttribute('fill') ?? null,
  };
});

// Source-file fallback in case the SMIL element is not caught
const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceHasStartOpacity = fileText.includes('data-click-ripple-start-opacity="0.8"');
const sourceHasValues08     = fileText.includes('values="0.8;0"');

await browser.close();

const results = {
  // Source-file invariants (deterministic from disk)
  source_start_opacity_attr: sourceHasStartOpacity,
  source_values_0_8_to_0:    sourceHasValues08,
  // Runtime probe (best-effort during 500ms ripple window)
  ripple_mounted:            !!probe,
  start_opacity_0_8:         probe?.startOpacity === '0.8',
  values_0_8_to_0:           probe?.valuesAttr === '0.8;0',
  dur_0_5s:                  probe?.durAttr === '0.5s',
  calcMode_spline:           probe?.calcMode === 'spline',
  keySplines_easeout:        probe?.keySplines === '0.25 0.1 0.25 1',
  // Static ring invariants
  strokeWidth_2:             probe?.strokeWidth === '2',
  fill_none:                 probe?.fillAttr === 'none',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} click-ripple SMIL opacity 0.7 → 0.8:`, JSON.stringify(results),
  '\n  probe:', JSON.stringify(probe, null, 2));
process.exit(ok ? 0 : 1);
