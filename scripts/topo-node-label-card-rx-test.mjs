/* Round 411 verification: node label card rx 6 → 8. Corner-radius
 * cascade family 8th anchor — compact card tier aligns with the
 * R332/R375/R376 compact-chrome rx=8 tier.
 *
 * Contract:
 *   - Each node's label-card <rect> rx attr === '8'
 *   - data-node-label-card-rx === '8'
 *   - Pre-R411 invariants on the rect:
 *     * cardW (width) > 0
 *     * cardH (height) > 0
 *     * fill, stroke present
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
await page.waitForSelector('[data-node-label-card]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[data-node-label-card]'));
  if (cards.length === 0) return { count: 0 };
  const sample = cards[0];
  return {
    count:        cards.length,
    rxAttr:       sample.getAttribute('rx'),
    rxData:       sample.getAttribute('data-node-label-card-rx'),
    widthAttr:    sample.getAttribute('width'),
    heightAttr:   sample.getAttribute('height'),
    fillPresent:  !!sample.getAttribute('fill'),
    strokePresent: !!sample.getAttribute('stroke'),
    allRx8:       cards.every((c) => c.getAttribute('rx') === '8'),
  };
});

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRx8 = /rx="8"\s*\n\s+fill=\{pal\.labelBox\.fill\}/.test(fileText) || /width=\{cardW\} height=\{cardH\} rx="8"/.test(fileText);
const sourceDataRx8 = /data-node-label-card-rx="8"/.test(fileText);

await browser.close();

const results = {
  // At least one label card mounted
  cards_count_ge_1:           (probe.count || 0) >= 1,
  // R411 wire
  rx_attr_8:                  probe.rxAttr === '8',
  rx_data_8:                  probe.rxData === '8',
  all_cards_rx_8:             probe.allRx8 === true,
  // Pre-R411 invariants
  width_present:              Number(probe.widthAttr) > 0,
  height_present:             Number(probe.heightAttr) > 0,
  fill_present:               probe.fillPresent === true,
  stroke_present:             probe.strokePresent === true,
  // Source-file canonical wire
  source_rx_8:                sourceRx8,
  source_data_rx_8:           sourceDataRx8,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node label card rx 6 → 8:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
