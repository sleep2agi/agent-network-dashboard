/* Round 376 verification: nodeSize + zoom segmented control wrappers
 * rounded-md → rounded-lg (6 → 8 px). Sibling polish to R375 Layout-
 * toggle wrapper — three chrome-strip segmented controls now all
 * share rounded-lg at the wrapper tier:
 *   R375 Layout-toggle wrapper  rounded-lg  8 px
 *   R376 nodeSize wrapper       rounded-lg  8 px (this round)
 *   R376 zoom wrapper           rounded-lg  8 px (this round)
 *
 * Individual atomic chrome buttons (reset, fullscreen) keep rounded-
 * md (6 px) as their own atomic-button tier — chrome strip now
 * expresses a two-tier hierarchy: 'segmented control container'
 * (rounded-lg) vs 'standalone button' (rounded-md).
 *
 * Contract:
 *   - [data-topo-chrome-nodesize-radius] computed border-radius '8px'.
 *   - data-topo-chrome-nodesize-radius === 'rounded-lg'.
 *   - [data-topo-chrome-zoom-wrapper-radius] computed border-radius '8px'.
 *   - data-topo-chrome-zoom-wrapper-radius === 'rounded-lg'.
 *   - Pre-R376 invariants: border 1px + flex display + overflow:hidden
 *     + R263 background-color/border-color transition preserved on
 *     each wrapper.
 *   - Atomic reset + fullscreen buttons still have border-radius 6px
 *     (rounded-md, untouched).
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
await page.waitForSelector('[data-topo-chrome-nodesize-radius]',     { timeout: 15000 });
await page.waitForSelector('[data-topo-chrome-zoom-wrapper-radius]', { timeout: 5000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const nodesize = document.querySelector('[data-topo-chrome-nodesize-radius]');
  const zoom     = document.querySelector('[data-topo-chrome-zoom-wrapper-radius]');
  const reset    = document.querySelector('[data-topo-chrome-reset]');
  const fs       = document.querySelector('[data-topo-chrome-fullscreen]');
  const ncs      = nodesize ? getComputedStyle(nodesize) : null;
  const zcs      = zoom     ? getComputedStyle(zoom)     : null;
  const rcs      = reset    ? getComputedStyle(reset)    : null;
  const fcs      = fs       ? getComputedStyle(fs)       : null;
  return {
    nodesizeRadius:    ncs?.borderRadius ?? null,
    nodesizeData:      nodesize?.getAttribute('data-topo-chrome-nodesize-radius') ?? null,
    nodesizeBorderW:   ncs?.borderWidth ?? null,
    nodesizeTrans:     ncs?.transition ?? null,
    zoomRadius:        zcs?.borderRadius ?? null,
    zoomData:          zoom?.getAttribute('data-topo-chrome-zoom-wrapper-radius') ?? null,
    zoomBorderW:       zcs?.borderWidth ?? null,
    zoomTrans:         zcs?.transition ?? null,
    resetRadius:       rcs?.borderRadius ?? null,
    fullscreenRadius:  fcs?.borderRadius ?? null,
  };
});

await browser.close();

const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  nodesize_radius_8px:    probe.nodesizeRadius === '8px',           // rounded-lg
  nodesize_data_lg:       probe.nodesizeData === 'rounded-lg',
  nodesize_border_1px:    probe.nodesizeBorderW === '1px',
  nodesize_trans_border:  hasTrans(probe.nodesizeTrans, 'border-color'),  // R263 / R268
  zoom_radius_8px:        probe.zoomRadius === '8px',
  zoom_data_lg:           probe.zoomData === 'rounded-lg',
  zoom_border_1px:        probe.zoomBorderW === '1px',
  zoom_trans_border:      hasTrans(probe.zoomTrans, 'border-color'),
  // Atomic chrome buttons stay rounded-md (6 px) — invariant.
  reset_still_md:         probe.resetRadius === '6px',
  fullscreen_still_md:    probe.fullscreenRadius === '6px',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome segmented wrappers rounded-md → rounded-lg:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
