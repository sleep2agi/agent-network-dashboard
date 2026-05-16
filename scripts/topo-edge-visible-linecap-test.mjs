/* Round 381 verification: edge visible flow path strokeLinecap='round'.
 * Sibling SVG stroke-softening polish to R378 flow-rail linecap — both
 * flow-element paths now share 'round' linecap. R380 group box closed
 * dash-cap + corner softening; R381 closes the flow-path family at the
 * visible primary path.
 *
 * Stroke-softening family snapshot post-R381:
 *   R288 chrome icons      strokeLinecap='round'
 *   R378 flow-rail dashes  strokeLinecap='round'
 *   R380 group box dashes  strokeLinecap='round'
 *   R381 flow visible path strokeLinecap='round' (this round)
 *   R379 viewport rect     strokeLinejoin='round'
 *   R380 group box corners strokeLinejoin='round'
 *
 * Contract:
 *   - [data-edge-visible] element stroke-linecap attr === 'round'.
 *   - data-edge-visible-linecap === 'round'.
 *   - Pre-R381 invariants:
 *     * fill='none', stroke=pal.flowEdge
 *     * markerEnd referencing arrow id
 *     * opacity-based freshness preserved (any value in 0..1)
 *     * transition list contains opacity + stroke-width + stroke
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
await page.waitForSelector('[data-edge-visible]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const p = document.querySelector('[data-edge-visible]');
  const cs = p ? getComputedStyle(p) : null;
  return {
    linecapAttr:  p?.getAttribute('stroke-linecap') ?? null,
    linecapData:  p?.getAttribute('data-edge-visible-linecap') ?? null,
    fillAttr:     p?.getAttribute('fill') ?? null,
    markerEndAttr: p?.getAttribute('marker-end') ?? null,
    transition:   cs?.transition ?? null,
    linkKey:      p?.getAttribute('data-edge-visible') ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  linecap_round:        probe.linecapAttr === 'round',
  data_linecap_round:   probe.linecapData === 'round',
  fill_none:            probe.fillAttr === 'none',
  marker_end_arrow:     /^url\(#topo-arrow-/.test(probe.markerEndAttr || ''),
  trans_has_opacity:    hasTrans(probe.transition, 'opacity'),
  trans_has_stroke_w:   hasTrans(probe.transition, 'stroke-width'),
  trans_has_stroke:     hasTrans(probe.transition, 'stroke'),
  link_key_present:     (probe.linkKey || '').length > 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge visible path strokeLinecap='round':`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
