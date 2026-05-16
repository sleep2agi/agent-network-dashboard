/* Round 389 verification: hover-detail model line (y=32) fw 400 → 600.
 * Closes the hover-detail typography 3-tier ladder by giving the
 * subhead its own weight tier between R0 vendor label badge (fw=700)
 * and R388 body lines (fw=500). Sibling to the chip-internal-
 * hierarchy arc (R333-R341/R362/R369) which uses fw=600 for value
 * lines.
 *
 * Contract:
 *   - On hover, the hover-detail card mounts and:
 *     * y=32 <text> font-weight attr === '600'
 *     * y=32 data-topo-hover-detail-model-fw === '600'
 *     * y=32 computed font-weight === '600'
 *     * y=32 fontSize === '10' (R389 doesn't change size)
 *   - Tier ladder preserved:
 *     * y=16 vendor fw=700 (R0 invariant)
 *     * y=48/64/80 body fw=500 (R388 invariant)
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
  const texts = Array.from(card.querySelectorAll('text'));
  const get = (y) => {
    const t = texts.find((el) => el.getAttribute('y') === y);
    return t ? {
      fontSize:    t.getAttribute('font-size'),
      fwAttr:      t.getAttribute('font-weight'),
      fwComputed:  getComputedStyle(t).fontWeight,
      modelFwData: t.getAttribute('data-topo-hover-detail-model-fw'),
      bodyFwData:  t.getAttribute('data-topo-hover-detail-body-fw'),
    } : null;
  };
  return {
    vendor: get('16'),
    model:  get('32'),
    runtime: get('48'),
    host:   get('64'),
    task:   get('80'),
  };
});

await browser.close();

const results = {
  // R389 changes: y=32 model lifted to fw=600
  model_y32_size_10:           probe?.model?.fontSize === '10',
  model_y32_fw_attr_600:       probe?.model?.fwAttr === '600',
  model_y32_data_600:          probe?.model?.modelFwData === '600',
  model_y32_computed_600:      probe?.model?.fwComputed === '600',
  // R0 invariant: y=16 vendor fw=700 unchanged
  vendor_y16_fw_700:           probe?.vendor?.fwAttr === '700',
  // R388 invariants: body lines y=48/64/80 fw=500 unchanged
  runtime_y48_fw_500:          probe?.runtime?.fwAttr === '500',
  host_y64_fw_500:             probe?.host?.fwAttr === '500',
  task_y80_fw_500:             probe?.task?.fwAttr === '500',
  // Tier-isolation invariant: only y=32 carries the model-fw data attr
  vendor_y16_no_model_attr:    probe?.vendor?.modelFwData === null || probe?.vendor?.modelFwData === undefined,
  runtime_y48_no_model_attr:   probe?.runtime?.modelFwData === null || probe?.runtime?.modelFwData === undefined,
  host_y64_no_model_attr:      probe?.host?.modelFwData === null || probe?.host?.modelFwData === undefined,
  task_y80_no_model_attr:      probe?.task?.modelFwData === null || probe?.task?.modelFwData === undefined,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hover-detail model line fw 400 → 600:`, JSON.stringify(results),
  '\n  probe:', JSON.stringify(probe, null, 2));
process.exit(ok ? 0 : 1);
