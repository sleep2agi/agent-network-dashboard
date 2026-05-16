/* Round 390 verification: hover-detail card rx 8 → 10. Aligns the
 * card with the R331 panel tier (recent-signal, legend at rx=10)
 * instead of the R332/R375/R376 compact-chrome / segmented-control
 * tier (rx=8). Pure paint change — no layout shift, no bbox change.
 *
 * Contract:
 *   - On hover, the hover-detail card mounts and:
 *     * <rect> rx attr === '10'
 *     * data-topo-hover-detail-rx === '10'
 *     * Stays clear of the R332 minimap viewport (different element)
 *   - Pre-R390 invariants preserved:
 *     * R348 drop-shadow filter present
 *     * R387 opacity attr === '0.97' (cyber)
 *     * stroke present (pal.legendAccent)
 *     * width / height (192 / 88) unchanged
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
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(300);
await page.hover('g[data-node]');
await page.waitForSelector('[data-topo-hover-detail]', { timeout: 5000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const card = document.querySelector('[data-topo-hover-detail]');
  if (!card) return null;
  const rect = card.querySelector('rect');
  return {
    rxAttr:       rect?.getAttribute('rx') ?? null,
    rxData:       rect?.getAttribute('data-topo-hover-detail-rx') ?? null,
    opacityAttr:  rect?.getAttribute('opacity') ?? null,
    widthAttr:    rect?.getAttribute('width') ?? null,
    heightAttr:   rect?.getAttribute('height') ?? null,
    strokeAttr:   rect?.getAttribute('stroke') ?? null,
    styleAttr:    rect?.getAttribute('style') ?? '',
  };
});

await browser.close();

const results = {
  // R390: rx 8 → 10
  rx_attr_10:           probe?.rxAttr === '10',
  rx_data_10:           probe?.rxData === '10',
  // Pre-R390 invariants preserved
  opacity_cyber_0_97:   probe?.opacityAttr === '0.97',     // R387 invariant
  width_192:            probe?.widthAttr === '192',
  height_88:            probe?.heightAttr === '88',
  stroke_present:       !!probe?.strokeAttr && probe.strokeAttr !== 'none',
  drop_shadow_present:  probe?.styleAttr.includes('drop-shadow'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hover-detail card rx 8 → 10:`, JSON.stringify(results), '\n  probe:', probe);
process.exit(ok ? 0 : 1);
