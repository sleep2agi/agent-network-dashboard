/* Round 393 verification: minimap viewport rect rx 0 → 2.
 * Corner-radius cascade family adds a sub-element tier (7th
 * anchor) by softening the cyan-stroked viewport frame inside
 * the R332 rounded minimap container. Small but visible polish
 * — 2-px radius reads as "not sharp" without feeling pillowy on
 * the 30-50px wide viewport rect.
 *
 * Contract:
 *   - Minimap only mounts on non-default view → zoom-in twice
 *   - viewport rect rx attr === '2'
 *   - data-topo-minimap-viewport-rx === '2'
 *   - Pre-R393 invariants preserved:
 *     * R346 hover-state strokeWidth tween (rest '1.5' / hover '1.75')
 *     * R346 opacity tween (rest '0.9' / hover '1')
 *     * R379 strokeLinejoin='round'
 *     * fill='none' + stroke=pal.legendAccent
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta'), mk('gamma') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(300);

await page.click('[data-topo-chrome-zoom-in]');
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-viewport]', { timeout: 5000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const v = document.querySelector('[data-topo-minimap-viewport]');
  if (!v) return null;
  return {
    rxAttr:        v.getAttribute('rx'),
    rxData:        v.getAttribute('data-topo-minimap-viewport-rx'),
    strokeWidth:   v.getAttribute('stroke-width'),
    opacity:       v.getAttribute('opacity'),
    linejoin:      v.getAttribute('stroke-linejoin'),
    fill:          v.getAttribute('fill'),
    strokePresent: !!v.getAttribute('stroke') && v.getAttribute('stroke') !== 'none',
  };
});

await browser.close();

const results = {
  // R393: rx 0 → 2
  rx_attr_2:           probe?.rxAttr === '2',
  rx_data_2:           probe?.rxData === '2',
  // R346 hover-state rest invariants (no hover yet → rest values)
  rest_strokeWidth_15: probe?.strokeWidth === '1.5',
  rest_opacity_09:    probe?.opacity === '0.9',
  // R379 + base invariants
  linejoin_round:      probe?.linejoin === 'round',
  fill_none:           probe?.fill === 'none',
  stroke_present:      probe?.strokePresent === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap viewport rect rx 0 → 2:`, JSON.stringify(results),
  '\n  probe:', JSON.stringify(probe, null, 2));
process.exit(ok ? 0 : 1);
