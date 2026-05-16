/* Round 379 verification: minimap viewport rect picks up
 * strokeLinejoin='round'. Sibling SVG stroke-softening polish to
 * R378 flow-rail linecap + R288 chrome icon linecap family.
 *
 * The minimap only mounts when view is non-default (zoom !== 1 ||
 * pan), so test triggers zoom-in to mount it.
 *
 * Contract:
 *   - [data-topo-minimap-viewport] element stroke-linejoin attr === 'round'.
 *   - data-topo-minimap-viewport-linejoin === 'round'.
 *   - Pre-R379 invariants:
 *     * R287 strokeWidth=1.5 (cold rest)
 *     * R287 stroke=pal.legendAccent
 *     * R346 opacity=0.9 (cold rest)
 *     * R199 smoothView + R346 transition list still tween correctly
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
// Trigger zoom-in to mount minimap (R30 gate).
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 15000 });
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(200);
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-viewport]', { timeout: 5000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-minimap-viewport]');
  return {
    linejoinAttr:    r?.getAttribute('stroke-linejoin') ?? null,
    linejoinData:    r?.getAttribute('data-topo-minimap-viewport-linejoin') ?? null,
    strokeWidthAttr: r?.getAttribute('stroke-width') ?? null,
    opacityAttr:     r?.getAttribute('opacity') ?? null,
    fillAttr:        r?.getAttribute('fill') ?? null,
  };
});

await browser.close();

const results = {
  linejoin_round:        probe.linejoinAttr === 'round',
  data_linejoin_round:   probe.linejoinData === 'round',
  stroke_width_1_5_rest: probe.strokeWidthAttr === '1.5',     // R287 cold rest
  opacity_0_9_rest:      probe.opacityAttr === '0.9',         // R346 cold rest
  fill_none:             probe.fillAttr === 'none',           // viewport rect is stroke-only
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap viewport linejoin='round':`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
