/* Round 378 verification: edge flow-path dashed-rail picks up
 * strokeLinecap='round'. Pre-R378 '2 12' dashes painted as sharp
 * 1×2 rectangles; R378 rounds each cap so the dashes read as soft
 * 3-px pills.
 *
 * Contract:
 *   - [data-edge-flow-rail] element stroke-linecap attr === 'round'.
 *   - data-edge-flow-rail-linecap === 'round'.
 *   - Pre-R378 invariants:
 *     * strokeWidth='1' preserved
 *     * strokeDasharray='2 12' preserved
 *     * R57 / R245 / R47 transition list (opacity + stroke) preserved
 *     * data-edge-flow-rail key still surfaces the link
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b') ] } });
});
const now = Date.now();
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a', to_alias: 'b', content: 'ping',
    network_id: 'default', created_at: new Date(now - 5000).toISOString() },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-edge-flow-rail]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const rail = document.querySelector('[data-edge-flow-rail]');
  const cs = rail ? getComputedStyle(rail) : null;
  return {
    linecapAttr:     rail?.getAttribute('stroke-linecap') ?? null,
    linecapData:     rail?.getAttribute('data-edge-flow-rail-linecap') ?? null,
    strokeWidth:     rail?.getAttribute('stroke-width') ?? null,
    strokeDasharray: rail?.getAttribute('stroke-dasharray') ?? null,
    transition:      cs?.transition ?? null,
    linkKey:         rail?.getAttribute('data-edge-flow-rail') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  linecap_round:        probe.linecapAttr === 'round',
  data_linecap_round:   probe.linecapData === 'round',
  stroke_width_1:       probe.strokeWidth === '1',
  dasharray_2_12:       probe.strokeDasharray === '2 12',
  trans_has_opacity:    hasTrans(probe.transition, 'opacity'),
  trans_has_stroke:     hasTrans(probe.transition, 'stroke'),
  link_key_present:     (probe.linkKey || '').length > 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} flow-rail strokeLinecap='round':`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
