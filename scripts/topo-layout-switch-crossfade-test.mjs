/* Round 170 verification: layout toggle (Ring ↔ Grid) crossfade.
 *
 * Pre-R170 clicking Ring/Grid teleported every node to its new
 * position in one frame — most jarring user action on the canvas.
 *
 * R170 introduces layoutSwitching one-shot flag (same pattern as
 * R168 smoothView but on opacity axis). The viewport <g>:
 *   transition: 'opacity 250ms ease-out' (always present)
 *              + 'transform 300ms ease-out' (when smoothView armed)
 *   opacity: layoutSwitching ? 0.45 : 1
 *   data-topo-viewport-layout-switching: 'true' | 'false'
 *
 * Layout state swap is synchronous (setLayout) — the dim masks
 * the snap as a soft blink. Auto-clears 400ms (covers fade-down
 * 250ms + buffer for React commit).
 *
 * Test:
 *   1. Idle (ring layout): layoutSwitching='false', opacity=1
 *   2. Press 'L' (toggleLayout) → flag='true', opacity=0.45
 *   3. Layout state flipped to grid (group boxes visible)
 *   4. Wait 450ms → flag='false', opacity=1
 *   5. Press 'L' again → flag='true' (reverse direction works too)
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
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
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
  // Prefix-clustered aliases so group boxes render in grid layout
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-a1'), mk('agents-a2'), mk('infra-b1'), mk('infra-b2'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-viewport]', { timeout: 10000 });
await page.waitForTimeout(400);

const probeViewport = () => page.evaluate(() => {
  const g = document.querySelector('[data-topo-viewport]');
  return {
    layoutSwitching: g?.getAttribute('data-topo-viewport-layout-switching'),
    opacity:        g?.style?.opacity || '',
    transition:     g?.style?.transition || '',
    hubVisible:     !!document.querySelector('[data-topo-hub]'),
    groupBoxes:     document.querySelectorAll('[data-group-box-pinned]').length,
  };
});

const idle = await probeViewport();

// Press 'L' to toggle ring → grid. Probe within 400ms window.
await page.keyboard.press('l');
await page.waitForTimeout(50);
const duringToggle1 = await probeViewport();

// Wait past 400ms window
await page.waitForTimeout(420);
const afterToggle1 = await probeViewport();

// Press 'L' again to toggle grid → ring
await page.keyboard.press('l');
await page.waitForTimeout(50);
const duringToggle2 = await probeViewport();

await page.waitForTimeout(420);
const afterToggle2 = await probeViewport();

await browser.close();

const results = {
  viewport_found:                idle !== null,
  idle_layoutSwitching_false:    idle.layoutSwitching === 'false',
  idle_opacity_1:                idle.opacity === '1' || idle.opacity === '',
  idle_has_opacity_transition:   idle.transition.includes('opacity 250ms'),
  idle_in_ring:                  idle.hubVisible && idle.groupBoxes === 0,

  toggle1_flag_true:             duringToggle1.layoutSwitching === 'true',
  toggle1_opacity_0p45:          duringToggle1.opacity === '0.45',
  // Layout state has flipped synchronously inside toggleLayout
  toggle1_now_grid:              !duringToggle1.hubVisible && duringToggle1.groupBoxes > 0,

  after1_flag_false:             afterToggle1.layoutSwitching === 'false',
  after1_opacity_1:              afterToggle1.opacity === '1',
  after1_still_grid:             !afterToggle1.hubVisible && afterToggle1.groupBoxes > 0,

  toggle2_flag_true:             duringToggle2.layoutSwitching === 'true',
  toggle2_opacity_0p45:          duringToggle2.opacity === '0.45',
  toggle2_back_to_ring:          duringToggle2.hubVisible && duringToggle2.groupBoxes === 0,

  after2_flag_false:             afterToggle2.layoutSwitching === 'false',
  after2_opacity_1:              afterToggle2.opacity === '1',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} layout switch crossfade:`, JSON.stringify(results),
  `\n  idle =`, idle,
  `\n  during toggle1 (ring→grid) =`, duringToggle1,
  `\n  after toggle1 =`, afterToggle1,
  `\n  during toggle2 (grid→ring) =`, duringToggle2,
  `\n  after toggle2 =`, afterToggle2);
process.exit(ok ? 0 : 1);
