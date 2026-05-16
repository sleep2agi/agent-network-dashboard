/* Round 380 verification: cluster box stroke gets round linecap +
 * round linejoin. Sibling SVG stroke-softening polish to R378 flow-
 * rail linecap + R379 minimap viewport linejoin — extends the family
 * to the group cluster boundary box (grid layout only).
 *
 * Family snapshot post-R380:
 *   R288 chrome icons         strokeLinecap='round'
 *   R378 flow-rail dashes     strokeLinecap='round'
 *   R380 group box dashes     strokeLinecap='round' (this round)
 *   R379 viewport rect        strokeLinejoin='round'
 *   R380 group box corners    strokeLinejoin='round' (this round)
 *
 * Contract (cyber, grid layout):
 *   - [data-group-box-pinned] elements have stroke-linecap='round'
 *     + stroke-linejoin='round'.
 *   - data-group-box-linecap + data-group-box-linejoin === 'round'.
 *   - Pre-R380 invariants:
 *     * strokeWidth=1.5 at rest (R68 ladder)
 *     * strokeDasharray='6 6' at rest (R85 marching ants)
 *     * data-group-box-pinned 'false' at rest
 *     * data-group-box-lifted 'false' at rest
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-layout', JSON.stringify('grid'));
  } catch {}
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
  // Cluster groups via prefix alias → group boxes render.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1'), mk('alpha-2'), mk('alpha-3'),
    mk('beta-1'),  mk('beta-2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 15000 });
const layoutActive = await page.getAttribute('[data-topo-chrome-layout="grid"]', 'data-topo-chrome-layout-active');
if (layoutActive !== 'true') await page.click('[data-topo-chrome-layout="grid"]');
await page.waitForSelector('[data-group-box-pinned]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const boxes = Array.from(document.querySelectorAll('[data-group-box-pinned]'));
  return boxes.map(el => ({
    linecapAttr:    el.getAttribute('stroke-linecap'),
    linejoinAttr:   el.getAttribute('stroke-linejoin'),
    linecapData:    el.getAttribute('data-group-box-linecap'),
    linejoinData:   el.getAttribute('data-group-box-linejoin'),
    strokeWidth:    el.getAttribute('stroke-width'),
    strokeDasharray: el.getAttribute('stroke-dasharray'),
    pinnedAttr:     el.getAttribute('data-group-box-pinned'),
    liftedAttr:     el.getAttribute('data-group-box-lifted'),
  }));
});

await browser.close();

const allOk = probe.length >= 1 && probe.every(b =>
  b.linecapAttr === 'round'
  && b.linejoinAttr === 'round'
  && b.linecapData === 'round'
  && b.linejoinData === 'round'
  && b.strokeWidth === '1.5'        // R68 rest
  && b.strokeDasharray === '6 6'    // R85 rest
  && b.pinnedAttr === 'false'
  && b.liftedAttr === 'false'
);

const results = {
  boxes_rendered:        probe.length >= 1,
  all_linecap_round:     probe.every(b => b.linecapAttr === 'round'),
  all_linejoin_round:    probe.every(b => b.linejoinAttr === 'round'),
  all_data_linecap:      probe.every(b => b.linecapData === 'round'),
  all_data_linejoin:     probe.every(b => b.linejoinData === 'round'),
  all_strokew_1_5_rest:  probe.every(b => b.strokeWidth === '1.5'),
  all_dash_6_6_rest:     probe.every(b => b.strokeDasharray === '6 6'),
  all_pinned_false:      probe.every(b => b.pinnedAttr === 'false'),
  all_lifted_false:      probe.every(b => b.liftedAttr === 'false'),
};
const ok = allOk && Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group box strokeLinecap + Linejoin = round:`, JSON.stringify(results),
  '\n  boxes:', probe.map(b => ({ linecap: b.linecapAttr, linejoin: b.linejoinAttr, sw: b.strokeWidth, dash: b.strokeDasharray })));
process.exit(ok ? 0 : 1);
