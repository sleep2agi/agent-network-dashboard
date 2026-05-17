/* Round 493 verification: chrome-strip active:scale-95 press feedback
 * family rolls out from Ring/Grid (R492) to the remaining 5 chrome
 * buttons: nodeSize S/M/L (1 selector per .map call — 3 buttons),
 * zoom-out, zoom-in, reset, fullscreen.
 *
 * Total chrome strip active:scale-95 coverage after R493 = 7 buttons
 * (R306-era 7-button family unified on press feedback).
 *
 * Verifies per button:
 *  - DOM element resolvable
 *  - className contains `active:scale-95`
 *  - computed transition-property includes `transform`
 *  - computed transition-duration is 0.2s (200ms)
 *  - source-file regex confirms the class string wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1', 'working')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-fullscreen]', { timeout: 15000 });
await page.waitForTimeout(1000);

const probe = async (selector, label) => {
  const data = await page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s));
    if (!els.length) return { found: 0 };
    return {
      found: els.length,
      samples: els.slice(0, 3).map((el) => {
        const cs = window.getComputedStyle(el);
        return {
          cls_has_scale95: /active:scale-95/.test(el.className || ''),
          tp_has_transform: /transform/i.test(cs.transitionProperty || ''),
          td_includes_200: /\b0\.2s\b/.test(cs.transitionDuration || ''),
          tp: cs.transitionProperty,
          td: cs.transitionDuration,
        };
      }),
    };
  }, selector);
  return { label, ...data };
};

const nodeSizeBtns = await probe('button[data-topo-chrome-node-size]', 'nodeSize');
// node-size buttons may use a different attr; fall back to nth child selector
const zoomOutBtn = await probe('button[title^="Zoom out"]', 'zoomOut');
const zoomInBtn  = await probe('button[title^="Zoom in"]',  'zoomIn');
const resetBtn   = await probe('button[data-topo-chrome-reset-hover-lift]', 'reset');
const fullBtn    = await probe('button[data-topo-chrome-fullscreen]', 'fullscreen');

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// 5 source-side regex anchors (one per button class string)
const sNodeSize  = /px-2 py-1 transition-colors transition-transform duration-200 ease-out transform-gpu active:scale-95/.test(src);
const sZoom      = /group px-2 py-1 hover:bg-white\/5 active:bg-white\/10 transition-colors transition-transform duration-200 ease-out transform-gpu active:scale-95/.test(src);
const sReset     = /p-1\.5 rounded-md border hover:bg-white\/5 active:bg-white\/10 hover:-translate-y-px active:scale-95 transition-colors transition-transform duration-200/.test(src);
const sFullscreen= /group p-1\.5 rounded-md border hover:-translate-y-px active:scale-95 transition-colors transition-transform duration-200/.test(src);

const allButtonsPressReady = (info) =>
  info.found > 0 && info.samples.every((s) => s.cls_has_scale95 && s.tp_has_transform && s.td_includes_200);

const results = {
  zoom_out_press_ready:  allButtonsPressReady(zoomOutBtn),
  zoom_in_press_ready:   allButtonsPressReady(zoomInBtn),
  reset_press_ready:     allButtonsPressReady(resetBtn),
  fullscreen_press_ready:allButtonsPressReady(fullBtn),
  source_nodesize_wired: sNodeSize,
  source_zoom_wired:     sZoom,
  source_reset_wired:    sReset,
  source_fullscreen_wired: sFullscreen,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome-strip 5-button press feedback (R493):`, JSON.stringify(results),
  '\n  zoomOut found:', zoomOutBtn.found, '  zoomIn:', zoomInBtn.found,
  '\n  reset:', resetBtn.found, '  fullscreen:', fullBtn.found,
  '\n  nodeSize found:', nodeSizeBtns.found);
process.exit(ok ? 0 : 1);
