/* Round 328 verification: chip-row strip wrapper gap-2 → gap-2.5
 * (8px → 10px between chips).
 *
 * The chip-row strip stacks status chips (working/online/active-
 * links), vendor letters, pressure-bar segments, filter pin pills,
 * pin-intersection chip, and the Layout toggle. Each chip has its
 * own `px-2.5` (10px) horizontal padding. Pre-R328 the gap (8px)
 * was tighter than chip-padding, so neighbors visually touched.
 * R328 makes inter-chip = chip-padding rhythm.
 *
 * Sibling family:
 *   R298 title-block gap-2.5
 *   R328 chip-row    gap-2.5 (this round)
 *   R326 chrome      gap-2
 *
 * Contract:
 *   - The chip-row wrapper carries className 'gap-2.5' (not 'gap-2').
 *   - Computed column-gap === 10px.
 *   - R326 regression: [data-topo-chrome] still column-gap 8px.
 *   - R317/R318/R294 chrome + pulse regressions intact.
 *
 * The chip-row wrapper has no test-id; we find it as the sibling
 * `<div>` of the title-block (containing the Layout toggle button
 * via `[data-topo-chrome-layout-trailer]` which is its child).
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-layout-trailer]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const layoutWrapper = document.querySelector('[data-topo-chrome-layout-trailer]');
  // Chip-row strip is the parent div with className containing 'flex-wrap'
  // — walk up from the Layout toggle wrapper.
  let chipRow = layoutWrapper?.parentElement || null;
  while (chipRow && !chipRow.className.includes('flex-wrap')) {
    chipRow = chipRow.parentElement;
  }
  const chrome = document.querySelector('[data-topo-chrome]');
  return {
    chipRowClass:       chipRow?.className ?? '',
    chipRowColumnGap:   chipRow ? getComputedStyle(chipRow).columnGap : null,
    chromeColumnGap:    chrome ? getComputedStyle(chrome).columnGap : null,
    layoutInactiveCls:  document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:    document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  chip_row_has_gap_2_5:        probe.chipRowClass.includes('gap-2.5') && !/(^|\s)gap-2(\s|$)/.test(probe.chipRowClass),
  chip_row_gap_10px:           probe.chipRowColumnGap === '10px',
  // R326 regression: chrome strip stays at gap-2 (8px).
  r326_chrome_gap_8px:         probe.chromeColumnGap === '8px',
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:      probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:     probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:           probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-row gap-2.5:`, JSON.stringify(results),
  '\n  chip-row column-gap:', probe.chipRowColumnGap,
  '\n  chrome column-gap:',   probe.chromeColumnGap);
process.exit(ok ? 0 : 1);
