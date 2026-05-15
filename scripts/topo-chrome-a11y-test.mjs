/* Round 154 verification: TopoGraph chrome buttons gain stable
 * data-* hooks for tests + focus-visible ring matching the
 * dashboard's cyan accent (browser default focus outline often
 * vanishes on the dark canvas).
 *
 * Chrome inventory (bottom-right of canvas):
 *   data-topo-chrome              (wrapper div)
 *   data-topo-chrome-nodesize=S|M|L  (segmented control, R113)
 *   data-topo-chrome-nodesize-active="true|false"
 *   data-topo-chrome-zoom-out     (R104)
 *   data-topo-chrome-zoom-level   (readout, also R104)
 *   data-topo-chrome-zoom-in
 *   data-topo-chrome-reset
 *   data-topo-chrome-fullscreen
 *   data-topo-chrome-fullscreen-active="true|false"
 *
 * Each button gains focus-visible:ring-1 ring-cyan-400/60. Tabs
 * land somewhere visible.
 *
 * Test: every chrome button surfaces its data attribute, plus the
 * three S/M/L buttons report active correctly when one is picked.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
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
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 2, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome]', { timeout: 10000 });
await page.waitForTimeout(300);

const inspect = () => page.evaluate(() => {
  const sel = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  return {
    wrapper:        !!sel('[data-topo-chrome]'),
    nodesizeS:      sel('[data-topo-chrome-nodesize="S"]')?.getAttribute('data-topo-chrome-nodesize-active'),
    nodesizeM:      sel('[data-topo-chrome-nodesize="M"]')?.getAttribute('data-topo-chrome-nodesize-active'),
    nodesizeL:      sel('[data-topo-chrome-nodesize="L"]')?.getAttribute('data-topo-chrome-nodesize-active'),
    zoomOut:        !!sel('[data-topo-chrome-zoom-out]'),
    zoomLevel:      sel('[data-topo-chrome-zoom-level]')?.textContent?.trim(),
    zoomIn:         !!sel('[data-topo-chrome-zoom-in]'),
    reset:          !!sel('[data-topo-chrome-reset]'),
    fullscreen:     !!sel('[data-topo-chrome-fullscreen]'),
    fullscreenActive: sel('[data-topo-chrome-fullscreen]')?.getAttribute('data-topo-chrome-fullscreen-active'),
    // focus-visible ring is a CSS pseudo-class; just verify the
    // className carries the focus-visible:ring tokens.
    chromeButtonsHaveFocusRing: all('[data-topo-chrome] button').every(b =>
      (b.className || '').includes('focus-visible:ring')),
  };
});

const before = await inspect();

// Click L → it becomes active, M becomes inactive (default)
await page.locator('[data-topo-chrome-nodesize="L"]').click();
await page.waitForTimeout(150);
const afterL = await inspect();

await browser.close();

const results = {
  wrapper_present:         before.wrapper === true,
  nodesizeS_present:       before.nodesizeS === 'false',
  nodesizeM_activeDefault: before.nodesizeM === 'true', // default scale 0.84 → M
  nodesizeL_present:       before.nodesizeL === 'false',
  zoomOut_present:         before.zoomOut === true,
  zoomLevel_100pct:        before.zoomLevel === '100%',
  zoomIn_present:          before.zoomIn === true,
  reset_present:           before.reset === true,
  fullscreen_present:      before.fullscreen === true,
  fullscreenActive_false:  before.fullscreenActive === 'false',
  focusRing_onAllButtons:  before.chromeButtonsHaveFocusRing === true,

  // After clicking L: active flips to L
  afterL_LActive:          afterL.nodesizeL === 'true',
  afterL_MInactive:        afterL.nodesizeM === 'false',
  afterL_SInactive:        afterL.nodesizeS === 'false',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome a11y:`, JSON.stringify(results),
  `\n  before=`, before,
  `\n  afterL=`, afterL);
process.exit(ok ? 0 : 1);
